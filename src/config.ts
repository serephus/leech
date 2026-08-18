import { load } from "js-yaml";
import { z } from "zod";
import type { FileTemplate, LeechConfig } from "./types";

export const DEFAULT_COMMIT_PREFIX = "leech:";

const DEFAULT_FILTERS = {
  status: "accepted" as const,
  languages: [] as string[],
  excludeLanguages: [] as string[],
  problems: [] as string[],
  excludeProblems: [] as string[],
};

const DEFAULT_COMMIT = {
  prefix: DEFAULT_COMMIT_PREFIX,
  message: "Sync {{ question.title }} ({{ submission.lang }})",
  authorName: "leech-bot",
  authorEmail: "leech-bot@users.noreply.github.com",
};

const DEFAULT_CLIENT = { delayMs: 250 };

/** Default output layout: one folder per problem (under `destination`, default `solutions/`). */
export const DEFAULT_FILES: FileTemplate[] = [
  {
    filename: "{{ question.title_slug }}/README.md",
    content: `---
title: "{{ question.title }}"
id: {{ question.frontend_id }}
slug: "{{ question.title_slug }}"
difficulty: {{ question.difficulty }}
lang: "{{ submission.lang }}"
status: "{{ submission.status }}"
timestamp: {{ submission.timestamp }}
date: "{{ submission.timestamp | datefmt('YYYY-MM-DD') }}"
tags: [{% for t in question.tags %}"{{ t }}"{% if not loop.last %}, {% endif %}{% endfor %}]
---

# {{ question.title }}

{{ question.content_md }}
`,
  },
  {
    filename: "{{ question.title_slug }}/{{ submission.lang }}.{{ submission.lang_ext }}",
    content: `{{ submission.code }}
`,
  },
];

const fileTemplateSchema = z.object({
  filename: z.string().min(1),
  content: z.string(),
});

const configSchema = z.object({
  repo: z
    .object({ owner: z.string().min(1), name: z.string().min(1) })
    .optional(),
  branch: z.string().min(1).optional(),
  destination: z.string().default("solutions"),
  filters: z
    .object({
      status: z.enum(["accepted", "all"]).default(DEFAULT_FILTERS.status),
      languages: z.array(z.string()).default(DEFAULT_FILTERS.languages),
      excludeLanguages: z
        .array(z.string())
        .default(DEFAULT_FILTERS.excludeLanguages),
      problems: z.array(z.string()).default(DEFAULT_FILTERS.problems),
      excludeProblems: z
        .array(z.string())
        .default(DEFAULT_FILTERS.excludeProblems),
      since: z.union([z.number(), z.string()]).optional(),
      until: z.union([z.number(), z.string()]).optional(),
    })
    .default({ ...DEFAULT_FILTERS }),
  files: z.array(fileTemplateSchema).min(1).default(DEFAULT_FILES),
  commit: z
    .object({
      prefix: z.string().min(1).default(DEFAULT_COMMIT.prefix),
      message: z.string().default(DEFAULT_COMMIT.message),
      authorName: z.string().default(DEFAULT_COMMIT.authorName),
      authorEmail: z.string().default(DEFAULT_COMMIT.authorEmail),
    })
    .default({ ...DEFAULT_COMMIT }),
  client: z
    .object({
      delayMs: z
        .number()
        .int()
        .min(0)
        .max(10000)
        .default(DEFAULT_CLIENT.delayMs),
    })
    .default({ ...DEFAULT_CLIENT }),
});

export function parseConfig(raw: string): LeechConfig {
  let data: unknown;
  try {
    data = load(raw);
  } catch (err) {
    throw new Error(`config is not valid YAML: ${(err as Error).message}`);
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object") {
    throw new Error("config must be a YAML mapping");
  }

  const parsed = configSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid config: ${details}`);
  }

  return {
    repo: parsed.data.repo,
    branch: parsed.data.branch,
    destination: normalizeDestination(parsed.data.destination),
    filters: {
      status: parsed.data.filters.status,
      languages: parsed.data.filters.languages,
      excludeLanguages: parsed.data.filters.excludeLanguages,
      problems: parsed.data.filters.problems,
      excludeProblems: parsed.data.filters.excludeProblems,
      since:
        parsed.data.filters.since === undefined
          ? undefined
          : parseBound(parsed.data.filters.since),
      until:
        parsed.data.filters.until === undefined
          ? undefined
          : parseBound(parsed.data.filters.until),
    },
    files: parsed.data.files,
    commit: parsed.data.commit,
    client: parsed.data.client,
  };
}

function normalizeDestination(dest: string): string {
  return dest.replace(/^\/+|\/+$/g, "");
}

/** Parses a filter bound: unix seconds, a numeric string, or an ISO/date string. */
export function parseBound(value: number | string): number {
  if (typeof value === "number") return Math.floor(value);
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const ts = Date.parse(trimmed);
  if (Number.isNaN(ts)) {
    throw new Error(`cannot parse date bound "${value}"`);
  }
  return Math.floor(ts / 1000);
}
