# Templates

Filenames, file contents, and the commit message are all
[Nunjucks](https://mozilla.github.io/nunjucks/) templates rendered once per
submission. `commit.prefix` is the one exception: it is a literal marker and is
not templated.

## Variables

### `submission`

| Variable | Description |
| --- | --- |
| `submission.id` | LeetCode submission id (number) |
| `submission.timestamp` | Unix seconds |
| `submission.date` | `YYYY-MM-DD` (UTC) |
| `submission.lang` | Language id (`python3`, `typescript`, …) |
| `submission.lang_ext` | File extension mapped from the language (`py`, `ts`, …) |
| `submission.code` | The solution code |
| `submission.status` | e.g. `Accepted` |
| `submission.runtime` | e.g. `42 ms` (`null` when unavailable) |
| `submission.memory` | e.g. `13.5 MB` (`null` when unavailable) |
| `submission.runtime_percentile` | Number (`null` when unavailable) |
| `submission.memory_percentile` | Number (`null` when unavailable) |

### `question`

| Variable | Description |
| --- | --- |
| `question.frontend_id` | e.g. `1` |
| `question.title` | e.g. `Two Sum` |
| `question.title_slug` | e.g. `two-sum` |
| `question.difficulty` | `Easy` \| `Medium` \| `Hard` |
| `question.tags` | Array of topic tag names |
| `question.url` | `https://leetcode.com/problems/<slug>/` |
| `question.content` | Raw problem HTML (convert with `toMarkdown` / `toTypst`) |
| `question.acceptance_rate` | Number (`null` when unavailable) |
| `question.is_paid_only` | Boolean |

Undefined variables render empty by default; set
`render.throwOnUndefined: true` to make them throw instead — useful for catching
typos.

## Built-in filters

Every standard
[Nunjucks filter](https://mozilla.github.io/nunjucks/templating.html#builtin-filters)
works: `join`, `lower`, `replace`, `trim`, `truncate`, `capitalize`,
`striptags`, `sort`, `groupby`, `dump`, `urlencode`, and so on. leech adds a set
of its own — see [Filters & conversion](/guide/filters).

## A worked example

This produces a frontmatter-rich README, a Typst document, and the raw code:

```yaml
files:
  - filename: "{{ question.title_slug }}/README.md"
    content: |
      ---
      title: "{{ question.title }}"
      id: {{ question.frontend_id }}
      difficulty: {{ question.difficulty }}
      date: "{{ submission.timestamp | datefmt('YYYY-MM-DD') }}"
      tags: [{% for t in question.tags %}"{{ t }}"{% if not loop.last %}, {% endif %}{% endfor %}]
      ---

      # {{ question.title }}

      {{ question.content | toMarkdown({ gfm: true }) }}

  - filename: "{{ question.title_slug }}.typ"
    content: |
      = {{ question.title }}

      {{ question.content | toTypst }}

      == Submission

      {{ submission.code | codeBlock(submission.lang) }}

  - filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}"
    content: "{{ submission.code }}"
```

## Filename sanitization

Rendered filenames are sanitized **per path segment**. Reserved characters
(`/\?%*:|"<>` and control characters) and whitespace become `-`; runs of dashes
collapse; leading and trailing dots and dashes are stripped; empty segments
become `untitled`. This means a problem title with a slash or colon can't escape
its directory or break on Windows checkouts.

## Collisions and overwrites

Filenames are not unique by construction. If two submissions render the same
path (for example, the same problem solved twice in the same language, or a
`README.md` per problem), the later commit **overwrites** the earlier file.
That's usually what you want — an improved solution replaces the old one — but
if you need history preserved, include a unique key in the filename:

```yaml
- filename: "{{ question.title_slug }}/{{ submission.id }}/{{ submission.lang }}.{{ submission.lang_ext }}"
  content: "{{ submission.code }}"
```

## Pitfall: no nested braces inside filter arguments

A filter argument is a plain expression, so reference variables directly:

```jinja
{{ submission.code | codeBlock(submission.lang) }}
```

Writing <code v-pre>codeBlock({{ submission.lang }})</code> is a Nunjucks syntax error. It looks
for a dict literal and fails with `parseAggregate: expected colon after dict
key`, reported against the template's line and column — which is easy to mistake
for a YAML error in the workflow file.
