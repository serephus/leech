# leech

Note: The whole project is vibed by DS4 flash.

A cookie-authenticated [LeetCode](https://leetcode.com) sync GitHub Action.

- **Templated everything** — filename, content, and commit message are
  [Nunjucks](https://mozilla.github.io/nunjucks/) templates; one submission maps
  to one commit and may produce any number of files.
- **Problem descriptions** — the raw problem HTML is available as
  `question.content`; convert it with the `toMarkdown` filter (`{ gfm: true }`
  enables GitHub-flavored tables, strikethrough, and task lists) or the
  `toTypst` filter (custom rules for `<sup>`/`<sub>`, code blocks, and tables).
- **Submission filtering** — status, language, problem, and time-window filters.
- **Robust watermark** — no state files: the last synced submission is derived
  from commit history (see [Watermark](#watermark)).
- **Overwrite semantics** — a re-submitted solution overwrites its file; the
  latest submission always wins.
- **Local CLI** — run the exact same pipeline from your shell for testing.
- **Tag-based dist releases** — a workflow bundles `dist/` and moves the tag to
  the bundle commit, so `uses: serephus/leech@vX.Y.Z` always resolves to a
  working action (see [Dist workflow](#dist-workflow)).

## How it works

1. Fetch submissions newer than the watermark via LeetCode's GraphQL API
   (`submissionList` query, authenticated with your cookies).
2. Apply filters.
3. For each remaining submission (oldest first): fetch full details
   (code, runtime, memory, percentiles) and the problem description via
   LeetCode's GraphQL API, render the configured files, and create **one git
   commit per submission** with `author.date = submission timestamp`.
4. Push the branch ref once at the end of the sync — all commits land in a
   single ref update, so a run is atomic (either every submission lands or
   none does).

## Quickstart

In your solutions repository:

1. Get your cookies: log in to leetcode.com, open DevTools → Network, reload,
   and copy `LEETCODE_SESSION` and `csrftoken` from the `cookie` request header.
2. Add them as repository secrets (`LEETCODE_SESSION`, `LEETCODE_CSRF_TOKEN`).
3. Add a workflow:

```yaml
name: Sync LeetCode
on:
  workflow_dispatch:
  schedule:
    - cron: "0 8 * * 6"

permissions:
  contents: write

concurrency:
  group: leech-sync
  cancel-in-progress: false # queue instead of cancelling: only one sync runs at a time

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: serephus/leech@v2 # latest release tag (see Dist workflow)
        with:
          github-token: ${{ github.token }}
          leetcode-session: ${{ secrets.LEETCODE_SESSION }}
          leetcode-csrf-token: ${{ secrets.LEETCODE_CSRF_TOKEN }}
          # The `|` after `config:` means its value is one inline YAML string
          # (the leech configuration), not structured keys of this workflow
          # file — keep it indented under `config:`.
          # the structured yaml config won't work because github action
          # only accept flatten key-value pairs inputs
          config: |
            destination: "solutions"
            filters:
              status: accepted
              languages: [python3, typescript]
            commit:
              prefix: "leech:"
              message: "Sync {{ question.title }} ({{ submission.lang }})"
            files:
              - filename: "{{ question.title_slug }}/README.md"
                content: |-
                  ---
                  title: "{{ question.title }}"
                  slug: "{{ question.title_slug }}"
                  difficulty: {{ question.difficulty }}
                  timestamp: {{ submission.timestamp }}
                  ---

                  # {{ question.title }}

                  {{ question.content | toMarkdown({ gfm: true }) }}
              - filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}"
                content: "{{ submission.code }}"
```

Action inputs:

| Input | Required | Description |
| --- | --- | --- |
| `github-token` | yes | Token with `contents: write` on the target repo. |
| `leetcode-session` | yes | `LEETCODE_SESSION` cookie value. |
| `leetcode-csrf-token` | yes | `csrftoken` cookie value. |
| `config` | yes | Inline YAML configuration (below). |
| `dry-run` | no | Render and log only; create no commits. |
| `verbose` | no | Verbose logging. |

## Configuration reference

```yaml
repo:                       # optional; defaults to the repo the action runs in
  owner: serephus
  name: my-solutions
branch: main                # optional; defaults to the repo's default branch
destination: solutions      # optional; files are written under this folder (default: solutions)
filters:
  status: accepted          # accepted | all (default: accepted)
  languages: [python3]      # only these languages
  excludeLanguages: []      # skip these languages
  problems: [two-sum]       # only these problem slugs
  excludeProblems: []       # skip these problem slugs
  since: "2024-01-01"       # optional lower bound (date, ISO string, or unix seconds)
  until: null               # optional upper bound
files:                      # optional; defaults to the markdown layout below
  - filename: "{{ question.title_slug }}/README.md"
    content: "{{ question.content | toMarkdown({ gfm: true }) }}"
  - filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}"
    content: "{{ submission.code }}"
commit:
  prefix: "leech: "          # message prefix; also the sync-commit marker (see Watermark)
  message: "Sync {{ question.title }} ({{ submission.lang }})"
  authorName: leech-bot
  authorEmail: leech-bot@users.noreply.github.com
client:
  delayMs: 250              # delay between LeetCode GraphQL calls (rate-limit courtesy)
render:
  throwOnUndefined: false   # throw on undefined template variables (default: render empty)
```

If `files` is omitted, the default markdown layout is used: per problem a
`README.md` (YAML frontmatter + converted description) and one code file per
language.

## Templates

Variables available in filename, content, and commit-message templates
(`commit.prefix` is a literal marker and is not templated).

`submission`:

- `submission.id` — number, LeetCode submission id
- `submission.timestamp` — number, unix seconds
- `submission.date` — `YYYY-MM-DD` (UTC)
- `submission.lang` — language id (`python3`, `typescript`, …)
- `submission.lang_ext` — file extension mapped from lang (`py`, `ts`, …)
- `submission.code` — the solution code
- `submission.status` — e.g. `Accepted`
- `submission.runtime` — e.g. `42 ms` (`null` when unavailable)
- `submission.memory` — e.g. `13.5 MB` (`null` when unavailable)
- `submission.runtime_percentile` — number (`null` when unavailable)
- `submission.memory_percentile` — number (`null` when unavailable)

`question`:

- `question.frontend_id` — e.g. `1`
- `question.title` — e.g. `Two Sum`
- `question.title_slug` — e.g. `two-sum`
- `question.difficulty` — `Easy` | `Medium` | `Hard`
- `question.tags` — array of topic tag names
- `question.url` — `https://leetcode.com/problems/<slug>/`
- `question.content` — raw problem HTML (convert with the `toMarkdown` /
  `toTypst` filters)
- `question.acceptance_rate` — number (`null` when unavailable)
- `question.is_paid_only` — boolean

### Template filters

Every standard
[Nunjucks filter](https://mozilla.github.io/nunjucks/templating.html#builtin-filters)
works (`join`, `lower`, `replace`, `trim`, `truncate`, `capitalize`, `striptags`,
`sort`, `groupby`, `dump`, `urlencode`, …), plus the custom filters below.
Undefined variables render empty; set `render.throwOnUndefined: true` in the
config to make them throw instead (useful for catching typos in templates).

- **`datefmt(value, format = "YYYY-MM-DD")`** — format a unix-seconds timestamp
  (UTC). Tokens: `YYYY MM DD HH mm ss`. E.g.
  `{{ submission.timestamp | datefmt('YYYY/MM/DD') }}` → `2024/01/01`.
- **`slugify(value)`** — lowercase, trim, collapse non-alphanumerics to `-`,
  strip leading/trailing dashes. E.g. `{{ question.title | slugify }}` → `two-sum`.
- **`pad(value, width = 4, char = "0")`** — pad with `char` to at least `width`
  (no truncation; multi-char `char` repeats and is cut to fit). E.g.
  `{{ question.frontend_id | pad(4) }}` → `0001`, `{{ question.frontend_id | pad(4, '*') }}` → `***1`.
- **`ext(lang)`** — map a LeetCode language id to a file extension (fallback:
  the id itself). E.g. `{{ submission.lang | ext }}` → `py`.
- **`regexReplace(value, pattern, replacement, flags?)`** — replace matches of
  a regular expression (Nunjucks `replace` only handles literal strings). Pass
  `'g'` in `flags` for all matches. E.g.
  `{{ submission.code | regexReplace('\s+$', '', 'm') }}` strips trailing whitespace.
- **`codeBlock(content, lang?, options?)`** — wrap content in a fenced code
  block with an optional language id. The fence is chosen so it cannot collide
  with the content (longest fence-char run plus one). Options: `fence`
  (`` ` `` | `~`, default `` ` ``). E.g.
  `{{ submission.code | codeBlock(submission.lang_ext) }}`.
- **`toMarkdown(html, options?)`** — convert HTML to markdown; pass
  `{ gfm: true }` for GitHub-flavored tables/strikethrough/task lists. See
  [Conversion options](#conversion-options).
- **`toTypst(html, options?)`** — convert HTML to [Typst](https://typst.app)
  markup. See [Conversion options](#conversion-options).

### Conversion options

Each conversion filter accepts an options object as a template argument, e.g.
`{{ question.content | toMarkdown({ codeBlockStyle: "indented", gfm: true, tables: false }) }}`.

- **`toMarkdown(options?)`** — markdown. Options: `gfm` (default `false`;
enable GitHub-flavored tables/strikethrough/task lists), `tables`, `strikethrough`,
`taskListItems` (default `true` each; only apply when `gfm` is enabled),
`headingStyle` (`atx` | `setext`), `hr`, `bulletListMarker` (`-` | `*` | `+`),
`codeBlockStyle` (`fenced` | `indented`), `fence` (` ``` ` | `~~~`),
`emDelimiter` (`*` | `_`), `strongDelimiter` (`**` | `__`), `linkStyle`
(`inlined` | `referenced`), `linkReferenceStyle`
(`full` | `collapsed` | `shortcut`).
- **`toTypst(options?)`** — [Typst](https://typst.app) markup. Options:
  `headingPrefixes` (prefix per heading level 1-6, default
  `["", "= ", "== ", ...]`), `codeFence` (default ` ``` `), `escape`
  (default `true`), and `hr` (default `#line(length: 100%)`).

The same converters are available as factories for embedding code:
`makeToMarkdown(options)` and `makeToTypst(options)`. `toGfm` is kept as an
alias for `toMarkdown({ gfm: true })`.

Rendered filenames are sanitized per path segment: reserved characters
(`/\?%*:|"<>` and control chars) and whitespace become `-`, runs of dashes
collapse, leading/trailing dots and dashes are stripped, and empty segments
become `untitled`.

## Watermark

A submission is "already synced" when a commit on the branch whose message
starts with `commit.prefix` has `author.date` >= the submission timestamp —
leech stamps every sync commit with the submission's timestamp as the author
date. The watermark is found by walking the branch history (newest first,
100 commits per page) and taking the newest author date among prefixed commits.

- There is no state file and nothing to migrate.
- **Changing `commit.prefix` resets the watermark** — old sync commits stop
  matching and everything is re-synced (overwriting existing files, one commit
  per submission). Pick a prefix and keep it.
- Migrating from another tool: point `commit.prefix` at the header your old
  sync commits use (e.g. `Sync LeetCode submission` or `[LeetCode Sync]`) to
  inherit the watermark from existing history.

Existing files are **overwritten** when a submission re-syncs, so an improved
solution replaces the old file. To avoid overwrites, include the submission id
in the filename, e.g. `{{ submission.id }}/...`.

## Filters

- `status: accepted` keeps only submissions whose status display is `Accepted`.
- Language and problem filters are exact matches against LeetCode ids
  (`python3`, `two-sum`, …).
- `since`/`until` accept unix seconds, a numeric string, or an ISO date
  (`2024-01-01`, `2024-01-01T12:00:00Z`).

## Local CLI

Build and run the same pipeline locally (no GitHub Actions needed):

```sh
pnpm build
node dist/cli.js \
  --config @config.yaml \
  --session "$LEETCODE_SESSION" --csrf "$LEETCODE_CSRF_TOKEN" \
  --token "$GITHUB_TOKEN" --repo serephus/my-solutions \
  --dry-run
```

`--config` accepts an inline YAML string or a path prefixed with `@`. Env
fallbacks: `LEECH_CONFIG`, `LEETCODE_SESSION`, `LEETCODE_CSRF_TOKEN`,
`GITHUB_TOKEN`. Run with `--dry-run` first to preview the commits.

## Dist workflow

The action is referenced by tag (`uses: serephus/leech@v2`), `dist/` is not
committed to the repo (gitignored); CI just verifies it builds. The Dist
workflow bundles it into the tag at release time.

## Development

```sh
nix develop        # node 24 + pnpm dev shell (flake.nix)
nix build          # build the packaged CLI (packages.default)
nix run .# -- --help  # run the packaged CLI without installing
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest
pnpm build         # esbuild -> dist/index.js + dist/cli.js
```

The flake packages the CLI (`nix build`, `nix run .#`); when `pnpm-lock.yaml`
changes, `nix build` reports the new dependency hash to paste into
`flake.nix`'s `fetchPnpmDeps`.

## Roadmap

- Hooks (pre/post sync, per-submission).

## Notes and caveats

- LeetCode session cookies expire; refresh the secrets when the action fails
  with the "session cookie is likely invalid or expired" error (LeetCode
  answers HTTP 401/403 for rejected cookies, and HTTP 200 with an empty list
  for expired ones — leech treats the latter as an error too).
- LeetCode's API is unofficial and changes without notice; all requests go to
  `POST /graphql` (the old `GET /api/submissions/` list endpoint no longer
  exists).

## References

- [joshcai/leetcode-sync](https://github.com/joshcai/leetcode-sync)

## License

GLWTPL
