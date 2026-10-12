# Assets

Problem descriptions often embed images hosted on `assets.leetcode.com`. By
default those URLs are left alone, which means your repository depends on a CDN
you don't control. Set `assets` and leech downloads them and rewrites the
references in both `toMarkdown` and `toTypst` output.

## The three modes

| `assets` | Storage | Reference in output |
| --- | --- | --- |
| `null` (default) | nothing is downloaded | original URL is kept |
| `""` | `<destination>/images/<slug>/<file>` | `/solutions/images/<slug>/<file>` (repo-root-absolute) |
| `"static"` | `static/images/<slug>/<file>` | `/images/<slug>/<file>` (the static root is stripped) |

The two non-null modes are for two different consumers:

```yaml
assets: "" # plain GitHub-style: images under the destination folder
# assets: "static" # SSG-style (Zola/Hugo): static/images/..., refs /images/...
```

- **`""`** keeps everything under the destination folder and references it with
  the full path. Good for plain rendering on GitHub or any tool that serves
  from the repo root.
- **`"static"`** follows the common static-site-generator convention: files live
  under a `static/` directory that mirrors the served root, so the reference
  drops the `static/` prefix. Zola, Hugo, and friends copy `static/` to the
  output root.

Filenames are derived from the last path segment of the URL and sanitized
(non-alphanumerics collapse to `-`), so the download is safe on every platform.

## Failure is not fatal

A failed download logs a warning and leaves the original URL in place. It does
**not** fail the sync. Your run still commits, just with a hotlinked image.

## Typst caveat

Root-absolute references are a markdown/SSG concept. In Typst,
`#image("/images/...")` is a *filesystem*-absolute path, which is rarely what
you want. If you're generating Typst, either keep `assets: null` and hotlink, or
post-process the references in a hook.
