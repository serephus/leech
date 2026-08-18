#!/usr/bin/env node
import fs from "node:fs";
import { Octokit } from "@octokit/rest";
import { parseConfig } from "./config";
import { LeetCodeClient } from "./leetcode";
import { runSync } from "./sync";

const USAGE = `leech — local runner

Usage:
  node dist/cli.js [options]

Options:
  --config <yaml|@file>  Inline YAML config, or a file path prefixed with @ (env: LEECH_CONFIG)
  --session <cookie>     LeetCode LEETCODE_SESSION cookie (env: LEETCODE_SESSION)
  --csrf <cookie>        LeetCode csrftoken cookie (env: LEETCODE_CSRF_TOKEN)
  --token <token>        GitHub token with contents:write (env: GITHUB_TOKEN)
  --repo owner/name      Target repository (overrides config.repo)
  --branch <name>        Target branch (overrides config.branch)
  --dry-run              Render and log only; create no commits
  --verbose              Verbose logging
  --help                 Show this help
`;

interface CliOptions {
  config?: string;
  session?: string;
  csrf?: string;
  token?: string;
  repo?: string;
  branch?: string;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliOptions | null {
  const opts: CliOptions = { dryRun: false, verbose: false };
  const take = (i: number): string => {
    const value = argv[i];
    if (value === undefined) {
      throw new Error(`missing value for ${argv[i - 1] ?? "argument"}`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        console.log(USAGE);
        return null;
      case "--config":
        opts.config = take(++i);
        break;
      case "--session":
        opts.session = take(++i);
        break;
      case "--csrf":
        opts.csrf = take(++i);
        break;
      case "--token":
        opts.token = take(++i);
        break;
      case "--repo":
        opts.repo = take(++i);
        break;
      case "--branch":
        opts.branch = take(++i);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const argv = parseArgs(process.argv.slice(2));
  if (!argv) return;

  const rawConfig = argv.config ?? process.env.LEECH_CONFIG;
  if (!rawConfig) throw new Error("missing --config (or LEECH_CONFIG)");
  const configYaml = rawConfig.startsWith("@")
    ? fs.readFileSync(rawConfig.slice(1), "utf8")
    : rawConfig;

  const config = parseConfig(configYaml);
  if (argv.branch) config.branch = argv.branch;
  if (argv.repo) {
    const [owner, name] = argv.repo.split("/");
    if (!owner || !name) {
      throw new Error(`--repo must be owner/name, got "${argv.repo}"`);
    }
    config.repo = { owner, name };
  }

  const token = argv.token ?? process.env.GITHUB_TOKEN;
  const session = argv.session ?? process.env.LEETCODE_SESSION;
  const csrf = argv.csrf ?? process.env.LEETCODE_CSRF_TOKEN;
  if (!token) throw new Error("missing --token (or GITHUB_TOKEN)");
  if (!session || !csrf) {
    throw new Error("missing --session/--csrf (or LEETCODE_SESSION/LEETCODE_CSRF_TOKEN)");
  }

  const octokit = new Octokit({ auth: token });
  const client = new LeetCodeClient(session, csrf, config.client.delayMs);
  const summary = await runSync({
    octokit,
    client,
    config,
    dryRun: argv.dryRun,
    verbose: argv.verbose,
  });

  console.log(
    `\nsummary: synced=${summary.synced} filtered=${summary.skippedFiltered} watermark=${summary.watermark}`
  );
}

main().catch((err: unknown) => {
  console.error(`leech: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
