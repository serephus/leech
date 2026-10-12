# Limitations

leech is deliberately narrow. Knowing what it does *not* do will save you time.

## LeetCode side

- **Unofficial API.** All requests go to `POST /graphql`, which LeetCode does
  not document or guarantee. It can change without notice. (The old
  `GET /api/submissions/` endpoint no longer exists — leech doesn't use it.)
- **Session cookies expire.** `LEETCODE_SESSION` is a browser session cookie.
  When it expires, the action fails with a "session cookie is likely invalid or
  expired" error. You must refresh both secrets from DevTools. There is no
  long-lived token.
- **Locked/premium problems are dropped when question filters are active.**
  Difficulty and tag filters need problem metadata; if a problem's metadata
  can't be fetched (locked, premium, or deleted), it's dropped rather than
  guessed at. With only submission-level filters, it never needs the metadata.
- **Rate limits are real.** leech is single-threaded and sleeps
  `client.delayMs` between calls (default 250 ms). Large first-time syncs take a
  while. Raise `delayMs` if you're throttled.
- **Chinese site is a host switch, not a different schema.** `site: leetcode.cn`
  changes the host, URLs, and asset source; cookies and schema are the same.

## Git side

- **One commit per submission.** This is the design, but it does mean a
  first-time sync of years of history produces a large number of commits, all in
  a single push. There is no squash option.
- **Re-syncs overwrite files with the same path.** An improved solution replaces
  the old file. To preserve every attempt, include `submission.id` (or another
  unique key) in the filename.
- **Changing `commit.prefix` resets the watermark** and re-syncs everything.
  Pick a prefix and keep it, or point it at your previous tool's commit header
  to inherit history.
- **Requires `permissions: contents: write`.** Without it the ref update fails.
- **`force: false`.** If the branch moves between the watermark scan and the
  push, the run is rejected rather than clobbering the new commits. Use a
  `concurrency` group (and `cancel-in-progress: false`) to serialize runs.
- **`@main` doesn't work as a ref.** `dist/` is built and attached to release
  tags, not committed to the branch. Reference a tag (`@<ActionTag />`).

## Hooks

- **No Windows.** leech targets `ubuntu-latest`; `bash` is the default shell.
- **No repository checkout by default.** Hooks run in the action's environment.
  If a hook needs the repo's files, add `actions/checkout` to the workflow
  first.
- **No inherited secrets.** The child environment is scrubbed of `INPUT_*`,
  `GITHUB_TOKEN`/`GH_TOKEN`, cookies, and `ACTIONS_*` tokens. Pass what a hook
  needs explicitly via `env`.
- **A failing hook can abort the whole run.** With `onError: fail` (the
  default), one bad command means nothing is pushed. Use `warn` or `skip` where
  that's too strict.

## Configuration ergonomics

- **`config` must be one inline YAML string.** GitHub Actions only accepts flat
  key-value inputs, so a structured YAML mapping is silently treated as
  unknowns. Keep the `|` and the indentation.
- **No nested <code v-pre>{{ }}</code> inside filter arguments.** Filter
  arguments are plain expressions: use `codeBlock(submission.lang)`, not
  <code v-pre>codeBlock({{ submission.lang }})</code>.
- **Undefined variables render empty by default.** Set
  `render.throwOnUndefined: true` while developing templates so typos fail
  loudly.
- **Root-absolute asset paths are a markdown/SSG concept.** In Typst,
  `#image("/images/...")` is a filesystem-absolute path, so asset rewriting is
  of limited use there.

## Platform

- **Node ≥ 20** for the CLI; the action runs on the runner's Node 24.
- **Nix users:** when `pnpm-lock.yaml` changes, `nix build` reports the new
  dependency hash to paste into `flake.nix`'s `fetchPnpmDeps`.
- **Not affiliated with LeetCode.** Use at your own risk, and mind LeetCode's
  terms of service.
