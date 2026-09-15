import type { Octokit } from "@octokit/rest";
import { applyFilters, applyQuestionFilters, needsQuestionMetadata } from "./filters";
import { getDefaultBranch, SyncCommitter } from "./git";
import type { CommitFile } from "./git";
import { LeetCodeClient } from "./leetcode";
import {
  assetFilename,
  assetReference,
  downloadAsset,
  extractAssetUrls,
  rewriteAssetUrls,
} from "./assets";
import {
  buildContext,
  configureRender,
  renderFilename,
  renderTemplate,
} from "./render";
import type { TemplateContext } from "./render";
import { scanWatermark } from "./state";
import {
  HookRunner,
  buildRepoContext,
  collectWorkspace,
  hookEnv,
  hookEnvVars,
  materializeWorkspace,
  postHookContext,
  preHookContext,
  submissionHookContext,
  withTempWorkspace,
} from "./hooks";
import type { RepoContext, ResolvedHook } from "./hooks";
import type { SubmissionPhase } from "./config";
import type {
  LeechConfig,
  PostHookConfig,
  Question,
  SubmissionListEntry,
  SyncSummary,
} from "./types";
import { log } from "./log";

export interface RunOptions {
  octokit: Octokit;
  client: LeetCodeClient;
  config: LeechConfig;
  dryRun?: boolean;
  verbose?: boolean;
  currentRepo?: { owner: string; name: string };
}

interface SyncTarget {
  owner: string;
  repo: string;
  branch: string;
}

interface ProcessedSubmission {
  id: number;
  slug: string;
  lang: string;
  timestamp: number;
  files: string[];
}

export async function runSync(opts: RunOptions): Promise<SyncSummary> {
  const { octokit, client, config, dryRun = false, verbose = false } = opts;

  configureRender(config.render);

  const { owner, repo, branch } = await resolveTarget(
    octokit,
    config,
    opts.currentRepo
  );
  log(`target: ${owner}/${repo}@${branch} (${dryRun ? "dry-run" : "live"})`);

  const committer = new SyncCommitter(
    octokit,
    owner,
    repo,
    branch,
    config.commit.authorName,
    config.commit.authorEmail
  );
  await committer.init();

  const watermark = await scanWatermark(
    octokit,
    owner,
    repo,
    branch,
    config.commit.prefix
  );
  log(`watermark: ${watermark} (${new Date(watermark * 1000).toISOString()})`);

  const { hooks } = config;
  const hookRunner = new HookRunner({
    shell: hooks.shell,
    timeoutMs: hooks.timeoutMs,
    onError: hooks.onError,
    verbose,
  });
  const repoContext = buildRepoContext({
    owner,
    repo,
    branch,
    destination: config.destination,
    site: config.site,
    dryRun,
    verbose,
  });

  // pre: once, after the watermark is known and before any LeetCode call.
  await hookRunner.run(
    "pre",
    hooks.pre,
    preHookContext(repoContext, watermark, config.commit.prefix),
    repoHookEnv(repoContext, "pre")
  );

  const candidates = await collectCandidates(client, watermark);
  log(`submissions newer than watermark: ${candidates.length}`);

  const questionCache = new Map<string, Question | null>();
  const assetCache = new Map<string, Buffer>();

  let filtered = applyFilters(candidates, config.filters);
  filtered = await resolveQuestionFilters(
    client,
    filtered,
    config.filters,
    questionCache
  );
  const skippedFiltered = candidates.length - filtered.length;
  log(`after filters: ${filtered.length} (skipped ${skippedFiltered})`);

  // Oldest first, so commits are ordered and the watermark advances monotonically.
  const ordered = [...filtered].sort(
    (a, b) => a.timestamp - b.timestamp || a.id - b.id
  );
  const submissionHook = hooks.submission;
  const submissionPhase = submissionHook?.when ?? "before-commit";
  const processed: ProcessedSubmission[] = [];
  let synced = 0;
  let finalWatermark = watermark;

  for (const [index, entry] of ordered.entries()) {
    const result = await processSubmission({
      entry,
      index,
      total: ordered.length,
      watermark,
      client,
      config,
      committer,
      dryRun,
      verbose,
      questionCache,
      assetCache,
      repoContext,
      hookRunner,
      submissionHook,
      submissionPhase,
    });
    if (!result) continue;

    synced++;
    finalWatermark = Math.max(finalWatermark, result.timestamp);
    processed.push(result);
  }

  await runPostHook({
    repoContext,
    config,
    hookRunner,
    postHook: hooks.post,
    committer,
    summary: { scanned: candidates.length, skippedFiltered, synced, watermark },
    finalWatermark,
    processed,
    dryRun,
  });

  // Push every commit of this sync in one ref update (per-sync, not per-submission).
  const pushed = await committer.flush();
  if (pushed > 0) {
    log(`pushed ${pushed} commit(s) to ${owner}/${repo}@${branch}`);
  }

  log(`done: synced=${synced}, filtered=${skippedFiltered}, watermark=${watermark}`);
  return { scanned: candidates.length, skippedFiltered, synced, watermark };
}

