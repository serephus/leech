import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { applyFilters } from "./filters";
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
  buildRepoContext,
  collectWorkspace,
  hookEnv,
  hookEnvVars,
  materializeWorkspace,
  postHookContext,
  preHookContext,
  resolveOnError,
  runHook,
  submissionHookContext,
} from "./hooks";
import type { ResolvedHook } from "./hooks";
import type {
  HookErrorPolicy,
  LeechConfig,
  Question,
  SubmissionListEntry,
  SyncSummary,
} from "./types";

export interface RunOptions {
  octokit: Octokit;
  client: LeetCodeClient;
  config: LeechConfig;
  dryRun?: boolean;
  verbose?: boolean;
  currentRepo?: { owner: string; name: string };
}

export async function runSync(opts: RunOptions): Promise<SyncSummary> {
  const { octokit, client, config, dryRun = false, verbose = false } = opts;

  configureRender(config.render);

  const owner = config.repo?.owner ?? opts.currentRepo?.owner;
  const repo = config.repo?.name ?? opts.currentRepo?.name;
  if (!owner || !repo) {
    throw new Error(
      "config.repo (owner/name) is required when not running inside GitHub Actions"
    );
  }
  const branch = config.branch ?? (await getDefaultBranch(octokit, owner, repo));

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
  log(
    `watermark: ${watermark} (${new Date(watermark * 1000).toISOString()})`
  );

  const hooks = config.hooks;
  const repoContext = buildRepoContext({
    owner,
    repo,
    branch,
    destination: config.destination,
    site: config.site,
    dryRun,
    verbose,
  });

  // Pre-sync hook: once, after the watermark is known and before any LeetCode
  // call. Aborts the run on `fail`.
  await runHookPoint(
    "pre",
    hooks.pre,
    preHookContext(repoContext, watermark, config.commit.prefix),
    {
      shell: hooks.shell,
      name: "pre",
      verbose,
      defaultTimeoutMs: hooks.timeoutMs,
      globalOnError: hooks.onError,
      allowSkip: false,
      baseEnv: hookEnv(
        process.env,
        hookEnvVars({
          hook: "pre",
          repo: `${owner}/${repo}`,
          branch,
          destination: config.destination,
          site: config.site,
          dryRun,
          verbose,
        })
      ),
    }
  );

  // Collect submissions newer than the watermark (API returns newest first).
  const candidates: SubmissionListEntry[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.listSubmissions(offset);
    let reachedWatermark = false;
    for (const entry of page.submissions) {
      if (entry.timestamp <= watermark) {
        reachedWatermark = true;
        break;
      }
      candidates.push(entry);
    }
    if (reachedWatermark || !page.hasMore || page.submissions.length === 0) {
      break;
    }
    offset += page.submissions.length;
  }
  log(`submissions newer than watermark: ${candidates.length}`);

  const filtered = applyFilters(candidates, config.filters);
  const skippedFiltered = candidates.length - filtered.length;
  log(`after filters: ${filtered.length} (skipped ${skippedFiltered})`);

  // Oldest first, so commits are ordered and the watermark advances monotonically.
  const ordered = [...filtered].sort(
    (a, b) => a.timestamp - b.timestamp || a.id - b.id
  );

  const questionCache = new Map<string, Question | null>();
  const submissionHook = hooks.submission;
  const submissionPhase = submissionHook?.when ?? "before-commit";
  const processed: Array<{
    id: number;
    slug: string;
    lang: string;
    timestamp: number;
    files: string[];
  }> = [];
  let synced = 0;
  let finalWatermark = watermark;

  for (const [index, entry] of ordered.entries()) {
    const details = await client.getSubmissionDetails(entry.id);
    if (!details) {
      if (verbose) log(`skip submission ${entry.id}: no details`);
      continue;
    }
    if (details.timestamp <= watermark) {
      if (verbose) log(`skip submission ${entry.id}: already synced`);
      continue;
    }

    let question = questionCache.get(entry.titleSlug);
    if (question === undefined) {
      question = await client.getQuestion(entry.titleSlug);
      questionCache.set(entry.titleSlug, question);
    }
    if (!question) {
      log(
        `skip submission ${entry.id} (${entry.titleSlug}): question unavailable (locked?)`
      );
      continue;
    }

    const context = buildContext(details, question, config.site);

    // Plan asset downloads: every absolute http(s) img src in the problem HTML
    // maps to `<prefix>/images/<slug>/<filename>`, where prefix is the
    // destination (assets: "") or the configured assets folder. `assets: null`
    // disables downloading entirely.
    const assetPlan: { url: string; filename: string }[] = [];
    if (config.assets !== null) {
      const used = new Set<string>();
      for (const url of extractAssetUrls(question.contentHtml)) {
        let filename = assetFilename(url);
        if (used.has(filename)) {
          let i = 1;
          while (used.has(`${i}-${filename}`)) i++;
          filename = `${i}-${filename}`;
        }
        used.add(filename);
        assetPlan.push({ url, filename });
      }
    }

    // Download once per URL (cached for the whole run). A failed download
    // keeps the original URL and logs a warning instead of failing the sync.
    const assetBytes = new Map<string, Buffer>();
    for (const a of assetPlan) {
      if (assetBytes.has(a.url)) continue;
      try {
        assetBytes.set(a.url, await downloadAsset(a.url));
      } catch (err) {
        assetBytes.set(a.url, Buffer.alloc(0));
        log(
          `warning: failed to download asset ${a.url}: ${
            (err as Error).message
          } (reference left as-is)`
        );
      }
    }
    const okAssets = assetPlan.filter(
      (a) => (assetBytes.get(a.url)?.length ?? 0) > 0
    );

    const assetsPrefix =
      config.assets === "" ? config.destination : (config.assets ?? "");
    const assetFiles: CommitFile[] = okAssets.map((a) => ({
      path: `${assetsPrefix}/images/${question.titleSlug}/${a.filename}`,
      content: assetBytes.get(a.url)!,
      encoding: "base64",
    }));

    // References are the same for every output file (repo-root-absolute), so
    // the rewritten content is built once per submission.
    const relMap = new Map<string, string>();
    for (const a of okAssets) {
      relMap.set(
        a.url,
        assetReference(
          config.assets ?? "",
          `${assetsPrefix}/images/${question.titleSlug}/${a.filename}`
        )
      );
    }
    const fileContext =
      relMap.size > 0
        ? {
            ...context,
            question: {
              ...context.question,
              content: rewriteAssetUrls(context.question.content, relMap),
            },
          }
        : context;

    const files = config.files.map((tpl) => ({
      path: renderFilename(tpl.filename, context, config.destination),
      content: renderTemplate(tpl.content, fileContext),
    }));

    const message = `${config.commit.prefix} ${renderTemplate(
      config.commit.message,
      context
    )}`.trim();

    const allFiles: CommitFile[] = [...files, ...assetFiles];
    const assetPaths = new Set(assetFiles.map((f) => f.path));
    let commitFiles = allFiles;

    // Per-submission hook, phase before-commit: materialize the rendered files
    // into a temp workspace, let the hook reshape it, then commit the result.
    if (submissionHook && submissionPhase === "before-commit") {
      const dir = await makeTempWorkspace();
      try {
        await materializeWorkspace(dir, allFiles);
        const hookCtx = submissionHookContext(
          repoContext,
          "before-commit",
          index,
          ordered.length,
          fileContext,
          allFiles.map((f) => ({
            path: f.path,
            asset: assetPaths.has(f.path),
          })),
          dir
        );
        const outcome = await runHookPoint("submission", submissionHook, hookCtx, {
          shell: hooks.shell,
          name: "submission",
          verbose,
          defaultTimeoutMs: hooks.timeoutMs,
          globalOnError: hooks.onError,
          allowSkip: true,
          baseEnv: submissionEnv({
            owner,
            repo,
            branch,
            config,
            phase: "before-commit",
            dryRun,
            verbose,
            workspace: dir,
            context: fileContext,
          }),
        });
        if (outcome === "skip") {
          log(`skip submission ${entry.id}: hook skipped`);
          continue;
        }
        commitFiles =
          outcome === "ok"
            ? await collectWorkspace(dir, allFiles)
            : allFiles;
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }

    if (dryRun) {
      log(
        `[dry-run] would commit "${message}" with ${commitFiles.length} file(s)`
      );
      for (const f of commitFiles) {
        if (verbose) log(`  ${f.path}`);
      }
    } else {
      await committer.commitSubmission(commitFiles, message, details.timestamp);
    }

    // Per-submission hook, phase after-commit: observational, runs in both
    // live and dry-run modes.
    if (submissionHook && submissionPhase === "after-commit") {
      const hookCtx = submissionHookContext(
        repoContext,
        "after-commit",
        index,
        ordered.length,
        fileContext,
        commitFiles.map((f) => ({
          path: f.path,
          asset: assetPaths.has(f.path),
        })),
        ""
      );
      await runHookPoint("submission", submissionHook, hookCtx, {
        shell: hooks.shell,
        name: "submission",
        verbose,
        defaultTimeoutMs: hooks.timeoutMs,
        globalOnError: hooks.onError,
        allowSkip: false,
        baseEnv: submissionEnv({
          owner,
          repo,
          branch,
          config,
          phase: "after-commit",
          dryRun,
          verbose,
          workspace: "",
          context: fileContext,
        }),
      });
    }

    if (!dryRun && verbose) {
      log(`committed "${message}" (${commitFiles.length} file(s))`);
      for (const f of commitFiles) log(`  ${f.path}`);
    }

    synced++;
    finalWatermark = Math.max(finalWatermark, details.timestamp);
    processed.push({
      id: entry.id,
      slug: entry.titleSlug,
      lang: details.lang,
      timestamp: details.timestamp,
      files: commitFiles.map((f) => f.path),
    });
  }

  // Post-sync hook: runs before the single ref update. Files it writes become
  // an optional post-sync commit in the same push.
  let postFiles: CommitFile[] = [];
  let postMessage = "";
  const postHook = hooks.post;
  if (postHook) {
    const dir = await makeTempWorkspace();
    try {
      const hookCtx = postHookContext(
        repoContext,
        { scanned: candidates.length, skippedFiltered, synced, watermark },
        finalWatermark,
        synced,
        processed
      );
      const outcome = await runHookPoint("post", postHook, hookCtx, {
        shell: hooks.shell,
        name: "post",
        verbose,
        defaultTimeoutMs: hooks.timeoutMs,
        globalOnError: hooks.onError,
        allowSkip: false,
        baseEnv: hookEnv(
          process.env,
          hookEnvVars({
            hook: "post",
            repo: `${owner}/${repo}`,
            branch,
            destination: config.destination,
            site: config.site,
            dryRun,
            verbose,
            workspace: dir,
          })
        ),
      });
      if (outcome === "ok") {
        const collected = await collectWorkspace(dir, []);
        if (collected.length > 0) {
          if (postHook.commit === null) {
            log(
              `warning: post hook produced ${collected.length} file(s) but commit is disabled; ignoring`
            );
          } else {
            postFiles = collected;
            postMessage = renderTemplate(
              postHook.commit ?? `${config.commit.prefix} post-sync`,
              hookCtx
            ).trim();
          }
        }
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  if (!dryRun && postFiles.length > 0) {
    await committer.commitPostSync(postFiles, postMessage);
    log(`committed post-sync "${postMessage}" (${postFiles.length} file(s))`);
  } else if (dryRun && postFiles.length > 0) {
    log(
      `[dry-run] would create post-sync commit "${postMessage}" with ${postFiles.length} file(s)`
    );
  }

  // Push all commits of this sync in one ref update (per-sync, not per-submission).
  const pushed = await committer.flush();
  if (pushed > 0) {
    log(`pushed ${pushed} commit(s) to ${owner}/${repo}@${branch}`);
  }

  log(
    `done: synced=${synced}, filtered=${skippedFiltered}, watermark=${watermark}`
  );
  return { scanned: candidates.length, skippedFiltered, synced, watermark };
}

function submissionEnv(o: {
  owner: string;
  repo: string;
  branch: string;
  config: LeechConfig;
  phase: "before-commit" | "after-commit";
  dryRun: boolean;
  verbose: boolean;
  workspace: string;
  context: TemplateContext;
}): NodeJS.ProcessEnv {
  return hookEnv(
    process.env,
    hookEnvVars({
      hook: "submission",
      phase: o.phase,
      repo: `${o.owner}/${o.repo}`,
      branch: o.branch,
      destination: o.config.destination,
      site: o.config.site,
      dryRun: o.dryRun,
      verbose: o.verbose,
      workspace: o.workspace,
      submission: {
        id: o.context.submission.id,
        timestamp: o.context.submission.timestamp,
        lang: o.context.submission.lang,
      },
      question: {
        titleSlug: o.context.question.title_slug,
        title: o.context.question.title,
        frontendId: o.context.question.frontend_id,
      },
    })
  );
}

async function makeTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "leech-hook-"));
}

async function runHookPoint(
  point: "pre" | "submission" | "post",
  hook: ResolvedHook | undefined,
  context: object,
  o: {
    shell: string;
    name: string;
    verbose: boolean;
    defaultTimeoutMs: number;
    globalOnError: HookErrorPolicy;
    allowSkip: boolean;
    baseEnv: NodeJS.ProcessEnv;
  }
): Promise<"ok" | "warn" | "skip"> {
  if (!hook) return "ok";
  const result = await runHook(hook, context, {
    shell: o.shell,
    name: o.name,
    verbose: o.verbose,
    defaultTimeoutMs: o.defaultTimeoutMs,
    baseEnv: o.baseEnv,
  });
  if (result.ok) return "ok";
  const policy = resolveOnError(hook.onError, o.globalOnError, o.allowSkip);
  if (policy === "skip") {
    log(`hook "${o.name}" requested skip (${result.error ?? "non-zero exit"})`);
    return "skip";
  }
  if (policy === "warn") {
    log(
      `warning: hook "${o.name}" failed (${result.error ?? "non-zero exit"}); continuing`
    );
    return "warn";
  }
  throw new Error(`hook "${o.name}" failed: ${result.error ?? "non-zero exit"}`);
}

function log(message: string): void {
  console.log(`[leech] ${message}`);
}
