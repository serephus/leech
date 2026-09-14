import { describe, expect, it } from "vitest";
import {
  applyFilters,
  applyQuestionFilters,
  needsQuestionMetadata,
} from "../src/filters";
import type { Question, SubmissionListEntry } from "../src/types";

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
  difficulty: [],
  excludeDifficulty: [],
  tags: [],
  excludeTags: [],
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

  it("treats null time bounds as no bound", () => {
    expect(applyFilters(entries, { ...base, since: null, until: null }).map((e) => e.id)).toEqual([1, 3, 4]);
    expect(applyFilters(entries, { ...base, since: null, until: 250 }).map((e) => e.id)).toEqual([1]);
    expect(applyFilters(entries, { ...base, since: 250, until: null }).map((e) => e.id)).toEqual([3, 4]);
  });
});

const mkQuestion = (
  difficulty: Question["difficulty"],
  tags: string[]
): Question => ({
  frontendId: "1",
  title: "t",
  titleSlug: "t",
  difficulty,
  tags,
  contentHtml: "",
  acceptanceRate: null,
  isPaidOnly: false,
});

describe("applyQuestionFilters", () => {
  const questions: Record<string, Question | null> = {
    "two-sum": mkQuestion("Easy", ["Array", "Hash Table"]),
    "add-two-numbers": mkQuestion("Medium", ["Linked List", "Math"]),
    "median-of-two-sorted-arrays": mkQuestion("Hard", [
      "Array",
      "Binary Search",
    ]),
    missing: null,
  };
  const lookup = (slug: string) => questions[slug] ?? null;
  const qEntries = [
    mk(1, 100, "Accepted", "python3", "two-sum"),
    mk(2, 200, "Accepted", "python3", "add-two-numbers"),
    mk(3, 300, "Accepted", "python3", "median-of-two-sorted-arrays"),
    mk(4, 400, "Accepted", "python3", "missing"),
  ];

  it("is a no-op when no question filter is configured", () => {
    expect(needsQuestionMetadata(base)).toBe(false);
    expect(applyQuestionFilters(qEntries, lookup, base)).toBe(qEntries);
  });

  it("filters by difficulty include/exclude", () => {
    expect(
      applyQuestionFilters(qEntries, lookup, {
        ...base,
        difficulty: ["Easy", "Medium"],
      }).map((e) => e.id)
    ).toEqual([1, 2]);
    expect(
      applyQuestionFilters(qEntries, lookup, {
        ...base,
        excludeDifficulty: ["Hard"],
      }).map((e) => e.id)
    ).toEqual([1, 2]);
  });

  it("filters by tag include/exclude using any-match semantics", () => {
    expect(
      applyQuestionFilters(qEntries, lookup, { ...base, tags: ["Array"] }).map(
        (e) => e.id
      )
    ).toEqual([1, 3]);
    expect(
      applyQuestionFilters(qEntries, lookup, {
        ...base,
        excludeTags: ["Math", "Hash Table"],
      }).map((e) => e.id)
    ).toEqual([3]);
  });

  it("drops problems whose metadata is unavailable", () => {
    expect(
      applyQuestionFilters(qEntries, lookup, { ...base, tags: ["Array"] }).map(
        (e) => e.id
      )
    ).not.toContain(4);
  });

  it("combines difficulty and tag filters", () => {
    expect(
      applyQuestionFilters(qEntries, lookup, {
        ...base,
        difficulty: ["Easy", "Hard"],
        tags: ["Array"],
        excludeTags: ["Hash Table"],
      }).map((e) => e.id)
    ).toEqual([3]);
  });

  it("detects any question-level filter", () => {
    expect(needsQuestionMetadata({ ...base, tags: ["Array"] })).toBe(true);
    expect(
      needsQuestionMetadata({ ...base, excludeDifficulty: ["Hard"] })
    ).toBe(true);
  });
});
