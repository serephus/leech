import nunjucks from "nunjucks";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { Question, SubmissionDetails } from "./types";

const LANG_TO_EXTENSION: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  dart: "dart",
  elixir: "ex",
  erlang: "erl",
  golang: "go",
  java: "java",
  javascript: "js",
  kotlin: "kt",
  mssql: "sql",
  mysql: "sql",
  oraclesql: "sql",
  php: "php",
  python: "py",
  python3: "py",
  pythondata: "py",
  postgresql: "sql",
  racket: "rkt",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  swift: "swift",
  typescript: "ts",
  html: "html",
  css: "css",
};

/** Maps a LeetCode language id to a file extension (falls back to the id itself). */
export function langExt(lang: string): string {
  return LANG_TO_EXTENSION[lang] ?? lang;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Pads a value with leading zeros to at least `width` digits (no truncation). */
export function pad(value: string | number, width = 4): string {
  const s = String(value);
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

/**
 * Formats a unix-seconds timestamp (UTC). Supported tokens:
 * YYYY MM DD HH mm ss — e.g. datefmt(1704067200, 'YYYY-MM-DD') => '2024-01-01'.
 */
export function datefmt(value: number | string | Date, fmt = "YYYY-MM-DD"): string {
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "number") {
    d = new Date(value * 1000);
  } else {
    const n = Number(value);
    d = n > 0 && value.trim() !== "" ? new Date(n * 1000) : new Date(Date.parse(value));
  }
  if (Number.isNaN(d.getTime())) return "";
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case "YYYY":
        return String(d.getUTCFullYear()).padStart(4, "0");
      case "MM":
        return String(d.getUTCMonth() + 1).padStart(2, "0");
      case "DD":
        return String(d.getUTCDate()).padStart(2, "0");
      case "HH":
        return String(d.getUTCHours()).padStart(2, "0");
      case "mm":
        return String(d.getUTCMinutes()).padStart(2, "0");
      case "ss":
        return String(d.getUTCSeconds()).padStart(2, "0");
      default:
        return tok;
    }
  });
}

/* ------------------------------------------------------------------ */
/* HTML -> Markdown                                                    */
/* ------------------------------------------------------------------ */

let turndown: TurndownService | null = null;

/** Converts LeetCode problem-description HTML to GitHub-flavored markdown. */
export function toMarkdown(html: string): string {
  if (turndown === null) {
    turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**",
    });
    turndown.use(gfm); // tables, strikethrough, task lists
    turndown.addRule("superscript", {
      filter: ["sup"],
      replacement: (content: string) => `^${content}^`,
    });
    turndown.addRule("subscript", {
      filter: ["sub"],
      replacement: (content: string) => `~${content}~`,
    });
  }
  if (!html.trim()) return "";
  const md = turndown.turndown(html);
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------------------------------------------ */
/* Templates (Nunjucks)                                                */
/* ------------------------------------------------------------------ */

let env: nunjucks.Environment | null = null;
let renderOptions: nunjucks.ConfigureOptions = {
  autoescape: false,
  throwOnUndefined: false,
};

/**
 * Applies rendering options before templates render (rebuilds the template
 * environment). Call once with the parsed config, e.g. from runSync.
 */
export function configureRender(options: {
  throwOnUndefined: boolean;
}): void {
  renderOptions = {
    autoescape: false,
    throwOnUndefined: options.throwOnUndefined,
  };
  env = null;
}

function getEnv(): nunjucks.Environment {
  if (env === null) {
    env = new nunjucks.Environment(null, renderOptions);
    env.addFilter("datefmt", datefmt);
    env.addFilter("slugify", slugify);
    env.addFilter("pad", pad);
    env.addFilter("ext", langExt);
  }
  return env;
}

/** Renders a template (content or commit message). Undefined variables render empty. */
export function renderTemplate(
  template: string,
  context: object
): string {
  return getEnv().renderString(template, context as Record<string, unknown>);
}

/**
 * Renders a filename template and sanitizes every path segment:
 * replaces reserved characters, collapses runs of dashes, trims dots/dashes,
 * and never produces an empty segment.
 */
export function renderFilename(
  template: string,
  context: object,
  destination: string
): string {
  const rendered = renderTemplate(template, context);
  if (!rendered.trim()) {
    throw new Error(`filename template rendered empty: "${template}"`);
  }
  const segments = rendered
    .split("/")
    .map(sanitizeSegment)
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error(`filename template rendered empty: "${template}"`);
  }
  const path = segments.join("/");
  return destination ? `${destination}/${path}` : path;
}

function sanitizeSegment(segment: string): string {
  const out = segment
    .replace(/[/\\?%*:|"<>\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return out || "untitled";
}

/* ------------------------------------------------------------------ */
/* Template context                                                    */
/* ------------------------------------------------------------------ */

export interface TemplateContext {
  submission: {
    id: number;
    timestamp: number;
    date: string;
    lang: string;
    lang_ext: string;
    code: string;
    status: string;
    runtime: string | null;
    memory: string | null;
    runtime_percentile: number | null;
    memory_percentile: number | null;
  };
  question: {
    frontend_id: string;
    title: string;
    title_slug: string;
    difficulty: string;
    tags: string[];
    url: string;
    content_html: string;
    content_md: string;
    acceptance_rate: number | null;
    is_paid_only: boolean;
  };
}

export function buildContext(
  submission: SubmissionDetails,
  question: Question
): TemplateContext {
  return {
    submission: {
      id: submission.id,
      timestamp: submission.timestamp,
      date: datefmt(submission.timestamp, "YYYY-MM-DD"),
      lang: submission.lang,
      lang_ext: langExt(submission.lang),
      code: submission.code,
      status: submission.statusDisplay,
      runtime: submission.runtime,
      memory: submission.memory,
      runtime_percentile: submission.runtimePercentile,
      memory_percentile: submission.memoryPercentile,
    },
    question: {
      frontend_id: question.frontendId,
      title: question.title,
      title_slug: question.titleSlug,
      difficulty: question.difficulty,
      tags: question.tags,
      url: `https://leetcode.com/problems/${question.titleSlug}/`,
      content_html: question.contentHtml,
      content_md: toMarkdown(question.contentHtml),
      acceptance_rate: question.acceptanceRate,
      is_paid_only: question.isPaidOnly,
    },
  };
}
