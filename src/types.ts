/** A submission as returned by the paginated submissions list endpoint. */
export interface SubmissionListEntry {
  id: number;
  title: string;
  titleSlug: string;
  /** Unix seconds. */
  timestamp: number;
  statusDisplay: string;
  lang: string;
  runtime: string | null;
  memory: string | null;
}

/** A submission enriched with its code and performance stats (GraphQL). */
export interface SubmissionDetails {
  id: number;
  timestamp: number;
  statusDisplay: string;
  lang: string;
  code: string;
  runtime: string | null;
  memory: string | null;
  runtimePercentile: number | null;
  memoryPercentile: number | null;
}

/** Problem metadata plus the raw HTML description. */
export interface Question {
  frontendId: string;
  title: string;
  titleSlug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  contentHtml: string;
  acceptanceRate: number | null;
  isPaidOnly: boolean;
}

// Config types are derived from the zod schema in src/config.ts.
export type {
  FileTemplate,
  FilterConfig,
  CommitConfig,
  ClientConfig,
  RenderConfig,
  LeechConfig,
} from "./config";

export interface SyncSummary {
  /** Submissions considered (newer than the watermark). */
  scanned: number;
  /** Submissions removed by filters. */
  skippedFiltered: number;
  /** Commits created (or planned in dry-run mode). */
  synced: number;
  /** Unix seconds. */
  watermark: number;
}
