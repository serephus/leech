import type { Octokit } from "@octokit/rest";
import { applyFilters } from "./filters";
import { getDefaultBranch, SyncCommitter } from "./git";
import type { CommitFile } from "./git";
import { LeetCodeClient } from "./leetcode";
import {
  assetFilename,
  downloadAsset,
  extractAssetUrls,
  relativeAssetPath,
  rewriteAssetUrls,
} from "./assets";
import {
  buildContext,
  configureRender,
  renderFilename,
  renderTemplate,
} from "./render";
import { scanWatermark } from "./state";
import type { LeechConfig, Question, SubmissionListEntry, SyncSummary } from "./types";

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
  let synced = 0;

  for (const entry of ordered) {
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

    const context = buildContext(details, question);

    // Plan asset downloads: every absolute http(s) img src in the problem HTML
    // maps to `<destination>/<assets>/<slug>/<filename>`.
    const assetsDir = config.assets;
    const assetPlan: { url: string; filename: string }[] = [];
    if (assetsDir) {
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

    const assetFiles: CommitFile[] = okAssets.map((a) => ({
      path: `${config.destination}/${assetsDir}/${question.titleSlug}/${a.filename}`,
      content: assetBytes.get(a.url)!,
      encoding: "base64",
    }));

    const files = config.files.map((tpl) => {
      const path = renderFilename(tpl.filename, context, config.destination);
      const idx = path.lastIndexOf("/");
      const dir = idx >= 0 ? path.slice(0, idx) : "";
      const relMap = new Map<string, string>();
      for (const a of okAssets) {
        relMap.set(
          a.url,
          relativeAssetPath(
            dir,
            `${config.destination}/${assetsDir}/${question.titleSlug}/${a.filename}`
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
      return { path, content: renderTemplate(tpl.content, fileContext) };
    });

    const message = `${config.commit.prefix} ${renderTemplate(
      config.commit.message,
      context
    )}`.trim();

    if (dryRun) {
      log(
        `[dry-run] would commit "${message}" with ${
          files.length + assetFiles.length
        } file(s)`
      );
      for (const f of [...files, ...assetFiles]) {
        if (verbose) log(`  ${f.path}`);
      }
      synced++;
      continue;
    }

    await committer.commitSubmission(
      [...files, ...assetFiles],
      message,
      details.timestamp
    );
    if (verbose) {
      log(
        `committed "${message}" (${
          files.length + assetFiles.length
        } file(s))`
      );
      for (const f of [...files, ...assetFiles]) log(`  ${f.path}`);
    }
    synced++;
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

function log(message: string): void {
  console.log(`[leech] ${message}`);
}
