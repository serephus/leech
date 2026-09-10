import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { renderTemplate } from "./render";
import type { TemplateContext } from "./render";
import type { CommitFile } from "./git";
import type { HookErrorPolicy, SubmissionPhase } from "./config";
import type { SyncSummary } from "./types";

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

const SENSITIVE_ENV_KEY_RE = /^INPUT_/;
const SENSITIVE_ENV_KEYS = new Set([
  "LEETCODE_SESSION",
  "LEETCODE_CSRF_TOKEN",
  "LEECH_SESSION",
  "LEECH_CSRF",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
]);

/** Removes action/leech secrets so child hooks can never inherit them. */
export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SENSITIVE_ENV_KEY_RE.test(key) || SENSITIVE_ENV_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export interface HookEnvVars {
  hook: string;
  phase?: string;
  repo: string;
  branch: string;
  destination: string;
  site: string;
  dryRun: boolean;
  verbose: boolean;
  workspace?: string;
  submission?: { id: number; timestamp: number; lang: string };
  question?: { titleSlug: string; title: string; frontendId: string };
}

/** Builds the LEECH_* convenience variables exposed to hooks. */
export function hookEnvVars(v: HookEnvVars): Record<string, string> {
  return {
    LEECH_HOOK: v.hook,
    LEECH_PHASE: v.phase ?? "",
    LEECH_REPO: v.repo,
    LEECH_BRANCH: v.branch,
    LEECH_DESTINATION: v.destination,
    LEECH_SITE: v.site,
    LEECH_DRY_RUN: v.dryRun ? "true" : "false",
    LEECH_VERBOSE: v.verbose ? "true" : "false",
    LEECH_HOOK_DIR: v.workspace ?? "",
    LEECH_SUBMISSION_ID: v.submission ? String(v.submission.id) : "",
    LEECH_SUBMISSION_TIMESTAMP: v.submission
      ? String(v.submission.timestamp)
      : "",
    LEECH_SUBMISSION_LANG: v.submission?.lang ?? "",
    LEECH_QUESTION_SLUG: v.question?.titleSlug ?? "",
    LEECH_QUESTION_TITLE: v.question?.title ?? "",
    LEECH_FRONTEND_ID: v.question?.frontendId ?? "",
  };
}

/** Scrubs the process environment and overlays the LEECH_* variables. */
export function hookEnv(
  base: NodeJS.ProcessEnv,
  vars: Record<string, string>
): NodeJS.ProcessEnv {
  return { ...scrubEnv(base), ...vars };
}

/* ------------------------------------------------------------------ */
/* Hook context                                                        */
/* ------------------------------------------------------------------ */

export interface RepoContext {
  repo: { owner: string; name: string };
  branch: string;
  destination: string;
  site: string;
  dryRun: boolean;
  verbose: boolean;
}

export interface PreHookContext extends RepoContext {
  hook: "pre";
  watermark: number;
  prefix: string;
}

export interface SubmissionHookContext extends RepoContext {
  hook: "submission";
  phase: SubmissionPhase;
  index: number;
  total: number;
  submission: TemplateContext["submission"];
  question: TemplateContext["question"];
  files: { path: string; asset: boolean }[];
  workspace: string;
}

export interface PostHookContext extends RepoContext {
  hook: "post";
  summary: SyncSummary;
  finalWatermark: number;
  pushed: number;
  submissions: Array<{
    id: number;
    slug: string;
    lang: string;
    timestamp: number;
    files: string[];
  }>;
}

export function buildRepoContext(o: {
  owner: string;
  repo: string;
  branch: string;
  destination: string;
  site: string;
  dryRun: boolean;
  verbose: boolean;
}): RepoContext {
  return {
    repo: { owner: o.owner, name: o.repo },
    branch: o.branch,
    destination: o.destination,
    site: o.site,
    dryRun: o.dryRun,
    verbose: o.verbose,
  };
}

export function preHookContext(
  repo: RepoContext,
  watermark: number,
  prefix: string
): PreHookContext {
  return { ...repo, hook: "pre", watermark, prefix };
}

export function submissionHookContext(
  repo: RepoContext,
  phase: SubmissionPhase,
  index: number,
  total: number,
  context: TemplateContext,
  files: { path: string; asset: boolean }[],
  workspace: string
): SubmissionHookContext {
  return {
    ...repo,
    hook: "submission",
    phase,
    index,
    total,
    submission: context.submission,
    question: context.question,
    files,
    workspace,
  };
}

export function postHookContext(
  repo: RepoContext,
  summary: SyncSummary,
  finalWatermark: number,
  pushed: number,
  submissions: PostHookContext["submissions"]
): PostHookContext {
  return { ...repo, hook: "post", summary, finalWatermark, pushed, submissions };
}

/* ------------------------------------------------------------------ */
/* Workspace protocol                                                  */
/* ------------------------------------------------------------------ */

/**
 * Writes the given commit files into `dir` at their repo-relative paths so a
 * hook can edit/add/delete them in place.
 */
