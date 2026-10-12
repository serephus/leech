# Hooks

Hooks run your own shell commands at three lifecycle points of a sync. Each hook
command is itself a Nunjucks template (same filters as file templates); it
receives the hook context as JSON on stdin and as `LEECH_*` environment
variables.

## Lifecycle points

| Hook | Runs | Can change what's committed? |
| --- | --- | --- |
| `pre` | Once, after the watermark is known and before the first LeetCode call | No (no workspace yet) |
| `submission` | Once per submission — `before-commit` (default) or `after-commit` | Yes, in `before-commit` |
| `post` | Once, after all submissions but before the final push | Yes — an optional extra commit |

A `submission` hook with `when: before-commit` runs before the commit is created
and may edit, add, or delete the files that get committed. With
`when: after-commit` it runs after the commit object exists (observational
only). A `post` hook runs before the single ref update; files it writes become
an optional post-sync commit in the same push.

## Configuration

A hook is either a string (shorthand for `{ run }`) or an object:

```yaml
hooks:
  shell: bash # default
  timeoutMs: 30000 # default per-hook timeout; 0 = no timeout
  onError: fail # default; fail | warn (submission also allows skip)

  pre: "echo starting"

  submission:
    when: before-commit # before-commit | after-commit
    run: |
      npx prettier --write '{{ question.title_slug }}/{{ submission.lang_ext }}'

  post:
    run: node .github/generate-index.mjs "$LEECH_HOOK_DIR"
    commit: "leech: regenerate index" # null disables the post commit
```

Per-hook fields: `run` (required), `cwd`, `timeoutMs`, `env` (a map), and
`onError`. `submission` also takes `when`; `post` also takes `commit`.

## Error handling

Exit code `0` succeeds. A non-zero exit (or a timeout) is handled by the hook's
`onError`, falling back to `hooks.onError`:

- **`fail`** — abort the sync; nothing is pushed.
- **`warn`** — log and continue; any workspace changes are discarded.
- **`skip`** — (`submission` only) skip committing this submission.

Because every hook runs before the single ref update, a `fail` in any hook means
**nothing** lands. See [Watermark & atomicity](/design/watermark).

## Hook context

Hooks read a JSON context from stdin and get convenience variables:
`LEECH_HOOK`, `LEECH_PHASE`, `LEECH_REPO`, `LEECH_BRANCH`, `LEECH_DESTINATION`,
`LEECH_SITE`, `LEECH_DRY_RUN`, `LEECH_VERBOSE`, `LEECH_HOOK_DIR`, and — for
`submission` hooks — `LEECH_SUBMISSION_ID`, `LEECH_SUBMISSION_TIMESTAMP`,
`LEECH_SUBMISSION_LANG`, `LEECH_QUESTION_SLUG`, `LEECH_QUESTION_TITLE`, and
`LEECH_FRONTEND_ID`.

The stdin JSON differs by phase:

- `submission` gets the same `submission` / `question` objects as file templates,
  plus `index`, `total`, `files`, and `workspace`.
- `pre` gets `watermark` and `prefix`.
- `post` gets `summary`, `finalWatermark`, `pushed`, and `submissions`.

The full schema lives in the
[hooks design doc](https://github.com/serephus/leech/blob/main/docs/hooks.md).

## The before-commit workspace

For a `submission` hook with `when: before-commit`, leech materializes the
rendered files and downloaded assets into a temp directory exposed as
`LEECH_HOOK_DIR`, runs the hook, then commits whatever is left. The hook may
edit files in place, add files, or delete files. Unchanged binary files keep
their exact bytes.

If a hook's `cwd` needs the target repository's files, add
`actions/checkout` to the workflow first — leech itself never checks the repo
out.

## Dry runs

Hooks still run in a dry run; no commit or ref update is created. Guard
irreversible side effects with `LEECH_DRY_RUN`.

## Secrets are scrubbed

The child environment has `INPUT_*`, `GITHUB_TOKEN`/`GH_TOKEN`, the LeetCode
cookies, and `ACTIONS_*` tokens removed. Pass anything a hook needs explicitly
via `env`.

## Example: notify a Telegram bot

A `post` hook receives `submissions` (everything committed this run) as JSON on
stdin. `jq` aggregates them into a single message and `curl` sends it to the
bot. Store the token and chat id as repository secrets and pass them explicitly
via `env`:

```yaml
hooks:
  post:
    run: |
      ctx="$(cat)"
      [ "$(jq '.submissions | length' <<<"$ctx")" -gt 0 ] || exit 0
      jq -c --arg chat_id "$TELEGRAM_CHAT_ID" '
        {
          chat_id: $chat_id,
          link_preview_options: { is_disabled: true },
          text: ("Synced \(.submissions | length) solution(s) across \(([.submissions[].slug] | unique) | length) problem(s):\n" +
            ([.submissions | group_by(.slug)[] |
              "• \(.[0].slug) (\([.[].lang] | join(", "))) https://leetcode.com/problems/\(.[0].slug)/"] |
              join("\n")))
        }
      ' <<<"$ctx" \
        | curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H "content-type: application/json" \
            --data-binary @-
    env:
      TELEGRAM_BOT_TOKEN: "${{ secrets.TELEGRAM_BOT_TOKEN }}"
      TELEGRAM_CHAT_ID: "${{ secrets.TELEGRAM_CHAT_ID }}"
```

`curl` and `jq` are preinstalled on the `ubuntu-latest` runner. When no
submissions are synced the hook exits early and sends nothing; `curl -f` turns a
non-2xx Telegram response into a non-zero exit, which the hook's `onError`
handles. Submissions are grouped by question so each problem URL appears once,
and `link_preview_options` disables the link preview.

For the internal design — lifecycle, context schema, atomicity guarantees — see
[Hooks lifecycle](/design/hooks-lifecycle).
