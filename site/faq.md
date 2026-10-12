# FAQ

## The action fails with "session cookie is likely invalid or expired"

Your `LEETCODE_SESSION` cookie expired. Re-do [step 1 of
Getting started](/guide/getting-started#_1-get-your-leetcode-cookies) and update
both repository secrets. Note that leech treats an *expired* cookie as an error
even when LeetCode answers `HTTP 200` with an empty submission list, so you
won't silently sync nothing.

## Nothing is synced, but the run "succeeds"

Check, in order:

1. **Filters.** `filters.problems: []` and `languages: []` mean "no filtering" —
   but if you set them to non-empty lists you may be excluding everything.
2. **Watermark.** If your existing commits already carry `commit.prefix` and an
   author date at/after your submissions, they're considered synced. See
   [Watermark & atomicity](/design/watermark).
3. **Difficulty/tag filters** can drop locked/premium problems, since their
   metadata is unavailable.

## `config` keys are ignored / the action complains about inputs

`config` must be a **single inline YAML string**. Keep the `|` after `config:`
and indent the whole block. If you write it as a normal nested YAML mapping,
GitHub treats those keys as action inputs and drops them.

## `parseAggregate: expected colon after dict key`

You nested <code v-pre>{{ }}</code> inside a filter argument. Filter arguments are plain
expressions:

```jinja
{{ submission.code | codeBlock(submission.lang) }}
```

The error points at the template's line/column, which can look like a YAML error
in the workflow file — it isn't.

## The wrong files are being overwritten

Filenames that collide are overwritten by the later commit. If you want to keep
every version, make the path unique:

```yaml
- filename: "{{ question.title_slug }}/{{ submission.id }}/{{ submission.lang }}.{{ submission.lang_ext }}"
  content: "{{ submission.code }}"
```

## I changed `commit.prefix` and it re-synced everything

Expected. The prefix is the watermark marker, so changing it makes old commits
stop matching. Point it back, or accept the one-time re-sync. See
[Watermark & atomicity](/design/watermark).

## Can I sync into a different repository?

Yes. Set `repo.owner` and `repo.name` in the config. The `github-token` needs
`contents: write` on that repository.

## Can I keep only accepted submissions?

Yes — that's the default (`filters.status: accepted`). Use `status: all` to keep
failed/attempted submissions too (useful if you want to track wrong answers).

## My images 404 / I want my repo to be self-contained

Set `assets` to `""` (under `destination`) or `"static"` (SSG convention). See
[Assets](/guide/assets). A failed download only warns and leaves the original
URL.

## How do I stop it from making so many commits?

You can't change the one-commit-per-submission model, but you can limit what's
pulled with `filters.since` and use a schedule that runs often enough to keep
each batch small. On the first run against a long history, expect a lot of
commits in one push.

## A hook can't find my repository files

leech doesn't check out the target repo. Add an `actions/checkout` step before
the leech step. The hook's default `cwd` is the runner workspace.

## A hook can't see `GITHUB_TOKEN` or my secrets

By design — the hook environment is scrubbed. Pass values explicitly through the
hook's `env` map.

## Does it work with LeetCode China?

Yes. Set `site: leetcode.cn` and use cookies from `leetcode.cn`. The GraphQL
schema and cookie names are identical.

## How do I preview without committing?

Run with `dry-run: "true"` (action) or `--dry-run` (CLI). Everything renders and
hooks run, but no commit or ref update is created.
