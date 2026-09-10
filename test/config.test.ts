import { describe, expect, it } from "vitest";
import { parseBound, parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("applies defaults", () => {
    const cfg = parseConfig("files:\n  - filename: a.md\n    content: x");
    expect(cfg.filters.status).toBe("accepted");
    expect(cfg.commit.prefix).toBe("leech:");
    expect(cfg.commit.message).toContain("{{ question.title }}");
    expect(cfg.destination).toBe("solutions");
    expect(cfg.site).toBe("leetcode.com");
    expect(cfg.assets).toBeNull();
    expect(cfg.client.delayMs).toBe(250);
    expect(cfg.render.throwOnUndefined).toBe(false);
    expect(cfg.branch).toBeUndefined();
    expect(cfg.repo).toBeUndefined();
  });

  it("uses the default markdown layout when files is omitted", () => {
    const cfg = parseConfig("repo:\n  owner: serephus\n  name: solutions");
    expect(cfg.files).toHaveLength(2);
    expect(cfg.files[0]!.filename).toBe(
      "{{ question.title_slug }}/README.md"
    );
    expect(cfg.files[0]!.content).toContain(
      "{{ question.content | toMarkdown({ gfm: true }) }}"
    );
    expect(cfg.files[1]!.filename).toContain("{{ submission.lang_ext }}");
  });

  it("normalizes assets and allows disabling", () => {
    expect(parseConfig('assets: null').assets).toBeNull();
    expect(parseConfig('assets: ""').assets).toBe("");
    expect(parseConfig("assets: /static/images/").assets).toBe("static/images");
  });

  it("parses the site", () => {
    expect(parseConfig("site: leetcode.cn").site).toBe("leetcode.cn");
    expect(parseConfig("site: leetcode.com").site).toBe("leetcode.com");
    expect(() => parseConfig("site: foo")).toThrow(/invalid config/);
  });

  it("parses filters and bounds", () => {
    const cfg = parseConfig(`filters:
  status: all
  languages: [python3]
  excludeProblems: [two-sum]
  since: "2024-01-01"
files:
  - filename: x.md
    content: x`);
    expect(cfg.filters.status).toBe("all");
    expect(cfg.filters.languages).toEqual(["python3"]);
    expect(cfg.filters.excludeProblems).toEqual(["two-sum"]);
    expect(cfg.filters.since).toBe(Date.parse("2024-01-01") / 1000);
  });

  it("parses render options", () => {
    const cfg = parseConfig("render:\n  throwOnUndefined: true\nfiles:\n  - filename: x.md\n    content: x");
    expect(cfg.render.throwOnUndefined).toBe(true);
  });

  it("normalizes destination", () => {
    const cfg = parseConfig("destination: /solutions/\nfiles:\n  - filename: x.md\n    content: x");
    expect(cfg.destination).toBe("solutions");
  });

  it("rejects invalid config", () => {
    expect(() => parseConfig("files: []")).toThrow(/invalid config/);
    expect(() => parseConfig("not: [valid: yaml")).toThrow(/not valid YAML/);
    expect(() => parseConfig("just a string")).toThrow(/must be a YAML mapping/);
  });

  it("accepts null filter bounds (documented as \"no bound\")", () => {
    const cfg = parseConfig(
      "filters:\n  since: null\n  until: null\nfiles:\n  - filename: x.md\n    content: x"
    );
    expect(cfg.filters.since).toBeNull();
    expect(cfg.filters.until).toBeNull();
  });

  it("rejects a garbage filter bound through the schema", () => {
    // parseBound's raw error propagates (same as before the schema refactor).
    expect(() =>
      parseConfig("filters:\n  since: not-a-date\nfiles:\n  - filename: x.md\n    content: x")
    ).toThrow(/cannot parse date bound/);
  });
});

describe("parseBound", () => {
  it("keeps unix seconds", () => {
    expect(parseBound(1234)).toBe(1234);
  });
  it("parses numeric strings as seconds", () => {
    expect(parseBound("1234")).toBe(1234);
  });
  it("parses date strings", () => {
    expect(parseBound("2024-01-01")).toBe(Date.parse("2024-01-01") / 1000);
  });
  it("rejects garbage", () => {
    expect(() => parseBound("not-a-date")).toThrow();
  });
});

describe("parseConfig hooks", () => {
  it("applies hook defaults and disables hooks when omitted", () => {
    const cfg = parseConfig("files:\n  - filename: a.md\n    content: x");
    expect(cfg.hooks.shell).toBe("bash");
    expect(cfg.hooks.timeoutMs).toBe(30000);
    expect(cfg.hooks.onError).toBe("fail");
    expect(cfg.hooks.pre).toBeUndefined();
    expect(cfg.hooks.submission).toBeUndefined();
    expect(cfg.hooks.post).toBeUndefined();
  });

  it("expands the string shorthand", () => {
    const cfg = parseConfig(`hooks:
  pre: echo hi
  submission: npx prettier --write .
  post: node index.mjs
files:
  - filename: x.md
    content: x`);
    expect(cfg.hooks.pre).toEqual({ run: "echo hi" });
    expect(cfg.hooks.submission).toEqual({
      run: "npx prettier --write .",
      when: "before-commit",
    });
    expect(cfg.hooks.post).toEqual({ run: "node index.mjs" });
  });

  it("parses full hook objects", () => {
    const cfg = parseConfig(`hooks:
  shell: /bin/sh
  timeoutMs: 1000
  onError: warn
  pre:
    run: echo hi
    cwd: /tmp
    timeoutMs: 500
    onError: warn
    env:
      FOO: bar
  submission:
    when: after-commit
    run: echo after
    onError: skip
  post:
    run: node index.mjs
    commit: null
files:
  - filename: x.md
    content: x`);
    expect(cfg.hooks.shell).toBe("/bin/sh");
    expect(cfg.hooks.timeoutMs).toBe(1000);
    expect(cfg.hooks.onError).toBe("warn");
    expect(cfg.hooks.pre).toMatchObject({
      run: "echo hi",
      cwd: "/tmp",
      timeoutMs: 500,
      onError: "warn",
      env: { FOO: "bar" },
    });
    expect(cfg.hooks.submission).toMatchObject({
      when: "after-commit",
      run: "echo after",
      onError: "skip",
    });
    expect(cfg.hooks.post).toMatchObject({
      run: "node index.mjs",
      commit: null,
    });
  });

  it("rejects invalid hooks", () => {
    expect(() =>
      parseConfig("hooks:\n  submission:\n    when: bogus")
    ).toThrow(/invalid config/);
    // `skip` is only valid for the submission hook.
    expect(() =>
      parseConfig("hooks:\n  pre:\n    run: echo hi\n    onError: skip")
    ).toThrow(/invalid config/);
  });
});