/* ------------------------------------------------------------------ */
/* Target + history                                                    */
/* ------------------------------------------------------------------ */

async function resolveTarget(
  octokit: Octokit,
  config: LeechConfig,
  currentRepo: RunOptions["currentRepo"]
): Promise<SyncTarget> {
  const owner = config.repo?.owner ?? currentRepo?.owner;
  const repo = config.repo?.name ?? currentRepo?.name;
  if (!owner || !repo) {
    throw new Error(
      "config.repo (owner/name) is required when not running inside GitHub Actions"
    );
  }
  const branch =
    config.branch ?? (await getDefaultBranch(octokit, owner, repo));
  return { owner, repo, branch };
}

/** Minimal client surface used by {@link collectCandidates} (easy to fake in tests). */
export interface SubmissionLister {
  listSubmissions(offset: number): Promise<{
    hasMore: boolean;
    submissions: SubmissionListEntry[];
  }>;
}

/** Collects submissions newer than the watermark (the API returns newest first). */
export async function collectCandidates(
  client: SubmissionLister,
  watermark: number
): Promise<SubmissionListEntry[]> {
  const candidates: SubmissionListEntry[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.listSubmissions(offset);
    for (const entry of page.submissions) {
      if (entry.timestamp <= watermark) return candidates;
      candidates.push(entry);
    }
    if (!page.hasMore || page.submissions.length === 0) return candidates;
    offset += page.submissions.length;
  }
}

/* ------------------------------------------------------------------ */
/* Filters + question metadata                                         */
/* ------------------------------------------------------------------ */

async function loadQuestion(
  client: LeetCodeClient,
  cache: Map<string, Question | null>,
  slug: string
): Promise<Question | null> {
  const cached = cache.get(slug);
  if (cached !== undefined) return cached;
  const question = await client.getQuestion(slug);
  cache.set(slug, question);
  return question;
}

/**
 * Difficulty/tag filters need problem metadata the submission list doesn't
 * carry. Resolve each surviving problem once (the cache also serves the main
 * loop) and drop the ones that don't match.
 */
async function resolveQuestionFilters(
  client: LeetCodeClient,
  entries: SubmissionListEntry[],
  filters: LeechConfig["filters"],
  cache: Map<string, Question | null>
): Promise<SubmissionListEntry[]> {
  if (!needsQuestionMetadata(filters)) return entries;

  const slugs = [...new Set(entries.map((entry) => entry.titleSlug))];
  log(`resolving ${slugs.length} question(s) for difficulty/tag filters`);
  for (const slug of slugs) {
    await loadQuestion(client, cache, slug);
  }
  return applyQuestionFilters(entries, (slug) => cache.get(slug) ?? null, filters);
}

/* ------------------------------------------------------------------ */
/* Rendering + assets                                                  */
/* ------------------------------------------------------------------ */

export interface AssetPlanEntry {
  url: string;
  filename: string;
}

