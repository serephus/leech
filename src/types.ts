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

export interface FileTemplate {
  /** Nunjucks template for the file path (relative to `destination`). */
  filename: string;
  /** Nunjucks template for the file content. */
  content: string;
}

export interface FilterConfig {
  status: "accepted" | "all";
  languages: string[];
  excludeLanguages: string[];
  problems: string[];
  excludeProblems: string[];
  /** Unix seconds. */
  since?: number;
  /** Unix seconds. */
  until?: number;
}

export interface CommitConfig {
  /** Message prefix. Also the marker identifying sync commits in history (watermark). */
  prefix: string;
  /** Nunjucks template rendered after the prefix. */
  message: string;
  authorName: string;
  authorEmail: string;
}

export interface ClientConfig {
  /** Delay between LeetCode GraphQL calls, in ms. */
  delayMs: number;
}

export interface RenderConfig {
  /** Throw on undefined template variables instead of rendering them empty. */
  throwOnUndefined: boolean;
}

export interface LeechConfig {
  repo?: { owner: string; name: string };
  branch?: string;
  destination: string;
  filters: FilterConfig;
  files: FileTemplate[];
  commit: CommitConfig;
  client: ClientConfig;
  render: RenderConfig;
}

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
