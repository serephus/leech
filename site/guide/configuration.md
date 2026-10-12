# Configuration

Everything leech does is driven by the `config` input — a single inline YAML
string. This page is the complete reference; every key below is optional except
where noted, and omitting a key uses its default.

::: tip Why one big scalar?
GitHub Actions only accepts flat key-value pairs as action inputs, so structured
YAML can't be used for `config`. Keep the `|` after `config:` and indent the
whole thing underneath — otherwise the keys are parsed as workflow inputs and
silently ignored.
:::

## Action inputs

| Input | Required | Description |
| --- | --- | --- |
| `github-token` | yes | Token with `contents: write` on the target repo. |
| `leetcode-session` | yes | `LEETCODE_SESSION` cookie value. |
| `leetcode-csrf-token` | yes | `csrftoken` cookie value. |
| `config` | yes | Inline YAML configuration (below). |
| `dry-run` | no | Render and log only; create no commits. |
| `verbose` | no | Verbose logging. |

The action also sets three outputs: `synced`, `skipped-filtered`, and
`watermark`.

## Full reference

```yaml
repo: # optional; default: the repo the action runs in
  owner: serephus
  name: blog
branch: deploy # optional; default: the repo's default branch
destination: solutions # default: "solutions"; files are written under this folder
site: leetcode.com # default: "leetcode.com"; leetcode.com | leetcode.cn
assets: null # default; images are stored under <prefix>/images/<slug>/<file>,
#   where prefix is the destination (""), the configured value
#   (e.g. "static" → static/images/...), or nothing (null = no downloads)
filters:
  status: accepted # default: "accepted"; accepted | all
  languages: [python3] # default: []; only these languages
  excludeLanguages: [] # default: []; skip these languages
  problems: [two-sum] # default: []; only these problem slugs
  excludeProblems: [] # default: []; skip these problem slugs
  difficulty: [Easy] # default: []; only these difficulties (Easy | Medium | Hard)
  excludeDifficulty: [Hard] # default: []; skip these difficulties
  tags: [Array] # default: []; problems with any of these tags
  excludeTags: [Math] # default: []; problems with any of these tags
  since: "2024-01-01" # default: null; lower bound (date, ISO string, or unix seconds)
  until: null # default: null; upper bound
files: # optional; default: the markdown layout below
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
  prefix: "leech: " # default: "leech: "; message prefix; sync-commit marker
  message: "Sync {{ question.title }} ({{ submission.lang }})" # default
  authorName: leech-bot # default: "leech-bot"
  authorEmail: leech-bot@users.noreply.github.com # default
client:
  delayMs: 250 # default: 250; delay between LeetCode GraphQL calls (ms)
render:
  throwOnUndefined: false # default: false; throw on undefined template variables
hooks: # optional; see the Hooks guide
  shell: bash # default: "bash"; shell used to run hooks
  timeoutMs: 30000 # default: 30000; per-hook timeout (0 = no timeout)
  onError: fail # default: "fail"; fail | warn (submission also: skip)
  # pre: "echo starting"    # optional; runs once before syncing
  # submission:             # optional; runs once per submission
  #   when: before-commit   #   before-commit | after-commit (default: before-commit)
  #   run: "npx prettier --write ."
  # post:                   # optional; runs once before the final push
  #   run: "node index.mjs"
  #   commit: "leech: regenerate index"  # null disables the post commit
```

## Top-level keys

### `repo`

Optional. Defaults to the repository the action is running in. Set `owner` and
`name` to sync into a **different** repository (common when you keep the
workflow in a profile repo but the solutions elsewhere).

### `branch`

Optional. Defaults to the target repository's default branch. All sync commits
are pushed here, in a single ref update.

### `destination`

Default `"solutions"`. The folder that rendered filenames are resolved against.
Filenames are sanitized per path segment (see [Templates](/guide/templates)).

### `site`

Default `"leetcode.com"`. Set to `"leetcode.cn"` for LeetCode China. This
changes the GraphQL host, the problem URL, and the asset source — the cookie
names and schema are identical.

### `assets`

Controls local image downloads. See [Assets](/guide/assets) for the full
behaviour and the difference between `null`, `""`, and a static-root value.

### `filters`

Keeps or drops submissions before any per-submission API call. See the
[Filters](/guide/filters) section.

### `files`

The output layout. A list of `{ filename, content }` entries; each is rendered
per submission. Omit `files` to use the default layout: a `README.md` with YAML
frontmatter plus the converted description, and one code file per language.

### `commit`

- `prefix` — prepended to every sync commit message and used as the watermark
  marker. **Changing it resets the watermark** (see
  [Watermark & atomicity](/design/watermark)).
- `message` — the commit message template. `prefix` is a literal marker and is
  **not** templated; only `message` is.
- `authorName` / `authorEmail` — the commit author. The author *date* is always
  the submission timestamp, which is what makes the watermark work.

### `client`

- `delayMs` — delay between LeetCode GraphQL calls, in milliseconds. Raise it if
  you hit rate limits. The client also retries transient failures up to three
  attempts with a linear backoff.

### `render`

- `throwOnUndefined` — when `false` (default), undefined template variables
  render as empty strings. Set to `true` to make typos in templates fail the
  run instead of silently producing blank output.

### `hooks`

Optional. Runs your own shell commands at three lifecycle points. See the
[Hooks guide](/guide/hooks) for usage and
[Hooks lifecycle](/design/hooks-lifecycle) for the internals.
