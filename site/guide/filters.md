# Filters & conversion

Most of leech's expressiveness comes from template filters. All standard
Nunjucks filters are available, plus the custom ones below. They work in
filename, content, and commit-message templates (and in hook command strings).

## Custom filters

### `datefmt(value, format = "YYYY-MM-DD")`

Format a Unix-seconds timestamp (UTC). Supported tokens: `YYYY MM DD HH mm ss`.

```jinja
{{ submission.timestamp | datefmt('YYYY/MM/DD') }}
```

### `slugify(value)`

Lowercase, trim, collapse non-alphanumerics to `-`, strip leading/trailing
dashes.

```jinja
{{ question.title | slugify }}
```

### `pad(value, width = 4, char = "0")`

Pad with `char` to at least `width`. It never truncates; a multi-character
`char` repeats and is cut to fit.

```jinja
{{ question.frontend_id | pad(4) }}
{{ question.frontend_id | pad(4, '*') }}
```

### `ext(lang)`

Map a LeetCode language id to a file extension (fallback: the id itself).

```jinja
{{ submission.lang | ext }}
```

### `regexReplace(value, pattern, replacement, flags?)`

Replace matches of a regular expression. Nunjucks' built-in `replace` only
handles literal strings. Pass `'g'` in `flags` for all matches.

```jinja
{{ submission.code | regexReplace('\s+$', '', 'm') }}
```

### `codeBlock(content, lang?, options?)`

Wrap content in a fenced code block with an optional language id. The fence is
chosen so it cannot collide with the content (longest run of fence characters
plus one). Options: `fence` (`` ` `` or `~`, default `` ` ``).

```jinja
{{ submission.code | codeBlock(submission.lang_ext) }}
```

### `toMarkdown(html, options?)` and `toTypst(html, options?)`

Convert the raw problem HTML. See [conversion options](#conversion-options)
below.

## Conversion options

Each conversion filter accepts an options object as a template argument:

```jinja
{{ question.content | toMarkdown({ codeBlockStyle: "indented", gfm: true, tables: false }) }}
```

### `toMarkdown(options?)`

| Option | Default | Notes |
| --- | --- | --- |
| `gfm` | `false` | Enable GitHub-flavored tables, strikethrough, and task lists |
| `tables` | `true` | Only applies when `gfm` is enabled |
| `strikethrough` | `true` | Only applies when `gfm` is enabled |
| `taskListItems` | `true` | Only applies when `gfm` is enabled |
| `superscript` | `["^", "^"]` | Wrapper `[prefix, suffix]` around `<sup>`; `false` renders inline |
| `subscript` | `["~", "~"]` | Wrapper `[prefix, suffix]` around `<sub>`; `false` renders inline |
| `headingStyle` | `atx` | `atx` \| `setext` |
| `hr` | `* * *` | Thematic break |
| `bulletListMarker` | `-` | `-` \| `*` \| `+` |
| `codeBlockStyle` | `fenced` | `fenced` \| `indented` |
| `fence` | ` ``` ` | Fence characters |
| `emDelimiter` | `_` | `*` \| `_` |
| `strongDelimiter` | `**` | `**` \| `__` |
| `linkStyle` | `inlined` | `inlined` \| `referenced` |
| `linkReferenceStyle` | `full` | `full` \| `collapsed` \| `shortcut` |

A common LeetCode-specific choice disables the caret/underscore wrappers that
collide with markdown emphasis:

```jinja
{{ question.content | toMarkdown({ gfm: true, superscript: ["^", ""], subscript: ["_", ""] }) }}
```

### `toTypst(options?)`

[Typst](https://typst.app) markup, with custom rules for `<sup>`/`<sub>`, code
blocks, and tables.

| Option | Default | Notes |
| --- | --- | --- |
| `headingPrefixes` | `["", "= ", "== ", …]` | Prefix per heading level 1–6 |
| `codeFence` | ` ``` ` | Fence characters |
| `escape` | `true` | Escape Typst special characters, including `[`/`]`, so unmatched brackets in problem strings don't break the document |
| `hr` | `#line(length: 100%)` | Thematic break |
| `superscript` | `["#super[", "]"]` | Real Typst superscript; `false` renders inline |
| `subscript` | `["#sub[", "]"]` | Real Typst subscript; `false` renders inline |

## Using the converters from code

The same converters are exported as factories for embedding:

- `makeToMarkdown(options)`
- `makeToTypst(options)`

`toGfm` is kept as an alias for `toMarkdown({ gfm: true })`.