export async function materializeWorkspace(
  dir: string,
  files: CommitFile[]
): Promise<void> {
  const root = path.resolve(dir) + path.sep;
  for (const f of files) {
    const abs = path.resolve(dir, f.path);
    if (!abs.startsWith(root)) {
      throw new Error(`refusing to write outside workspace: ${f.path}`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const data =
      typeof f.content === "string"
        ? Buffer.from(f.content, "utf8")
        : f.content;
    await fs.writeFile(abs, data);
  }
}

/**
 * Reads the workspace back into commit files. Unchanged originals keep their
 * original content/encoding (so binary assets are never re-encoded); changed
 * or new files are detected as utf-8 or base64 by a NUL-byte heuristic.
 */
export async function collectWorkspace(
  dir: string,
  originals: CommitFile[]
): Promise<CommitFile[]> {
  const originalByPath = new Map(originals.map((f) => [f.path, f]));
  const collected: CommitFile[] = [];

  async function walk(rel: string): Promise<void> {
    const abs = rel ? path.join(dir, rel) : dir;
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(dir, relPath));
        const original = originalByPath.get(relPath);
        if (original) {
          const originalBytes =
            typeof original.content === "string"
              ? Buffer.from(original.content, "utf8")
              : original.content;
          if (bytes.equals(originalBytes)) {
            collected.push(original);
            continue;
          }
        }
        const binary = bytes.includes(0);
        collected.push({
          path: relPath,
          content: binary ? bytes : bytes.toString("utf8"),
          encoding: binary ? "base64" : "utf-8",
        });
      }
    }
  }

  await walk("");
  collected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return collected;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface ResolvedHook {
  run: string;
  cwd?: string;
  timeoutMs?: number;
  onError?: HookErrorPolicy;
  env?: Record<string, string>;
}

export interface RunHookResult {
  ok: boolean;
  timedOut: boolean;
  error?: string;
}

/**
 * Runs a hook command. `run`/`cwd`/`env` values are rendered as Nunjucks
 * templates against `context` first; the context is also written to stdin as
 * JSON. Returns ok/timedOut/error; exit-code policy is applied by the caller.
 */
export async function runHook(
  hook: ResolvedHook,
  context: object,
  opts: {
    shell: string;
    name: string;
    verbose: boolean;
    defaultTimeoutMs: number;
    baseEnv: NodeJS.ProcessEnv;
  }
): Promise<RunHookResult> {
  const timeoutMs = hook.timeoutMs ?? opts.defaultTimeoutMs;
  const env: NodeJS.ProcessEnv = { ...opts.baseEnv };

  let run: string;
  let cwd: string | undefined;
  try {
    run = renderTemplate(hook.run, context);
    cwd = hook.cwd ? renderTemplate(hook.cwd, context) : undefined;
    for (const [key, value] of Object.entries(hook.env ?? {})) {
      env[key] = renderTemplate(value, context);
    }
  } catch (err) {
    return {
      ok: false,
      timedOut: false,
      error: `render: ${(err as Error).message}`,
    };
  }

  return new Promise<RunHookResult>((resolve) => {
    let settled = false;
    let closed = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;

    const child = spawn(opts.shell, ["-e", "-o", "pipefail", "-c", run], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (result: RunHookResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        const killer = setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 2000);
        killer.unref();
      }, timeoutMs);
      timer.unref();
    }

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));

    // Spawn failures (e.g. missing shell) surface here rather than on close.
    child.on("error", (err) => {
      finish({ ok: false, timedOut, error: err.message });
    });

    child.on("close", (code, signal) => {
      closed = true;
      const output = [stdout.trimEnd(), stderr.trimEnd()]
        .filter((s) => s.length > 0)
        .join("\n");
      if (timedOut) {
        if (output) hookLog(opts.name, output);
        finish({
          ok: false,
          timedOut: true,
          error: `timed out after ${timeoutMs}ms`,
        });
        return;
      }
      if (code === 0) {
        if (opts.verbose && output) hookLog(opts.name, output);
        finish({ ok: true, timedOut: false });
      } else {
        if (output) hookLog(opts.name, output);
        finish({
          ok: false,
          timedOut: false,
          error: `exited with code ${code ?? signal ?? "unknown"}`,
        });
      }
    });

    child.stdin.on("error", () => {
      /* ignore EPIPE when the hook never reads stdin */
    });
    child.stdin.end(JSON.stringify(context));
  });
}

function hookLog(name: string, message: string): void {
  for (const line of message.split("\n")) {
    console.log(`[leech:hook:${name}] ${line}`);
  }
}

/** Resolves the effective error policy for a hook (skip only for submission). */
export function resolveOnError(
  hookOnError: HookErrorPolicy | undefined,
  globalOnError: HookErrorPolicy,
  allowSkip: boolean
): "fail" | "warn" | "skip" {
  const policy = hookOnError ?? globalOnError;
  if (policy === "skip" && !allowSkip) return "warn";
  return policy;
}
