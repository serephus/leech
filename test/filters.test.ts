import { describe, expect, it } from "vitest";
import { applyFilters } from "../src/filters";
import type { SubmissionListEntry } from "../src/types";

const mk = (
  id: number,
  timestamp: number,
  statusDisplay: string,
  lang: string,
  titleSlug: string
): SubmissionListEntry => ({
  id,
  title: titleSlug,
  titleSlug,
  timestamp,
  statusDisplay,
  lang,
  runtime: null,
  memory: null,
});

const entries = [
  mk(1, 100, "Accepted", "python3", "two-sum"),
  mk(2, 200, "Wrong Answer", "python3", "two-sum"),
  mk(3, 300, "Accepted", "rust", "add-two-numbers"),
  mk(4, 400, "Accepted", "typescript", "two-sum"),
];

const base = {
  status: "accepted" as const,
  languages: [],
  excludeLanguages: [],
  problems: [],
  excludeProblems: [],
};

describe("applyFilters", () => {
  it("keeps only accepted by default", () => {
    expect(applyFilters(entries, base).map((e) => e.id)).toEqual([1, 3, 4]);
  });

  it("keeps all statuses when configured", () => {
    expect(applyFilters(entries, { ...base, status: "all" })).toHaveLength(4);
  });

  it("filters by language include/exclude", () => {
    expect(applyFilters(entries, { ...base, languages: ["rust"] }).map((e) => e.id)).toEqual([3]);
    expect(applyFilters(entries, { ...base, excludeLanguages: ["python3"] }).map((e) => e.id)).toEqual([3, 4]);
  });

  it("filters by problem include/exclude", () => {
    expect(applyFilters(entries, { ...base, problems: ["two-sum"] }).map((e) => e.id)).toEqual([1, 4]);
    expect(applyFilters(entries, { ...base, excludeProblems: ["two-sum"] }).map((e) => e.id)).toEqual([3]);
  });

  it("filters by time bounds", () => {
    expect(applyFilters(entries, { ...base, since: 250 }).map((e) => e.id)).toEqual([3, 4]);
    expect(applyFilters(entries, { ...base, until: 250 }).map((e) => e.id)).toEqual([1]);
    expect(applyFilters(entries, { ...base, since: 150, until: 350 }).map((e) => e.id)).toEqual([3]);
  });
});
