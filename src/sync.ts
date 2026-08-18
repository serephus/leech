import type { Octokit } from "@octokit/rest";
import { applyFilters } from "./filters";
import { getDefaultBranch, SyncCommitter } from "./git";
import { LeetCodeClient } from "./leetcode";
import { buildContext, renderFilename, renderTemplate } from "./render";
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
    const files = config.files.map((tpl) => ({
      path: renderFilename(tpl.filename, context, config.destination),
      content: renderTemplate(tpl.content, context),
    }));
    const message = `${config.commit.prefix} ${renderTemplate(
      config.commit.message,
      context
    )}`.trim();

    if (dryRun) {
      log(
        `[dry-run] would commit "${message}" with ${files.length} file(s)`
      );
      for (const f of files) {
        if (verbose) log(`  ${f.path}`);
      }
      synced++;
      continue;
    }

    await committer.commitSubmission(files, message, details.timestamp);
    if (verbose) {
      log(`committed "${message}" (${files.length} file(s))`);
      for (const f of files) log(`  ${f.path}`);
    }
    synced++;
  }

  log(
    `done: synced=${synced}, filtered=${skippedFiltered}, watermark=${watermark}`
  );
  return { scanned: candidates.length, skippedFiltered, synced, watermark };
}

function log(message: string): void {
  console.log(`[leech] ${message}`);
}
