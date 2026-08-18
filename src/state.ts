import type { Octokit } from "@octokit/rest";

/**
 * Walks the branch history and finds the newest commit whose message starts
 * with `prefix`. Sync commits are created with author.date = submission
 * timestamp, so that date is the watermark: submissions with
 * timestamp <= watermark are considered already synced.
 */
export async function scanWatermark(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  prefix: string
): Promise<number> {
  let page = 0;
  let watermark = 0;
  for (;;) {
    const res = await octokit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: 100,
      page: page + 1,
    });
    watermark = Math.max(watermark, pickWatermark(res.data, prefix));
    if (res.data.length < 100) break;
    page++;
  }
  return watermark;
}

interface HistoryCommit {
  commit?: {
    message?: string;
    author?: { date?: string } | null;
  };
}

/** Pure helper: max author date (unix seconds) among commits whose message starts with `prefix`. */
export function pickWatermark(
  commits: HistoryCommit[],
  prefix: string
): number {
  const needle = prefix.trim();
  let max = 0;
  for (const c of commits) {
    const msg = c.commit?.message ?? "";
    if (!msg.trimStart().startsWith(needle)) continue;
    const date = c.commit?.author?.date;
    if (!date) continue;
    const ts = Math.floor(Date.parse(date) / 1000);
    if (ts > max) max = ts;
  }
  return max;
}
