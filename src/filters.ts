import type { FilterConfig, Question, SubmissionListEntry } from "./types";

/** Applies the configured filters to a list of submissions (newest-first from the API). */
export function applyFilters(
  entries: SubmissionListEntry[],
  filters: FilterConfig
): SubmissionListEntry[] {
  return entries.filter((entry) => {
    if (filters.status === "accepted" && entry.statusDisplay !== "Accepted") {
      return false;
    }
    if (
      filters.languages.length > 0 &&
      !filters.languages.includes(entry.lang)
    ) {
      return false;
    }
    if (filters.excludeLanguages.includes(entry.lang)) return false;
    if (
      filters.problems.length > 0 &&
      !filters.problems.includes(entry.titleSlug)
    ) {
      return false;
    }
    if (filters.excludeProblems.includes(entry.titleSlug)) return false;
    // `null`/undefined both mean "no bound" (the README documents `until: null`).
    if (filters.since != null && entry.timestamp < filters.since) {
      return false;
    }
    if (filters.until != null && entry.timestamp > filters.until) {
      return false;
    }
    return true;
  });
}

/**
 * True when any configured filter needs question metadata (difficulty/tags),
 * which the submission list does not include and must be fetched separately.
 */
export function needsQuestionMetadata(filters: FilterConfig): boolean {
  return (
    filters.difficulty.length > 0 ||
    filters.excludeDifficulty.length > 0 ||
    filters.tags.length > 0 ||
    filters.excludeTags.length > 0
  );
}

/**
 * Applies the question-level filters (difficulty, tags) using a pre-fetched
 * question per titleSlug. `lookup` returns null for problems whose metadata is
 * unavailable (locked/premium); those are dropped, since they can't be shown to
 * match. Returns the input unchanged when no question filter is configured.
 *
 * Tag lists use "any" semantics: `tags` keeps a problem that has at least one
 * of the listed tags, `excludeTags` drops a problem that has any of them.
 */
export function applyQuestionFilters(
  entries: SubmissionListEntry[],
  lookup: (titleSlug: string) => Question | null,
  filters: FilterConfig
): SubmissionListEntry[] {
  if (!needsQuestionMetadata(filters)) return entries;
  return entries.filter((entry) => {
    const question = lookup(entry.titleSlug);
    if (!question) return false;
    if (
      filters.difficulty.length > 0 &&
      !filters.difficulty.includes(question.difficulty)
    ) {
      return false;
    }
    if (filters.excludeDifficulty.includes(question.difficulty)) return false;
    if (
      filters.tags.length > 0 &&
      !question.tags.some((tag) => filters.tags.includes(tag))
    ) {
      return false;
    }
    if (question.tags.some((tag) => filters.excludeTags.includes(tag))) {
      return false;
    }
    return true;
  });
}
