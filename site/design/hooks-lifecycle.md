# Hooks lifecycle

Status: **implemented**. This page describes the internal design — lifecycle,
context schema, workspace protocol, and the atomicity guarantee. For usage
recipes and configuration, see the [Hooks guide](/guide/hooks).

## Goals

- Run user shell commands at three lifecycle points: **pre** (once, before the
  run), **per-submission** (once per candidate that will be committed), and
  **post** (once, after all submissions but before the final push).
- Give hooks a rich, typed view of the run: repository/branch, watermark,
  submission + question context, and the rendered file list.
- Let a per-submission hook **change exactly what gets committed** (edit, add,
  delete files) without leech switching to a checkout-based model.
- Let a post hook append an optional post-sync commit that lands in the same
  atomic ref update.
- Preserve leech's core guarantees: one commit per submission, a single ref
  update per sync, and watermark semantics.

## Non-goals

- **No checkout of the target repo.** Hooks run in the action's
  environment; add `actions/checkout` to the workflow if a hook needs the repo's
  files on disk.
- **No Windows support.** leech targets `ubuntu-latest`; `bash` is the default
  shell.
- **No remote/plugin hooks.** Hooks are literal config strings, like the rest of
  the config.
- **No inherited secrets.** Hooks get a scrubbed environment; pass what they
  need explicitly via `env`.

## Lifecycle

```text
parse config
  └─ resolve repo/branch, SyncCommitter.init()
       └─ scan watermark
            └─ [HOOK: pre]                    once, no workspace
                 └─ collect submissions newer than watermark
                      └─ apply filters, sort oldest-first
                           └─ for each submission:
                                ├─ fetch details + question (cached)
                                ├─ render files + download assets
                                ├─ materialize files into a temp workspace
                                ├─ [HOOK: submission, before-commit]  editable
                                ├─ collect files from the workspace
                                ├─ commitSubmission(...)
                                └─ [HOOK: submission, after-commit]   observational
                           └─ [HOOK: post]    once, empty workspace (optional commit)
                                └─ flush(): ONE ref update for all commits
```

- `pre` runs after the watermark is known and before the first LeetCode call.
- `submission` (`when: before-commit`, the default) runs after files are
  rendered but before that submission's commit is created; it may mutate the
  workspace.
- `submission` (`when: after-commit`) runs after the commit object exists
  locally but before the branch ref is advanced. Observational only.
- `post` runs after the submission loop and before `flush()`. Files it writes
  become an optional post-sync commit chained after the last submission commit.

Because `flush()` is the only ref update and every hook runs before it, an
aborted run (any hook error with `onError: fail`) pushes **nothing**.

## Configuration shape

`hooks` is an optional top-level key. Omitting it disables hooks entirely. A
hook is a string (shorthand for `{ run }`) or an object.

| Field | Type | Default | Applies to | Meaning |
| --- | --- | --- | --- | --- |
| `run` | string | — | all | Shell command (required); rendered as a Nunjucks template |
| `cwd` | string | runner workspace | all | Working directory; rendered as a template |
| `timeoutMs` | number | `hooks.timeoutMs` | all | `0` disables the timeout |
| `env` | map | `{}` | all | Extra env vars merged over the scrubbed environment |
| `onError` | `fail` \| `warn` \| `skip` | `hooks.onError` | all (`skip` only for `submission`) | Error policy |
| `when` | `before-commit` \| `after-commit` | `before-commit` | `submission` | Before or after the commit is created |
| `commit` | string \| null | `"<prefix> post-sync"` | `post` | Message for the optional post commit; `null` disables it |

## Execution model

Each hook is spawned with:

- **argv** — `[shell, "-e", "-o", "pipefail", "-c", run]` (shell from
  `hooks.shell`, default `bash`).
- **stdin** — one JSON object (the context), then EOF.
- **stdout/stderr** — streamed to the action log, line-prefixed with
  `[leech:hook:<name>]`.
- **cwd** — `hook.cwd` if set, otherwise `process.cwd()`.
- **env** — `process.env` with sensitive values scrubbed, then `LEECH_*`
  variables added, then `hook.env` merged last.

### Environment scrubbing

Hooks are child processes and would otherwise inherit `INPUT_*` (which
`@actions/core` reads) plus cookies and tokens. Before spawning, leech deletes
keys matching:

