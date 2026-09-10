# Design: Hooks (pre / per-submission / post sync)

Status: proposal — maps to the README roadmap item
"Hooks (pre/post sync, per-submission)".

## 1. Goals and non-goals

### Goals

- Let users run their own shell commands at three lifecycle points of a sync:
  **pre** (once, before the run), **per-submission** (once per candidate that
  will be committed), and **post** (once, after all submissions but before the
  final push).
- Give hooks a rich, typed view of the run: the repository/branch, the
  watermark, the submission + question context, and the rendered file list.
- Let a per-submission hook **change exactly what gets committed** (edit the
  rendered files, add files, delete files) without leech switching to a
  checkout-based model.
- Let a post hook **append an optional post-sync commit** (e.g. regenerate an
  index) that lands in the same atomic ref update as the submission commits.
- Preserve leech's core guarantees: one commit per submission, single ref
  update per sync (atomic), watermark semantics.

### Non-goals

- No checkout of the target repo. Hooks run in the action's runtime
  environment; if a hook needs the repo's files, the workflow should
  `actions/checkout` first (the hook's `cwd` is the runner workspace).
- No Windows support for hooks (leech targets `ubuntu-latest`; `bash` is the
  default shell). Shell command strings are run with `bash -e -o pipefail -c`.
- No remote/plugin hooks (no fetching scripts from URLs). Hooks are literal
  config strings, like the rest of the config.
- No passing of secrets to hooks. Hooks inherit a scrubbed environment.

## 2. Lifecycle

```
parse config
  └─ resolve repo/branch, committer.init()
       └─ scan watermark
            └─ [HOOK: pre]                     once, no workspace
                 └─ collect submissions newer than watermark
                      └─ apply filters, sort oldest-first
                           └─ for each submission:
                                ├─ fetch details + question (cached)
                                ├─ render files + download assets
                                ├─ materialize files into a temp workspace
                                ├─ [HOOK: submission, phase=before-commit]   workspace editable
                                ├─ collect files from the workspace
                                ├─ commitSubmission(...)
                                └─ [HOOK: submission, phase=after-commit]    observational
                           └─ [HOOK: post]      once, empty workspace (optional extra commit)
                                └─ flush(): ONE ref update for all commits
```

- `pre` runs after the watermark is known and before the first LeetCode call.
- `submission` (`when: before-commit`, the default) runs after files are
  rendered but before that submission's commit is created; it may mutate the
  workspace.
- `submission` (`when: after-commit`) runs after the commit object is created
  locally but before the branch ref is advanced. It is observational only.
- `post` runs after the submission loop and before `flush()`. Files it writes
  become an optional post-sync commit that is chained after the last
  submission commit and pushed in the same ref update.

Because `flush()` is the only ref update and every hook runs before it,
an aborted run (any hook error with `onError: fail`) pushes **nothing** —
atomicity is preserved. Commit objects already created via the API are
dangling and garbage-collected by GitHub; no ref ever points at them.

## 3. Configuration

`hooks` is a new, optional top-level key in the leech config. Omitting it
(backward compatible) disables all hooks.

```yaml
hooks:
  shell: bash            # default; argv becomes [shell, "-e", "-o", "pipefail", "-c", cmd]
  timeoutMs: 30000       # default per-hook timeout; 0 = no timeout; per-hook overrides
  onError: fail          # default when a hook exits non-zero; fail | warn

  pre:                   # once, before scanning
    run: "echo starting at $(date -Is)"

  submission:            # once per submission
    when: before-commit  # before-commit | after-commit (default: before-commit)
    run: |
      npx prettier --write .
      node .github/add-metadata.mjs

  post:                  # once, before the final push
    run: |
      node .github/generate-index.mjs "$LEECH_HOOK_DIR"
    commit: "leech: regenerate index"   # message for the optional post commit
```

### 3.1 Shorthand

Any hook accepts a plain string as shorthand for `{ run: <string> }`, which
then inherits all defaults:

```yaml
hooks:
  pre: "echo starting"
  submission: "npx prettier --write ."
  post: "node .github/index.mjs"
```

### 3.2 Per-hook fields

| Field | Type | Default | Applies to | Meaning |
| --- | --- | --- | --- | --- |
| `run` | string | — | all | Shell command (required). Rendered as a Nunjucks template before execution (see §4.4). |
| `cwd` | string | runner workspace | all | Working directory for the hook; rendered as a template (§4.4). |
| `timeoutMs` | number | `hooks.timeoutMs` | all | 0 = no timeout. |
| `env` | map<string,string> | `{}` | all | Extra env vars merged over the scrubbed environment. |
| `onError` | `fail` \| `warn` \| `skip` | `hooks.onError` | all (`skip` only for `submission`) | See §5. |
| `when` | `before-commit` \| `after-commit` | `before-commit` | `submission` | Whether the hook runs before or after the commit is created. |
| `commit` | string \| null | `"<prefix> post-sync"` | `post` | Message for the optional post commit; `null` disables it (post files are ignored with a warning). |

`onError` values by hook point:

| Hook | `fail` | `warn` | `skip` |
| --- | --- | --- | --- |
| `pre` | abort sync | log & continue | n/a (rejected) |
| `submission` (`before-commit`) | abort sync | discard workspace, commit original files | skip this submission, continue |
| `submission` (`after-commit`) | abort sync (still pre-push) | log & continue | treated as `warn` (commit already created) |
| `post` | abort before push | discard workspace, push without post commit | n/a (rejected) |

## 4. Execution model

Each hook is spawned with:

- **argv**: `[shell, "-e", "-o", "pipefail", "-c", run]` (shell from
  `hooks.shell`, default `bash`).
- **stdin**: one JSON object (the context, §4.2), then EOF.
- **stdout/stderr**: streamed to the action log, line-prefixed with
  `[leech:hook:<name>]`. On success only stdout/stderr are shown in verbose
  mode; on failure they are always shown.
- **cwd**: `hook.cwd` if set, otherwise `process.cwd()` (the runner workspace).
- **env**: `process.env` with sensitive values scrubbed, then `LEECH_*`
  variables added, then `hook.env` merged last.

### 4.1 Environment scrubbing

Hooks are child processes and would otherwise inherit the action's secrets
(the `INPUT_*` variables that `@actions/core` reads, plus cookies/tokens).
Before spawning, leech deletes any key matching:

- `/^INPUT_/`
- `LEETCODE_SESSION`, `LEETCODE_CSRF_TOKEN`, `LEECH_SESSION`, `LEECH_CSRF`
- `GITHUB_TOKEN`, `GH_TOKEN`
- `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_URL`,
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`

Users who intentionally want a token inside a hook pass it explicitly via
`hook.env` (or read it from a secret into the hook's environment themselves).

### 4.2 Hook context (stdin JSON)

```ts
interface RepoContext {
  repo: { owner: string; name: string };
  branch: string;
  destination: string;
  site: "leetcode.com" | "leetcode.cn";
  dryRun: boolean;
  verbose: boolean;
}

interface PreHookContext extends RepoContext {
  hook: "pre";
  watermark: number;              // unix seconds
  prefix: string;                 // commit.prefix
}

interface SubmissionHookContext extends RepoContext {
  hook: "submission";
  phase: "before-commit" | "after-commit";
  index: number;                  // 0-based position in this run
  total: number;                  // submissions in this run
  submission: TemplateContext["submission"];
  question: TemplateContext["question"];
  files: { path: string; asset: boolean }[]; // final repo-relative paths
  workspace: string;              // LEECH_HOOK_DIR ("" when phase === "after-commit")
}

interface PostHookContext extends RepoContext {
  hook: "post";
  summary: SyncSummary;           // scanned, skippedFiltered, synced, watermark (pre-sync)
  finalWatermark: number;
  pushed: number;                 // submission commits created this run (post commit may add one more)
  submissions: Array<{
    id: number;
    slug: string;
    lang: string;
    timestamp: number;
    files: string[];
  }>;
}
```

`submission`/`question` in the submission context are the same objects exposed
to file/commit templates (see README "Templates"), i.e. `submission.code`,
`question.title_slug`, etc.

This exact context object is also used as the **Nunjucks context** for
rendering `run` / `cwd` / `env` values (§4.4).

### 4.3 Convenience env vars

For hooks that don't want to parse stdin JSON:

| Variable | Meaning |
| --- | --- |
| `LEECH_HOOK` | `pre` \| `submission` \| `post` |
| `LEECH_PHASE` | `before-commit` \| `after-commit` (empty for `pre`/`post`) |
| `LEECH_REPO` | `owner/name` |
| `LEECH_BRANCH` | target branch |
| `LEECH_DESTINATION` | config `destination` |
| `LEECH_SITE` | `leetcode.com` \| `leetcode.cn` |
| `LEECH_DRY_RUN` | `"true"` \| `"false"` |
| `LEECH_VERBOSE` | `"true"` \| `"false"` |
| `LEECH_HOOK_DIR` | workspace dir; empty string when not applicable |
| `LEECH_SUBMISSION_ID`, `LEECH_SUBMISSION_TIMESTAMP`, `LEECH_SUBMISSION_LANG` | submission hook only |
| `LEECH_QUESTION_SLUG`, `LEECH_QUESTION_TITLE`, `LEECH_FRONTEND_ID` | submission hook only |

### 4.4 Command templating

`run`, `cwd`, and each `env` value are Nunjucks templates, rendered with the
same environment used for file/commit templates (all standard Nunjucks
filters plus leech's `datefmt`, `slugify`, `pad`, `ext`, `codeBlock`,
`regexReplace`, `toMarkdown`, `toGfm`, `toTypst`), and honoring
`render.throwOnUndefined`. Rendering happens once, immediately before spawn,
using the §4.2 context as the template context.

```yaml
submission:
  when: before-commit
  run: |
    npx prettier --write '{{ question.title_slug }}/{{ submission.lang_ext }}'
    echo "{{ question.frontend_id }}: {{ submission.status }}"
```

Per-point availability:

- `pre` — `repo`, `branch`, `destination`, `site`, `dryRun`, `verbose`,
  `watermark`, `prefix`. No `submission`/`question`: referencing them renders
  empty (or throws with `render.throwOnUndefined: true`).
- `submission` — everything in `SubmissionHookContext`, including
  `submission`, `question`, `index`, `total`, `files`, `phase`, `workspace`.
- `post` — everything in `PostHookContext`: `summary`, `finalWatermark`,
  `pushed`, `submissions`, plus the `RepoContext` fields.

A render error is treated as a hook error: it obeys `onError` and, with
`fail`, aborts the sync before any push. To emit a literal `{{ }}` in a shell
command (e.g. inside an `awk` program or a heredoc), wrap it with
`{% raw %}…{% endraw %}` so Nunjucks leaves it untouched.

## 5. Exit codes and error policy

- `0` — success.
- anything else (or timeout) — an error, handled by the hook's `onError`
  (`fail` \| `warn` \| `skip`). The effective `onError` is the hook's own
  value if set, otherwise `hooks.onError`, otherwise `fail`.

On **any** error the hook's workspace is discarded (never partially committed):

- `fail` → throw, abort the sync. Because no `flush()` has happened, nothing
  is pushed.
- `warn` → log a warning and continue. For `submission.before-commit` the original
  rendered files are committed unchanged; for `post` no post commit is
  created.
- `skip` → (only `submission.before-commit`) log and continue without committing this
  submission.

Timeout is implemented with `AbortSignal` on the spawned process: `SIGTERM`,
then `SIGKILL` after a short grace period; it is reported as an error with
`onError` handling as above.

## 6. File influence (workspace protocol)

leech commits via the GitHub blob/tree/commit APIs, not a working tree. To let
hooks change the commit without a checkout, each `submission` (`before-commit`) hook
runs against a private temp directory:

1. Before the hook, leech materializes the submission's **final** files into
   `<tmp>/…`, at their final repo-relative paths (i.e. already prefixed with
   `destination`, including downloaded asset files). `LEECH_HOOK_DIR` points at
   this directory and the context's `files[]` lists those paths.
2. The hook may edit files in place, add new files, or delete files.
3. After a successful hook, leech walks `LEECH_HOOK_DIR` and commits its
   contents as the submission's file set.

Encoding is preserved exactly:

- A file whose bytes are identical to the materialized original keeps its
  original content and encoding (`utf-8` text or `base64` for binary assets).
  This guarantees untouched PNGs are never re-encoded.
- A changed or newly added file is read as bytes; if it contains a NUL byte it
  is committed `base64`, otherwise `utf-8`.
- A materialized file that is missing after the hook is dropped from the
  commit.

A `submission` (`after-commit`) hook has no workspace (`LEECH_HOOK_DIR` is empty) and
cannot change the already-created commit.

The `post` hook gets an **empty** workspace. If it writes files there (and
`commit` is not `null`), leech creates one additional commit chained after the
last submission commit, with:

- message = `post.commit` (default `"<commit.prefix> post-sync"`),
- author = `commit.authorName` / `commit.authorEmail`,
- author.date = the current time.

That commit participates in the same single `flush()` ref update, so the run
remains atomic. Because its author.date is "now", a prefixed post commit also
becomes the next run's watermark — which is correct: any submission with an
earlier timestamp was either synced in this run or is older than this run.

### 6.1 Dry-run

Hooks still run in `--dry-run` (they are part of the pipeline users want to
test). File collection and the post commit are performed and logged but no
commit/blob is created and no ref is updated. Hooks that have irreversible
side effects (notifications, deploys) should check `LEECH_DRY_RUN`.

## 7. Errors and edge cases

- **Missing shell / command**: spawn failure is an error (`onError` applies).
- **Hook writes outside `LEECH_HOOK_DIR`**: ignored; leech only reads the
  workspace. Document this so hooks don't expect side effects there.
- **`submission.after-commit` + `skip`**: treated as `warn` (the commit already
  exists locally; nothing is pushed if a later `fail` occurs).
- **`post.commit: null` + post files**: files are discarded with a warning.
- **Timeout**: `SIGTERM` → grace → `SIGKILL`; reported as a hook error.
- **Concurrency**: leech's workflow already uses a `concurrency` group;
  hooks inherit that. Hooks that mutate a shared checkout are the user's
  responsibility.

## 8. Schema changes (implementation plan)

- `src/config.ts`
  - Add `hookBaseSchema`, `submissionHookSchema`, `postHookSchema`,
    `hooksConfigSchema`, and a string-shorthand normalizer (string →
    `{ run: string }`, then defaults applied).
  - Add `hooks: hooksConfigSchema` to `configSchema`; export the new types
    (`HooksConfig`, `HookConfig`, `SubmissionHookConfig`, `PostHookConfig`,
    `HookErrorPolicy`).
  - `src/types.ts` re-exports the new types.
- `src/hooks.ts` (new)
  - `renderHookFields(hook, context)` — renders `run`/`cwd`/`env` with the
    shared Nunjucks env before spawn (§4.4); render errors surface as hook
    errors.
  - `runHook(hook, context, options)` — scrubs env, spawns
    `[shell, "-e", "-o", "pipefail", "-c", renderedRun]`, writes context JSON
    to stdin, streams output, enforces timeout, returns `{ ok, timedOut }`.
  - `scrubEnv(env, extra)` — pure, unit-testable.
  - `materializeWorkspace(dir, files)` / `collectWorkspace(dir, originals)`
    — the write/read-with-encoding-preservation primitives.
  - `buildHookContext(...)` per point.
  - `resolveOnError(hook, global, point)` — the policy table in §5.
- `src/sync.ts`
  - Call `pre` after watermark scan; wrap the per-submission loop to run
    `submission.before-commit` (materialize → hook → collect) and
    `submission.after-commit`; call `post` before `flush()` and, if it produced
    files, create the optional post commit.
  - Respect `dryRun`/`verbose` and pass the final summary into `post`.
- `src/git.ts`
  - Generalize the commit path: extract `commitFiles(files, message, authorDate)`
    from `commitSubmission`, and add a method for the post commit (message +
    current-time author date). `commitSubmission` delegates to it.
- `action.yml` / `src/index.ts`
  - No new action inputs — hooks live in the `config` YAML string.

## 9. Testing

- `test/config.test.ts` — hooks schema: defaults, string shorthand expansion,
  `onError`/`when` validation, `skip` rejected for `pre`/`post`, `commit: null`.
- `test/hooks.test.ts` (new)
  - `scrubEnv` removes `INPUT_*`, `GITHUB_TOKEN`, cookies, `ACTIONS_*`.
  - context serialization per point (snapshot or field checks).
  - exit-code → policy mapping (fail/warn/skip, after-commit→warn).
  - workspace round-trip: edit, add, delete; binary preservation (untouched
    PNG stays `base64`), changed text re-encoded `utf-8`.
  - hook runner: a tiny `bash -c` fixture that echoes stdin and exits with a
    chosen code; timeout path with a `sleep`-based fixture.
  - command templating: `run`/`cwd`/`env` render against the §4.2 context,
    `{% raw %}` preserves literal `{{ }}`, render errors obey `onError`.
- Manual smoke test in the local CLI (`--dry-run`) with a `pre`/`submission`/
  `post` config.

## 10. Example

```yaml
hooks:
  pre: |
    echo "leech sync starting for $LEECH_REPO@$LEECH_BRANCH"

  submission:
    when: before-commit
    run: |
      # format the code file in place (leech re-reads the workspace)
      npx prettier --write .
      # add a per-problem sidecar from the stdin context
      node -e '
        const fs = require("fs");
        const c = JSON.parse(fs.readFileSync(0, "utf8"));
        fs.writeFileSync(
          `${process.env.LEECH_HOOK_DIR}/${c.question.title_slug}.json`,
          JSON.stringify({ id: c.question.frontend_id, tags: c.question.tags })
        );'

  post:
    run: node .github/generate-index.mjs "$LEECH_HOOK_DIR"
    commit: "leech: regenerate index"
```

## 11. Open questions

1. Multiple hooks per point (arrays) vs. a single command per point. Proposal:
   v1 single command; arrays can be added without breaking the schema.
2. Whether `post` should materialize all files changed this run into its
   workspace (enabling a final pass over every synced file) instead of
   starting empty. Proposal: start empty for v1; revisit if requested.
3. Whether the post commit should default to a prefixed message (advancing the
   watermark to "now") or a non-prefixed marker. Proposal: prefixed
   (`"<prefix> post-sync"`), as documented in §6.
