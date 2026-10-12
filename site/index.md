---
layout: home

hero:
  name: leech
  text: LeetCode → Git, in any shape you like
  tagline: A cookie-authenticated GitHub Action that syncs your LeetCode submissions into your repository using Nunjucks templates — one commit per submission, with markdown or Typst output.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it's designed
      link: /design/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/serephus/leech

features:
  - title: Templated everything
    details: Filenames, file contents, and commit messages are all Nunjucks templates. One submission maps to one commit and can produce any number of files, in any directory layout.
  - title: Markdown & Typst
    details: The raw problem HTML is exposed as question.content. Convert it with toMarkdown (GFM tables, strikethrough, task lists) or toTypst (real super/subscripts, escaping, code fences).
  - title: Self-contained repositories
    details: Images in problem descriptions are downloaded into the repo and their references rewritten, so your solutions render offline and don't rot when a CDN URL changes.
  - title: Sync only what you want
    details: Filter by status, language, problem, difficulty, tags, and a time window. Keep the noise out of your history.
  - title: Hooks at every step
    details: Run your own shell commands before a sync, per submission (and mutate exactly what gets committed), or once at the end to regenerate an index.
  - title: Atomic, one commit per submission
    details: Commits are built through the GitHub API without a checkout, then pushed in a single ref update. A run either lands every submission or none.
---

## What it is

`leech` logs into LeetCode with **your** session cookies and pulls your accepted
submissions through LeetCode's GraphQL API. For each one it renders a set of
files from a template you control, commits them with the submission's own
timestamp, and pushes once. There is no state file, no database, and no
checkout of the target repository.

It's designed for people who want their solved problems to show up in a repo —
as a GitHub profile flex, a study log, a blog source tree, or a Typst/PDF
workbook — without a bespoke sync script.

::: tip Try it safely first
Every run supports `dry-run: "true"`, which renders and logs everything but
creates no commits. Build the whole pipeline locally with the
[CLI](/guide/cli) before you wire up the workflow.
:::

## How it works in one picture

```
LeetCode GraphQL                     GitHub API (no checkout)
────────────────                     ────────────────────────
submissionList  ──► filters ──┐
                              │
     for each submission:     │
       submissionDetails ─────┤
       questionData ──────────┤
                              ▼
                    Nunjucks render ──► files (+ assets)
                              │
                    [submission hook] ──► may rewrite the files
                              │
                    create commit (author.date = submission time)
                              │
                    ...repeat oldest → newest...
                              │
                    [post hook] ──► optional extra commit
                              │
                    ONE ref update  ◄── atomic push
```

## Who it's for

- **Solution vaults** — one README + code file per problem, with frontmatter
  ready for a static site generator.
- **Polyglot learners** — keep every language you solved a problem in, each in
  its own file, filtered to the languages you care about.
- **Typst users** — convert problem statements into a printable workbook and
  compile it in a `post` hook.
- **Anyone migrating** — point `commit.prefix` at your old sync tool's commit
  header and inherit its watermark, so only new submissions are pulled.

Start with [Getting started](/guide/getting-started), then tune the output in
[Configuration](/guide/configuration) and [Templates](/guide/templates). If
something bites, check [Limitations](/limitations) and the [FAQ](/faq).
