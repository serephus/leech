import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectWorkspace,
  hookEnvVars,
  materializeWorkspace,
  resolveOnError,
  runHook,
  scrubEnv,
} from "../src/hooks";
import type { CommitFile } from "../src/git";
import { configureRender } from "../src/render";

const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), "leech-test-"));

describe("scrubEnv", () => {
  it("removes action/leech secrets but keeps the rest", () => {
    const env = scrubEnv({
      PATH: "/usr/bin",
      KEEP: "v",
      INPUT_GITHUB_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      GH_TOKEN: "secret",
      LEETCODE_SESSION: "s",
      LEETCODE_CSRF_TOKEN: "c",
      ACTIONS_RUNTIME_TOKEN: "r",
      ACTIONS_ID_TOKEN_REQUEST_URL: "u",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.KEEP).toBe("v");
    for (const key of [
      "INPUT_GITHUB_TOKEN",
      "GITHUB_TOKEN",
      "GH_TOKEN",
      "LEETCODE_SESSION",
      "LEETCODE_CSRF_TOKEN",
      "ACTIONS_RUNTIME_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_URL",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });
});

describe("hookEnvVars", () => {
  it("renders the LEECH_* convenience variables", () => {
    const vars = hookEnvVars({
      hook: "submission",
      phase: "before-commit",
      repo: "o/r",
      branch: "main",
      destination: "solutions",
      site: "leetcode.com",
      dryRun: true,
      verbose: false,
      workspace: "/tmp/w",
      submission: { id: 7, timestamp: 1234, lang: "python3" },
      question: { titleSlug: "two-sum", title: "Two Sum", frontendId: "1" },
    });
    expect(vars).toMatchObject({
      LEECH_HOOK: "submission",
      LEECH_PHASE: "before-commit",
      LEECH_REPO: "o/r",
      LEECH_BRANCH: "main",
      LEECH_DESTINATION: "solutions",
      LEECH_SITE: "leetcode.com",
      LEECH_DRY_RUN: "true",
      LEECH_VERBOSE: "false",
      LEECH_HOOK_DIR: "/tmp/w",
      LEECH_SUBMISSION_ID: "7",
      LEECH_SUBMISSION_TIMESTAMP: "1234",
      LEECH_SUBMISSION_LANG: "python3",
      LEECH_QUESTION_SLUG: "two-sum",
      LEECH_QUESTION_TITLE: "Two Sum",
      LEECH_FRONTEND_ID: "1",
    });
  });
});

describe("resolveOnError", () => {
  it("resolves hook/global policies", () => {
    expect(resolveOnError(undefined, "fail", false)).toBe("fail");
    expect(resolveOnError(undefined, "warn", false)).toBe("warn");
    expect(resolveOnError("skip", "fail", true)).toBe("skip");
    // skip is demoted to warn outside the submission hook.
    expect(resolveOnError("skip", "fail", false)).toBe("warn");
  });
});

describe("workspace protocol", () => {
  it("round-trips edits, additions, and deletions", async () => {
    const dir = await tmp();
    try {
      const originals: CommitFile[] = [
        { path: "solutions/a.md", content: "hello", encoding: "utf-8" },
        {
          path: "solutions/img.png",
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          encoding: "base64",
        },
      ];
      await materializeWorkspace(dir, originals);

      await fs.writeFile(path.join(dir, "solutions/a.md"), "hello world");
      await fs.writeFile(path.join(dir, "solutions/new.txt"), "new");
      await fs.rm(path.join(dir, "solutions/img.png"));

      const collected = await collectWorkspace(dir, originals);
      expect(collected.map((f) => f.path)).toEqual([
        "solutions/a.md",
        "solutions/new.txt",
      ]);
      expect(collected[0]!).toMatchObject({
        content: "hello world",
        encoding: "utf-8",
      });
      expect(collected[1]!).toMatchObject({ content: "new", encoding: "utf-8" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves unchanged binary files byte-for-byte", async () => {
    const dir = await tmp();
    try {
      const bin = Buffer.from([0x00, 0x01, 0x02, 0xff]);
      const originals: CommitFile[] = [
        { path: "img.png", content: bin, encoding: "base64" },
      ];
      await materializeWorkspace(dir, originals);
      const collected = await collectWorkspace(dir, originals);
      expect(collected[0]!.content).toBe(bin);
      expect(collected[0]!.encoding).toBe("base64");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("re-encodes changed binary files as base64", async () => {
    const dir = await tmp();
    try {
      const originals: CommitFile[] = [
        {
          path: "img.png",
          content: Buffer.from([0x89, 0x50]),
          encoding: "base64",
        },
      ];
      await materializeWorkspace(dir, originals);
      await fs.writeFile(path.join(dir, "img.png"), Buffer.from([0x00, 0x00]));
      const collected = await collectWorkspace(dir, originals);
      expect(collected[0]!.encoding).toBe("base64");
      expect((collected[0]!.content as Buffer).equals(Buffer.from([0x00, 0x00]))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runHook", () => {
  it("renders run as a Nunjucks template", async () => {
    const dir = await tmp();
    try {
      const out = path.join(dir, "out.txt");
      const result = await runHook(
        {
          run: "printf '%s' '{{ question.title_slug }}' > \"$OUT\"",
          env: { OUT: out },
        },
        { question: { title_slug: "two-sum" } },
        {
          shell: "bash",
          name: "t",
          verbose: false,
          defaultTimeoutMs: 5000,
          baseEnv: process.env,
        }
      );
      expect(result.ok).toBe(true);
      expect((await fs.readFile(out, "utf8")).trim()).toBe("two-sum");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes the context as JSON on stdin", async () => {
    const dir = await tmp();
    try {
      const out = path.join(dir, "stdin.json");
      const context = { hook: "pre", watermark: 42, nested: { a: 1 } };
      const result = await runHook(
        { run: "cat > \"$OUT\"", env: { OUT: out } },
        context,
        {
          shell: "bash",
          name: "t",
          verbose: false,
          defaultTimeoutMs: 5000,
          baseEnv: process.env,
        }
      );
      expect(result.ok).toBe(true);
      expect(JSON.parse(await fs.readFile(out, "utf8"))).toEqual(context);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports non-zero exits", async () => {
    const result = await runHook(
      { run: "exit 3" },
      {},
      {
        shell: "bash",
        name: "t",
        verbose: false,
        defaultTimeoutMs: 5000,
        baseEnv: process.env,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited with code 3/);
  });

  it("times out long-running hooks", async () => {
    const result = await runHook(
      { run: "sleep 5", timeoutMs: 100 },
      {},
      {
        shell: "bash",
        name: "t",
        verbose: false,
        defaultTimeoutMs: 5000,
        baseEnv: process.env,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it("turns template render errors into hook errors", async () => {
    configureRender({ throwOnUndefined: true });
    try {
      const result = await runHook(
        { run: "echo {{ does_not_exist }}" },
        {},
        {
          shell: "bash",
          name: "t",
          verbose: false,
          defaultTimeoutMs: 5000,
          baseEnv: process.env,
        }
      );
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/render/);
    } finally {
      configureRender({ throwOnUndefined: false });
    }
  });
});
