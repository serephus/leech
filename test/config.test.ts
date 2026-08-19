import { describe, expect, it } from "vitest";
import { parseBound, parseConfig } from "../src/config";

describe("parseConfig", () => {
  it("applies defaults", () => {
    const cfg = parseConfig("files:\n  - filename: a.md\n    content: x");
    expect(cfg.filters.status).toBe("accepted");
    expect(cfg.commit.prefix).toBe("leech:");
    expect(cfg.commit.message).toContain("{{ question.title }}");
    expect(cfg.destination).toBe("solutions");
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
    expect(cfg.files[0]!.content).toContain("{{ question.content_md }}");
    expect(cfg.files[1]!.filename).toContain("{{ submission.lang_ext }}");
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
