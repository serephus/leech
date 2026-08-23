import { load } from "js-yaml";
import { z } from "zod";

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

const DEFAULT_RENDER = { throwOnUndefined: false };

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

{{ question.content | toMarkdown({ gfm: true }) }}
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

export const filterConfigSchema = z
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
    since: z
      .union([z.number(), z.string()])
      .transform(parseBound)
      .nullish(),
    until: z
      .union([z.number(), z.string()])
      .transform(parseBound)
      .nullish(),
  })
  .default({ ...DEFAULT_FILTERS });

export const commitConfigSchema = z
  .object({
    prefix: z.string().min(1).default(DEFAULT_COMMIT.prefix),
    message: z.string().default(DEFAULT_COMMIT.message),
    authorName: z.string().default(DEFAULT_COMMIT.authorName),
    authorEmail: z.string().default(DEFAULT_COMMIT.authorEmail),
  })
  .default({ ...DEFAULT_COMMIT });

export const clientConfigSchema = z
  .object({
    delayMs: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(DEFAULT_CLIENT.delayMs),
  })
  .default({ ...DEFAULT_CLIENT });

export const renderConfigSchema = z
  .object({
    throwOnUndefined: z
      .boolean()
      .default(DEFAULT_RENDER.throwOnUndefined),
  })
  .default({ ...DEFAULT_RENDER });

export const configSchema = z.object({
  repo: z
    .object({ owner: z.string().min(1), name: z.string().min(1) })
    .optional(),
  branch: z.string().min(1).optional(),
  destination: z
    .string()
    .default("solutions")
    .transform(normalizeDestination),
  assets: z
    .string()
    .default("assets")
    .transform(normalizeDestination),
  filters: filterConfigSchema,
  files: z.array(fileTemplateSchema).min(1).default(DEFAULT_FILES),
  commit: commitConfigSchema,
  client: clientConfigSchema,
  render: renderConfigSchema,
});

// Config types are derived from the zod schema so they cannot drift from it.
export type FileTemplate = z.infer<typeof fileTemplateSchema>;
export type FilterConfig = z.infer<typeof filterConfigSchema>;
export type CommitConfig = z.infer<typeof commitConfigSchema>;
export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type RenderConfig = z.infer<typeof renderConfigSchema>;
export type LeechConfig = z.infer<typeof configSchema>;

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

  return parsed.data;
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
