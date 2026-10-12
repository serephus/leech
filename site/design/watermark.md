# Watermark & atomicity

Two guarantees make leech safe to run on a schedule: it never syncs the same
submission twice, and a run either lands completely or not at all. Both come
from how commits are authored and pushed.

## What the watermark is

A submission is considered **already synced** when a commit on the branch whose
message starts with `commit.prefix` has an `author.date` **greater than or equal
to** the submission's timestamp.

leech stamps every sync commit with the submission's own timestamp as the author
date (`author.date = submission.timestamp`). So the author date doubles as a
marker of "the newest submission already synced".

## How it's found

`scanWatermark` (`src/state.ts`) walks the branch history newest-first, 100
commits per page, and takes the **maximum** author date among commits whose
message starts with `commit.prefix`:

```text
watermark = max(author.date) over commits where message starts with prefix
```

Then only submissions with `timestamp > watermark` are candidates.

## Consequences

### There is no state file

Nothing to migrate, nothing to corrupt, no "last run" artifact. The git history
*is* the state. You can delete the workflow, recreate it, run it against a
fresh checkout of the same branch, and the watermark is unchanged.

### Changing `commit.prefix` resets the watermark

Old sync commits stop matching the new prefix, so the watermark falls back to
whatever the *new* prefix matches — typically `0`. That means **everything is
re-synced**, one commit per submission, overwriting existing files. Pick a
prefix once and keep it.

### You can migrate from another tool

Set `commit.prefix` to the header your previous sync tool used — for example
`Sync LeetCode submission` (joshcai/leetcode-sync) or `[LeetCode Sync]` — and
leech inherits the existing watermark instead of re-syncing your whole history.

### Re-syncing overwrites

When a submission is re-synced (because the prefix changed, or because you reset
things deliberately), rendered files with the same path are **overwritten**. An
improved solution replaces the old file, which is usually the point. If you want
to keep every attempt, put a unique key in the filename:

```yaml
- filename: "{{ question.title_slug }}/{{ submission.id }}/{{ submission.lang }}.{{ submission.lang_ext }}"
  content: "{{ submission.code }}"
```

## Atomicity

`SyncCommitter` creates commit objects locally (through the API) but does **not**
move the branch until the very end. The single `flush()` call updates
`heads/<branch>` once:

- If any step fails before `flush()` — a bad config, an expired session, a hook
  with `onError: fail` — **no ref update happens and nothing is pushed.** The
  commit objects that were already created are unreachable and get
  garbage-collected by GitHub.
- If `flush()` succeeds, **every** commit from the run is reachable at once,
  including an optional `post` hook commit.

`flush()` uses `force: false`, so it can't clobber a branch that moved. If it
fails because the branch advanced underneath, re-run — the watermark means the
already-pushed submissions are skipped.

### Serialize runs

Even with `force: false`, concurrent runs waste API calls and race on the ref.
The recommended workflow prevents that:

```yaml
concurrency:
  group: leech-sync
  cancel-in-progress: false # queue instead of cancelling
```

`cancel-in-progress: false` is important: cancelling a run mid-flight is safe
for git (nothing is pushed yet), but queuing is simpler and avoids surprises.

## Dry runs

`dry-run: "true"` renders everything and logs the commits it *would* create.
Hooks still run (they're part of the pipeline you want to test), but no blob,
commit, or ref update is created. Guard irreversible hook side effects with
`LEECH_DRY_RUN`.