/**
 * Plans asset downloads: every absolute http(s) img src in the problem HTML
 * maps to `<prefix>/images/<slug>/<filename>`. Returns an empty plan when
 * asset downloading is disabled (`assets: null`).
 */
export function planAssets(html: string): AssetPlanEntry[] {
  const used = new Set<string>();
  const plan: AssetPlanEntry[] = [];
  for (const url of extractAssetUrls(html)) {
    let filename = assetFilename(url);
    if (used.has(filename)) {
      let suffix = 1;
      while (used.has(`${suffix}-${filename}`)) suffix++;
      filename = `${suffix}-${filename}`;
    }
    used.add(filename);
    plan.push({ url, filename });
  }
  return plan;
}

/**
 * Downloads every planned asset once for the whole run. A failed download logs
 * a warning and leaves the original URL in place instead of failing the sync.
 */
async function downloadAssets(
  plan: AssetPlanEntry[],
  cache: Map<string, Buffer>
): Promise<void> {
  for (const entry of plan) {
    if (cache.has(entry.url)) continue;
    try {
      cache.set(entry.url, await downloadAsset(entry.url));
    } catch (err) {
      cache.set(entry.url, Buffer.alloc(0));
      log(
        `warning: failed to download asset ${entry.url}: ${
          (err as Error).message
        } (reference left as-is)`
      );
    }
  }
}

/**
 * Builds the downloadable-asset commit files and the HTML URL → reference map
 * used to rewrite the problem description. Failed/empty downloads are skipped.
 */
function buildAssetFiles(
  plan: AssetPlanEntry[],
  cache: Map<string, Buffer>,
  assets: string,
  destination: string,
  slug: string
): { files: CommitFile[]; relMap: Map<string, string> } {
  const prefix = assets === "" ? destination : assets;
  const files: CommitFile[] = [];
  const relMap = new Map<string, string>();

  for (const entry of plan) {
    const bytes = cache.get(entry.url);
    if (!bytes || bytes.length === 0) continue;

    const storagePath = `${prefix}/images/${slug}/${entry.filename}`;
    files.push({ path: storagePath, content: bytes, encoding: "base64" });
    relMap.set(entry.url, assetReference(assets, storagePath));
  }
  return { files, relMap };
}

/** Downloads assets for a problem (unless disabled) and plans their files. */
async function prepareAssets(
  question: Question,
  assets: string | null,
  destination: string,
  cache: Map<string, Buffer>
): Promise<{ files: CommitFile[]; relMap: Map<string, string> }> {
  if (assets === null) return { files: [], relMap: new Map() };

  const plan = planAssets(question.contentHtml);
  await downloadAssets(plan, cache);
  return buildAssetFiles(plan, cache, assets, destination, question.titleSlug);
}

/** Renders the configured output files and the commit message. */
function renderSubmission(
  config: LeechConfig,
  context: TemplateContext,
  fileContext: TemplateContext
): { files: CommitFile[]; message: string } {
  const files = config.files.map((tpl) => ({
    path: renderFilename(tpl.filename, context, config.destination),
    content: renderTemplate(tpl.content, fileContext),
  }));
  const message = `${config.commit.prefix} ${renderTemplate(
    config.commit.message,
    context
  )}`.trim();
  return { files, message };
}

/**
 * Rewrites the problem HTML so downloaded assets point at their repo paths.
 * References are identical for every output file, so this happens once per
 * submission.
 */