- `/^INPUT_/`
- `LEETCODE_SESSION`, `LEETCODE_CSRF_TOKEN`, `LEECH_SESSION`, `LEECH_CSRF`
- `GITHUB_TOKEN`, `GH_TOKEN`
- `ACTIONS_RUNTIME_TOKEN`, `ACTIONS_ID_TOKEN_REQUEST_URL`,
  `ACTIONS_ID_TOKEN_REQUEST_TOKEN`

Pass a token deliberately through `hook.env` if a hook genuinely needs one.

## Hook context

### stdin JSON

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
  watermark: number; // unix seconds
  prefix: string; // commit.prefix
}

interface SubmissionHookContext extends RepoContext {
  hook: "submission";
  phase: "before-commit" | "after-commit";
  index: number; // 0-based position in this run
  total: number; // submissions in this run
  submission: TemplateContext["submission"];
  question: TemplateContext["question"];
  files: { path: string; asset: boolean }[]; // final repo-relative paths
  workspace: string; // LEECH_HOOK_DIR ("" when phase === "after-commit")
}

interface PostHookContext extends RepoContext {
  hook: "post";
  summary: SyncSummary; // scanned, skippedFiltered, synced, watermark
  finalWatermark: number;
  pushed: number; // submission commits created this run (post commit may add one)
  submissions: Array<{
    id: number;
    slug: string;
    lang: string;
    timestamp: number;
    files: string[];
  }>;
}
```

### Convenience env vars

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
| `LEECH_HOOK_DIR` | workspace dir; empty when not applicable |
| `LEECH_SUBMISSION_*` | submission hook only: `ID`, `TIMESTAMP`, `LANG` |
| `LEECH_QUESTION_SLUG`, `LEECH_QUESTION_TITLE`, `LEECH_FRONTEND_ID` | submission hook only |

### Command templating

`run`, `cwd`, and each `env` value are Nunjucks templates rendered with the
same environment as file/commit templates, honoring `render.throwOnUndefined`.
Rendering happens once, immediately before spawn. To emit a literal
<code v-pre>{{ }}</code> in a
shell command (an `awk` program, a heredoc), wrap it in
`{% raw %}…{% endraw %}`.

## Workspace protocol

Because leech commits through the blob/tree/commit APIs and not a working tree,
a `submission` (`before-commit`) hook runs against a private temp directory:

1. leech materializes the submission's **final** files into `<tmp>/…`, at their
   final repo-relative paths (already prefixed with `destination`, including
   downloaded assets). `LEECH_HOOK_DIR` points here; the context's `files[]`
   lists those paths.
2. The hook may edit files in place, add files, or delete files.
3. On success, leech walks `LEECH_HOOK_DIR` and commits its contents.

Encoding is preserved exactly:

- A file byte-identical to the materialized original keeps its original content
  and encoding, so untouched PNGs are never re-encoded.
- A changed or added file is read as bytes: `base64` if it contains a NUL byte,
  otherwise `utf-8`.
- A materialized file that is missing afterwards is dropped from the commit.

An `after-commit` hook has no workspace. A `post` hook starts with an **empty**
workspace; if it writes files (and `commit` is not `null`), leech creates one
extra commit chained after the last submission commit, with
`author.date = now`. That commit joins the same `flush()`, so the run stays
atomic — and because its message carries the prefix, it also becomes the next
run's watermark, which is correct.

## Error policy

Exit `0` succeeds. Anything else (or a timeout) is handled by the hook's
`onError`, falling back to `hooks.onError`:

| Hook | `fail` | `warn` | `skip` |
| --- | --- | --- | --- |
| `pre` | abort sync | log & continue | rejected |
| `submission` (`before-commit`) | abort sync | discard workspace, commit original files | skip this submission |
| `submission` (`after-commit`) | abort sync (still pre-push) | log & continue | treated as `warn` |
| `post` | abort before push | discard workspace, push without post commit | rejected |

Timeouts send `SIGTERM`, then `SIGKILL` after a grace period, and are reported
as hook errors. On any error the hook's workspace is discarded — never partially
committed.

## Edge cases

- **Spawn failure** (missing shell/command) is a hook error.
- **Writes outside `LEECH_HOOK_DIR`** are ignored; leech only reads the
  workspace.
- **`post.commit: null` with post files** discards them with a warning.
- **`after-commit` + `skip`** is treated as `warn` (the commit already exists
  locally, but nothing is pushed if a later `fail` occurs).
- **Concurrency** is inherited from the workflow's `concurrency` group; hooks
  that mutate a shared checkout are the user's responsibility.
