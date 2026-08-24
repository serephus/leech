# leech

Note: The whole project is vibed by DS4 flash.

A cookie-authenticated [LeetCode](https://leetcode.com) sync GitHub Action.

- **Templated everything** — filename, content, and commit message are
  [Nunjucks](https://mozilla.github.io/nunjucks/) templates; one submission maps
  to one commit and may produce any number of files.
- **Content Conversion** — the raw problem HTML is available as
  `question.content`; convert it with the `toMarkdown` filter (`{ gfm: true }`
  enables GitHub-flavored tables, strikethrough, and task lists) or the
  `toTypst` filter (custom rules for `<sup>`/`<sub>`, code blocks, and tables).
- **Local assets** — images linked from problem descriptions are downloaded
  into `<prefix>/images/<slug>/` and referenced with repo-root-absolute paths
  in the markdown/typst output, so the repo stays self-contained
  (see [Assets](#assets)).
- **Submission filtering** — status, language, problem, and time-window filters.

## Quickstart

In your solutions repository:

1. Get your cookies: log in to leetcode.com, open DevTools → Network, reload,
   and copy `LEETCODE_SESSION` and `csrftoken` from the `cookie` request header.
   (On LeetCode China, log in to leetcode.cn and set `site: leetcode.cn` in the
   config — the GraphQL API, cookie names, and GraphQL schema are the same.)
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
      - uses: serephus/leech@v8 # release tag (the main branch won't work)
        with:
          github-token: ${{ github.token }}
          leetcode-session: ${{ secrets.LEETCODE_SESSION }}
          leetcode-csrf-token: ${{ secrets.LEETCODE_CSRF_TOKEN }}
          dry-run: "false"          # optional; render and log only, create no commits
          verbose: "false"          # optional; verbose logging
          # The `|` after `config:` means its value is one inline YAML string
          # (the leech configuration), not structured keys of this workflow
          # file — keep it indented under `config:`.
          # the structured yaml config won't work because github action
          # only accept flatten key-value pairs inputs
          config: |
            destination: "solutions"
            site: leetcode.com
            assets: null # default; null = no downloads, "" = under destination, path = static root
            filters:
              status: accepted
              languages: [python3, typescript]
              excludeLanguages: []
              problems: [] # empty means no filtering, same for languages
              excludeProblems: []
              since: null
              until: null
            commit:
              prefix: "leech: "
              message: "{{ question.title }} ({{ submission.lang }})"
              authorName: leech-bot
              authorEmail: leech-bot@users.noreply.github.com
            client:
              delayMs: 250
            render:
              throwOnUndefined: false
            files:
              - filename: "{{ question.title_slug }}/README.md"
                content: |
                  ---
                  title: "{{ question.title }}"
                  slug: "{{ question.title_slug }}"
                  difficulty: {{ question.difficulty }}
                  timestamp: {{ submission.timestamp }}
                  ---

                  # {{ question.title }}

                  {{ question.content | toMarkdown({ gfm: true, superscript: ["^", ""], subscript: ["_", ""] }) }}
              - filename: "{{ question.title_slug }}.typ"
                content: |
                  = {{ question.title }}

                  {{ question.content | toTypst({ superscript: ["^", ""], subscript: ["_", ""] }) }}

                  == Submission

                  {{ submission.code | codeBlock(submission.lang) }}
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

Every option with its default value. Omit any key to use the default.

```yaml
repo:                       # optional; default: the repo the action runs in
  owner: serephus
  name: blog
branch: deploy              # optional; default: the repo's default branch
destination: solutions      # default: "solutions"; files are written under this folder
site: leetcode.com          # default: "leetcode.com"; leetcode.com | leetcode.cn
assets: null               # default; images are stored under <prefix>/images/<slug>/<file>,
                            #   where prefix is the destination (""), the configured value
                            #   (e.g. "static" → static/images/...), or nothing (null = no downloads)
filters:
  status: accepted          # default: "accepted"; accepted | all
  languages: [python3]      # default: []; only these languages
  excludeLanguages: []      # default: []; skip these languages
  problems: [two-sum]       # default: []; only these problem slugs
  excludeProblems: []       # default: []; skip these problem slugs
  since: "2024-01-01"       # default: null; lower bound (date, ISO string, or unix seconds)
  until: null               # default: null; upper bound
files:                      # optional; default: the markdown layout below
  - filename: "{{ question.title_slug }}/README.md"
    content: |-
      ---
      title: "{{ question.title }}"
      id: {{ question.frontend_id }}
      slug: "{{ question.title_slug }}"
      difficulty: {{ question.difficulty }}
      lang: "{{ submission.lang }}"
      status: "{{ submission.status }}"
      timestamp: {{ submission.timestamp }}
      date: "{{ submission.timestamp | datefmt('YYYY-MM-DD') }}"
      tags: [{% for t in question.tags %}"{{ t }}"{% if not loop.last %}, {% endif %}{% endfor %}]
      ---

      # {{ question.title }}

      {{ question.content | toMarkdown({ gfm: true }) }}
  - filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}"
    content: "{{ submission.code }}"
commit:
  prefix: "leech: "          # default: "leech: "; message prefix; sync-commit marker
  message: "{{ question.title }} ({{ submission.lang }})"  # default
  authorName: leech-bot      # default: "leech-bot"
  authorEmail: leech-bot@users.noreply.github.com  # default
client:
  delayMs: 250              # default: 250; delay between LeetCode GraphQL calls (ms)
render:
  throwOnUndefined: false   # default: false; throw on undefined template variables
```

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

> **Tip — no nested `{{ }}` inside filter arguments.** A filter argument is a
> plain expression, so reference variables directly:
> `{{ submission.code | codeBlock(submission.lang) }}`. Writing
> `{{ submission.code | codeBlock({{ submission.lang }}) }}` is a Nunjucks
> syntax error — it looks for a dict literal and fails with
> `parseAggregate: expected colon after dict key` (reported against the
> template's line/column, which can be mistaken for a YAML error in the
> workflow file).

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
`superscript` / `subscript` (wrapper `[prefix, suffix]` around `<sup>`/`<sub>`
content, default `["^", "^"]` / `["~", "~"]`; `false` renders inline),
`headingStyle` (`atx` | `setext`), `hr`, `bulletListMarker` (`-` | `*` | `+`),
`codeBlockStyle` (`fenced` | `indented`), `fence` (` ``` ` | `~~~`),
`emDelimiter` (`*` | `_`), `strongDelimiter` (`**` | `__`), `linkStyle`
(`inlined` | `referenced`), `linkReferenceStyle`
(`full` | `collapsed` | `shortcut`).
- **`toTypst(options?)`** — [Typst](https://typst.app) markup. Options:
  `headingPrefixes` (prefix per heading level 1-6, default
  `["", "= ", "== ", ...]`), `codeFence` (default ` ``` `), `escape`
  (default `true`), `hr` (default `#line(length: 100%)`), and `superscript` /
  `subscript` (wrapper `[prefix, suffix]`, default `["^", ""]` / `["_", ""]`;
  `false` renders inline).

The same converters are available as factories for embedding code:
`makeToMarkdown(options)` and `makeToTypst(options)`. `toGfm` is kept as an
alias for `toMarkdown({ gfm: true })`.

Rendered filenames are sanitized per path segment: reserved characters
(`/\?%*:|"<>` and control chars) and whitespace become `-`, runs of dashes
collapse, leading/trailing dots and dashes are stripped, and empty segments
become `untitled`.

### Assets

Images linked from problem descriptions (e.g. `https://assets.leetcode.com/...`)
are downloaded automatically and their references are rewritten in both
`toMarkdown` and `toTypst` output. `assets` controls where they go:

- `null` (default) — don't download; original URLs are kept.
- `""` — store under the `destination` folder: `solutions/images/<slug>/<file>`,
  referenced repo-root-absolute as `/solutions/images/<slug>/<file>`.
- `"static"` — store at `static/images/<slug>/<file>`, referenced as
  `/images/<slug>/<file>` (the configured value is the static root and is
  stripped from references — the SSG convention).

```yaml
assets: ""        # plain GitHub-style: images under the destination folder
# assets: "static" # SSG-style (Zola/Hugo): static/images/..., refs /images/...
```

Note that root-absolute references are a markdown/SSG concept; in Typst
`#image("/images/...")` is a filesystem-absolute path, so keep that in mind for
Typst output. A failed download logs a warning and leaves the original URL; it
does not fail the sync.

If `files` is omitted, the default markdown layout is used: per problem a
`README.md` (YAML frontmatter + converted description) and one code file per
language.

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

The action is referenced by tag (`uses: serephus/leech@v8`), `dist/` is not
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