function applyAssetReferences(
  context: TemplateContext,
  relMap: Map<string, string>
): TemplateContext {
  if (relMap.size === 0) return context;
  return {
    ...context,
    question: {
      ...context.question,
      content: rewriteAssetUrls(context.question.content, relMap),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Per-submission pipeline                                             */
/* ------------------------------------------------------------------ */

interface ProcessSubmissionOptions {
  entry: SubmissionListEntry;
  index: number;
  total: number;
  watermark: number;
  client: LeetCodeClient;
  config: LeechConfig;
  committer: SyncCommitter;
  dryRun: boolean;
  verbose: boolean;
  questionCache: Map<string, Question | null>;
  assetCache: Map<string, Buffer>;
  repoContext: RepoContext;
  hookRunner: HookRunner;
  submissionHook: ResolvedHook | undefined;
  submissionPhase: SubmissionPhase;
}

/**
 * Renders, (optionally) hooks, and commits a single submission. Returns the
 * processed record, or null when the submission is skipped (no details,
 * already synced, unavailable question, or a `skip` hook policy).
 */
async function processSubmission(
  o: ProcessSubmissionOptions
): Promise<ProcessedSubmission | null> {
  const { entry, index, total, verbose, config, repoContext } = o;

  const details = await o.client.getSubmissionDetails(entry.id);
  if (!details) {
    if (verbose) log(`skip submission ${entry.id}: no details`);
    return null;
  }
  if (details.timestamp <= o.watermark) {
    if (verbose) log(`skip submission ${entry.id}: already synced`);
    return null;
  }

  const question = await loadQuestion(o.client, o.questionCache, entry.titleSlug);
  if (!question) {
    log(
      `skip submission ${entry.id} (${entry.titleSlug}): question unavailable (locked?)`
    );
    return null;
  }

  const context = buildContext(details, question, config.site);
  const { files: assetFiles, relMap } = await prepareAssets(
    question,
    config.assets,
    config.destination,
    o.assetCache
  );
  const fileContext = applyAssetReferences(context, relMap);
  const { files: renderedFiles, message } = renderSubmission(
    config,
    context,
    fileContext
  );

  const allFiles: CommitFile[] = [...renderedFiles, ...assetFiles];
  const assetPaths = new Set(assetFiles.map((file) => file.path));
  let commitFiles = allFiles;

  // before-commit: let the hook reshape a temp workspace, then commit the result.
  if (o.submissionHook && o.submissionPhase === "before-commit") {
    const { outcome, files } = await runBeforeCommitHook(o, fileContext, allFiles, assetPaths);
    if (outcome === "skip") {
      log(`skip submission ${entry.id}: hook skipped`);
      return null;
    }
    commitFiles = files;
  }

  if (o.dryRun) {
    log(`[dry-run] would commit "${message}" with ${commitFiles.length} file(s)`);
    if (verbose) for (const file of commitFiles) log(`  ${file.path}`);
  } else {
    await o.committer.commitSubmission(commitFiles, message, details.timestamp);
  }

  // after-commit: observational, runs after the commit object is created.
  if (o.submissionHook && o.submissionPhase === "after-commit") {
    const hookCtx = submissionHookContext(
      repoContext,
      "after-commit",
      index,
      total,
      fileContext,
      commitFiles.map((file) => ({ path: file.path, asset: assetPaths.has(file.path) })),
      ""
    );
    await o.hookRunner.run(
      "submission",
      o.submissionHook,
      hookCtx,
      submissionEnv(repoContext, "after-commit", fileContext, "")
    );
  }

  if (!o.dryRun && verbose) {
    log(`committed "${message}" (${commitFiles.length} file(s))`);
    for (const file of commitFiles) log(`  ${file.path}`);
  }

  return {
    id: entry.id,
    slug: entry.titleSlug,
    lang: details.lang,
    timestamp: details.timestamp,
    files: commitFiles.map((file) => file.path),
  };
}

/**
 * Runs the per-submission before-commit hook against a temp workspace and
 * returns the files to commit: the (possibly reshaped) workspace on success,
 * or the original rendered files when the hook only warned.
 */
async function runBeforeCommitHook(
  o: ProcessSubmissionOptions,
  context: TemplateContext,
  allFiles: CommitFile[],
  assetPaths: Set<string>
): Promise<{ outcome: "ok" | "warn" | "skip"; files: CommitFile[] }> {
  return withTempWorkspace(async (dir) => {
    await materializeWorkspace(dir, allFiles);
    const hookCtx = submissionHookContext(
      o.repoContext,
      "before-commit",
      o.index,
      o.total,
      context,
      allFiles.map((file) => ({ path: file.path, asset: assetPaths.has(file.path) })),
      dir
    );
    const outcome = await o.hookRunner.run(
      "submission",
      o.submissionHook,
      hookCtx,
      submissionEnv(o.repoContext, "before-commit", context, dir),
      { allowSkip: true }
    );
    const files =
      outcome === "ok" ? await collectWorkspace(dir, allFiles) : allFiles;
    return { outcome, files };
  });
}

/* ------------------------------------------------------------------ */
/* Post hook                                                           */
/* ------------------------------------------------------------------ */

interface RunPostHookOptions {
  repoContext: RepoContext;
  config: LeechConfig;
  hookRunner: HookRunner;
  postHook: PostHookConfig | undefined;
  committer: SyncCommitter;
  summary: SyncSummary;
  finalWatermark: number;
  processed: ProcessedSubmission[];
  dryRun: boolean;
}

/**
 * Runs the post hook in an empty workspace. Files it writes become an optional
 * post-sync commit in the same push, unless `commit: null` disables it.
 */
async function runPostHook(o: RunPostHookOptions): Promise<void> {
  if (!o.postHook) return;

  const { dryRun, config, postHook, hookRunner, repoContext } = o;
  const { files: postFiles, message: postMessage } = await withTempWorkspace(
    async (dir) => {
      const hookCtx = postHookContext(
        repoContext,
        o.summary,
        o.finalWatermark,
        o.summary.synced,
        o.processed
      );
      const env = repoHookEnv(repoContext, "post", dir);
      const outcome = await hookRunner.run("post", postHook, hookCtx, env);
      if (outcome !== "ok") return { files: [] as CommitFile[], message: "" };

      const files = await collectWorkspace(dir, []);
      if (files.length === 0) return { files, message: "" };
      if (postHook.commit === null) {
        log(
          `warning: post hook produced ${files.length} file(s) but commit is disabled; ignoring`
        );
        return { files: [] as CommitFile[], message: "" };
      }
      const message = renderTemplate(
        postHook.commit ?? `${config.commit.prefix} post-sync`,
        hookCtx
      ).trim();
      return { files, message };
    }
  );

  if (postFiles.length === 0) return;

  if (dryRun) {
    log(
      `[dry-run] would create post-sync commit "${postMessage}" with ${postFiles.length} file(s)`
    );
  } else {
    await o.committer.commitPostSync(postFiles, postMessage);
    log(`committed post-sync "${postMessage}" (${postFiles.length} file(s))`);
  }
}

/* ------------------------------------------------------------------ */
/* Hook environments                                                   */
/* ------------------------------------------------------------------ */

/** Environment for a pre/post hook (repo context only). */
function repoHookEnv(
  repo: RepoContext,
  hook: "pre" | "post",
  workspace?: string
): NodeJS.ProcessEnv {
  return hookEnv(
    process.env,
    hookEnvVars({
      hook,
      repo: `${repo.repo.owner}/${repo.repo.name}`,
      branch: repo.branch,
      destination: repo.destination,
      site: repo.site,
      dryRun: repo.dryRun,
      verbose: repo.verbose,
      workspace,
    })
  );
}

/** Environment for a per-submission hook (adds submission/question vars). */
function submissionEnv(
  repo: RepoContext,
  phase: SubmissionPhase,
  context: TemplateContext,
  workspace: string
): NodeJS.ProcessEnv {
  return hookEnv(
    process.env,
    hookEnvVars({
      hook: "submission",
      phase,
      repo: `${repo.repo.owner}/${repo.repo.name}`,
      branch: repo.branch,
      destination: repo.destination,
      site: repo.site,
      dryRun: repo.dryRun,
      verbose: repo.verbose,
      workspace,
      submission: {
        id: context.submission.id,
        timestamp: context.submission.timestamp,
        lang: context.submission.lang,
      },
      question: {
        titleSlug: context.question.title_slug,
        title: context.question.title,
        frontendId: context.question.frontend_id,
      },
    })
  );
}
