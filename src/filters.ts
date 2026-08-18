import type { FilterConfig, SubmissionListEntry } from "./types";

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
    if (filters.since !== undefined && entry.timestamp < filters.since) {
      return false;
    }
    if (filters.until !== undefined && entry.timestamp > filters.until) {
      return false;
    }
    return true;
  });
}
