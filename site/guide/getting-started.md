# Getting started

`leech` ships as a GitHub Action. You add it to the repository you want your
solutions synced into, give it your LeetCode cookies as secrets, and describe
the output you want in a config block.

## 1. Get your LeetCode cookies

leech authenticates the same way your browser does — with the session cookies,
not a password or API key.

1. Log in to [leetcode.com](https://leetcode.com) (or
   [leetcode.cn](https://leetcode.cn)).
2. Open DevTools → **Network**, reload the page, and click any request to
   `leetcode.com`.
3. In the request headers, copy the `cookie` header value and extract:
   - `LEETCODE_SESSION`
   - `csrftoken`

On LeetCode China use `site: leetcode.cn` in the config. The GraphQL API, the
cookie names, and the schema are the same.

::: warning Cookies expire
`LEETCODE_SESSION` is a session cookie. When it expires the action fails with a
"session cookie is likely invalid or expired" error — repeat the steps above and
update the secret. This is the single most common failure.
:::

## 2. Add repository secrets

In your **solutions** repository (not the leech repo), go to
**Settings → Secrets and variables → Actions** and add:

| Secret | Value |
| --- | --- |
| `LEETCODE_SESSION` | the `LEETCODE_SESSION` cookie |
| `LEETCODE_CSRF_TOKEN` | the `csrftoken` cookie |

## 3. Add a workflow

Create `.github/workflows/leech.yml`:

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
      - uses: serephus/leech@v0.1.5 # release tag (the main branch won't work)
        with:
          github-token: ${{ github.token }}
          leetcode-session: ${{ secrets.LEETCODE_SESSION }}
          leetcode-csrf-token: ${{ secrets.LEETCODE_CSRF_TOKEN }}
          dry-run: "false" # optional; render and log only, create no commits
          verbose: "false" # optional; verbose logging
          # The `|` after `config:` means its value is one inline YAML string
          # (the leech configuration), not structured keys of this workflow
          # file — keep it indented under `config:`.
          # A structured YAML mapping won't work because GitHub Actions only
          # accepts flat key-value pairs as action inputs.
          config: |
            destination: "solutions"
            site: leetcode.com
            filters:
              status: accepted
              languages: [python3, typescript]
            commit:
              prefix: "leech: "
              message: "{{ question.title }} ({{ submission.lang }})"
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

                  {{ question.content | toMarkdown({ gfm: true }) }}
              - filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}"
                content: "{{ submission.code }}"
```

The tag should match the latest release — the current one is
<ActionTag />. If you'd rather not update the workflow, note that
`@main` will **not** work: `dist/` is built and attached to release tags, not
committed to the branch.

## 4. Run it

Trigger the workflow manually (**Actions → Sync LeetCode → Run workflow**) or
wait for the schedule. On success you'll get one commit per newly discovered
submission, each authored at the original submission time.

If it fails, see [Limitations](/limitations) and the [FAQ](/faq). The most
common causes are expired cookies, a missing `permissions: contents: write`, and
`config` not being a single indented YAML scalar.

## Next steps

- [Configuration](/guide/configuration) — every option and its default.
- [Templates](/guide/templates) — the variables you can use.
- [Filters & conversion](/guide/filters) — markdown/Typst conversion options.
- [Hooks](/guide/hooks) — run prettier, generate an index, notify a bot.
- [Local CLI](/guide/cli) — build the same pipeline outside Actions.
