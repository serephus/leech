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

Value flags also accept the --flag=value form.
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

/** Parses argv. Returns null after handling `--help`. Throws on invalid input. */
function parseArgs(argv: string[]): CliOptions | null {
  const opts: CliOptions = { dryRun: false, verbose: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    /** Returns the flag's value (inline `=value` or the next argument). */
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined) throw new Error(`missing value for ${flag}`);
      return next;
    };
    /** True for value-less flags; rejects `--flag=value`. */
    const enabled = (): boolean => {
      if (inline !== undefined) throw new Error(`${flag} takes no value`);
      return true;
    };

    switch (flag) {
      case "--help":
      case "-h":
        console.log(USAGE);
        return null;
      case "--config":
        opts.config = value();
        break;
      case "--session":
        opts.session = value();
        break;
      case "--csrf":
        opts.csrf = value();
        break;
      case "--token":
        opts.token = value();
        break;
      case "--repo":
        opts.repo = value();
        break;
      case "--branch":
        opts.branch = value();
        break;
      case "--dry-run":
        opts.dryRun = enabled();
        break;
      case "--verbose":
        opts.verbose = enabled();
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

/** Parses `owner/name`, rejecting extra path segments. */
function parseRepo(value: string): { owner: string; name: string } {
  const match = /^([^/]+)\/([^/]+)$/.exec(value);
  if (!match) throw new Error(`--repo must be owner/name, got "${value}"`);
  return { owner: match[1]!, name: match[2]! };
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
  if (argv.repo) config.repo = parseRepo(argv.repo);

  const token = argv.token ?? process.env.GITHUB_TOKEN;
  const session = argv.session ?? process.env.LEETCODE_SESSION;
  const csrf = argv.csrf ?? process.env.LEETCODE_CSRF_TOKEN;
  if (!token) throw new Error("missing --token (or GITHUB_TOKEN)");
  if (!session || !csrf) {
    throw new Error(
      "missing --session/--csrf (or LEETCODE_SESSION/LEETCODE_CSRF_TOKEN)"
    );
  }

  const octokit = new Octokit({ auth: token });
  const client = new LeetCodeClient(
    session,
    csrf,
    config.client.delayMs,
    config.site
  );
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
