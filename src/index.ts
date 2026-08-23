import * as core from "@actions/core";
import { context } from "@actions/github";
import { Octokit } from "@octokit/rest";
import { parseConfig } from "./config";
import { LeetCodeClient } from "./leetcode";
import { runSync } from "./sync";

async function main(): Promise<void> {
  const config = parseConfig(core.getInput("config", { required: true }));
  const octokit = new Octokit({ auth: core.getInput("github-token", { required: true }) });
  const client = new LeetCodeClient(
    core.getInput("leetcode-session", { required: true }),
    core.getInput("leetcode-csrf-token", { required: true }),
    config.client.delayMs,
    config.site
  );

  const summary = await runSync({
    octokit,
    client,
    config,
    dryRun: core.getBooleanInput("dry-run"),
    verbose: core.getBooleanInput("verbose"),
    currentRepo: { owner: context.repo.owner, name: context.repo.repo },
  });

  core.setOutput("synced", String(summary.synced));
  core.setOutput("skipped-filtered", String(summary.skippedFiltered));
  core.setOutput("watermark", String(summary.watermark));
}

main().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
