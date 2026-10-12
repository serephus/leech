# Architecture

leech is a small pipeline with a deliberate constraint: **it never checks out
the target repository**. It reads what it needs through the LeetCode GraphQL API
and writes through GitHub's Git Data API, keeping the whole run in memory and
landing it as one atomic ref update.

## Module map

| Module | Responsibility |
| --- | --- |
| `config.ts` | Parse and validate the inline YAML config (zod), apply defaults |
| `types.ts` | Shared TypeScript types |
| `leetcode.ts` | LeetCode GraphQL client: submission list, submission details, question data |
| `filters.ts` | Submission filters (pre-fetch) and question-metadata filters (post-fetch) |
| `render.ts` | Nunjucks environment, custom filters, context building, filename sanitization |
| `assets.ts` | Extract, download, and rewrite image URLs from problem HTML |
| `git.ts` | `SyncCommitter` — build blobs/trees/commits and flush the ref once |
| `state.ts` | Watermark scan over branch history |
| `hooks.ts` | Hook runner, environment scrubbing, workspace materialization, contexts |
| `sync.ts` | Orchestration — the pipeline below |
| `index.ts` | GitHub Action entry point (`@actions/core` inputs/outputs) |
| `cli.ts` | Local CLI entry point |

The action and the CLI are thin wrappers around `runSync` in `sync.ts`; they
only differ in how they obtain configuration and credentials.

## The pipeline

```text
parse config (zod)
  └─ resolve target repo + branch
       └─ SyncCommitter.init()      read head SHA + base tree
            └─ scan watermark      newest prefixed commit's author date
                 └─ [HOOK pre]
                      └─ list submissions (paged, newest first)
                           └─ apply pre-fetch filters
                                └─ sort oldest → newest
                                     └─ resolve question metadata (only if
                                        difficulty/tag filters are active)
                                          └─ for each submission:
                                               ├─ fetch details + question (cached)
                                               ├─ render files + download assets (cached)
                                               ├─ materialize a temp workspace
                                               ├─ [HOOK submission / before-commit]
                                               ├─ collect the workspace
                                               ├─ create commit (author.date = submission time)
                                               └─ [HOOK submission / after-commit]
                                          └─ [HOOK post]
                                               └─ optional post commit
                                                    └─ flush(): ONE ref update
```

## The no-checkout commit model

`SyncCommitter` (`src/git.ts`) builds commits with three GitHub API calls per
submission and defers the push:

1. **`createBlob`** for every rendered file — `utf-8` for text, `base64` for
   binary assets.
2. **`createTree`** with `base_tree` set to the tree of the previous commit
   (initially the branch head), adding or overwriting entries at mode `100644`.
3. **`createCommit`** with `parents: [headSha]` and `author.date` set to the
   submission's timestamp, then it chains `headSha`/`treeSha` locally.

At the end, **`flush()`** issues a single `updateRef` on `heads/<branch>` with
`force: false`. If anything failed before that point, no commits are reachable
and the API-created commit objects are simply garbage-collected.

This design has three consequences worth knowing:

- **No clone, no shallow fetch, no token scope beyond `contents: write`.** The
  action can target a different repository than the one it runs in.
- **Commits are authored in solve order.** Because `author.date` is the
  submission timestamp and submissions are processed oldest-first, the history
  reads chronologically and the contribution graph reflects when you actually
  solved things.
- **`force: false`.** If the branch moved under you (another push), the ref
  update is rejected rather than clobbering it. The recommended workflow uses a
  `concurrency` group with `cancel-in-progress: false` to serialize runs.

## LeetCode client

All requests are `POST` to `https://<site>/graphql`. There is exactly one
endpoint; the old `GET /api/submissions/` list endpoint no longer exists.

- **Auth** is the browser cookie: the `cookie` header carries
  `LEETCODE_SESSION` and `csrftoken`, and `x-csrftoken`, `origin`, `referer` are
  set to match. No password, no API key.
- **Throttling**: a `client.delayMs` sleep runs before every call (default
  250 ms).
- **Retries**: transient failures (network errors, `429`, and `5xx`) are retried
  up to three attempts with a linear backoff.
- **Expired sessions fail loudly.** An invalid cookie produces `401`/`403`, and
  an *expired* one famously produces `HTTP 200` with a `null` `submissionList`.
  Both are turned into an explicit "session cookie is likely invalid or expired"
  error instead of a silent empty sync.

## Caching

Two in-memory caches keep the API call count down:

- **Question cache** (`Map<slug, Question | null>`) — question metadata can be
  needed both for tag/difficulty filtering and for rendering, so each slug is
  fetched at most once. A `null` is cached too, so locked/premium problems
  aren't retried.
- **Asset cache** (`Map<url, Buffer>`) — an asset URL is downloaded once even if
  several files reference it. A failed download caches an empty buffer so it
  isn't retried for every file.

## Reproducibility

- `config.ts` validates with zod, so malformed config fails before any network
  call.
- `render.throwOnUndefined` turns silent template typos into errors when you
  want strictness.
- Filenames are sanitized per path segment, so no template output can escape the
  destination directory or produce an invalid path.
- The watermark makes runs idempotent — see
  [Watermark & atomicity](/design/watermark).
