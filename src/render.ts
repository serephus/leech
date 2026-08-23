import nunjucks from "nunjucks";
import TurndownService from "turndown";
import {
  strikethrough as gfmStrikethrough,
  tables as gfmTables,
  taskListItems as gfmTaskListItems,
} from "turndown-plugin-gfm";
import * as domino from "@mixmark-io/domino";
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

/**
 * Pads a value with `char` to at least `width` characters (no truncation).
 * Multi-character padding strings repeat and are cut to fit.
 */
export function pad(value: string | number, width = 4, char = "0"): string {
  const s = String(value);
  if (s.length >= width) return s;
  const padChar = char || "0";
  const needed = width - s.length;
  return padChar.repeat(Math.ceil(needed / padChar.length)).slice(0, needed) + s;
}

/**
 * Picks a fenced-code-block delimiter: the shortest run of `char` (at least
 * `minLength`) that does not appear anywhere in `content`.
 */
function pickFence(content: string, char: string, minLength = 3): string {
  let max = 0;
  let run = 0;
  for (const c of content) {
    run = c === char ? run + 1 : 0;
    if (run > max) max = run;
  }
  return char.repeat(Math.max(minLength, max + 1));
}

export interface CodeBlockOptions {
  /** Fence character (default "`"). */
  fence?: "`" | "~";
}

/**
 * Wraps content in a fenced code block with an optional language id. The
 * fence is chosen so it cannot collide with the content (longest run of the
 * fence character in the content plus one).
 */
export function codeBlock(
  content: string,
  lang?: string,
  options?: CodeBlockOptions
): string {
  const char = options?.fence ?? "`";
  const fence = pickFence(content, char);
  return `${fence}${lang ?? ""}\n${content.replace(/\n$/, "")}\n${fence}\n`;
}

/**
 * Replaces matches of a regular expression (Nunjucks `replace` only handles
 * literal strings). Pass flags such as `"g"` for all matches.
 */
export function regexReplace(
  value: string,
  pattern: string,
  replacement: string,
  flags?: string
): string {
  return value.replace(new RegExp(pattern, flags), replacement);
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

/**
 * Wrapper `[prefix, suffix]` applied around `<sup>`/`<sub>` content, or
 * `false` to render the content inline without any wrapper.
 */
export interface SupSubOptions {
  /** Wrapper for `<sup>` (markdown default `["^", "^"]`, typst default `["^", ""]`). */
  superscript?: [string, string] | false;
  /** Wrapper for `<sub>` (markdown default `["~", "~"]`, typst default `["_", ""]`). */
  subscript?: [string, string] | false;
}

/** Options for markdown conversion (Turndown options plus GFM toggles). */
export interface MarkdownOptions extends SupSubOptions {
  /** Enable GitHub-flavored markdown (tables, strikethrough, task lists); default false. */
  gfm?: boolean;
  /** Convert tables (default true; only applies when gfm is enabled). */
  tables?: boolean;
  /** Convert strikethrough (default true; only applies when gfm is enabled). */
  strikethrough?: boolean;
  /** Convert task-list checkboxes (default true; only applies when gfm is enabled). */
  taskListItems?: boolean;
  headingStyle?: "setext" | "atx";
  hr?: string;
  bulletListMarker?: "-" | "*" | "+";
  codeBlockStyle?: "indented" | "fenced";
  fence?: "```" | "~~~";
  emDelimiter?: "_" | "*";
  strongDelimiter?: "__" | "**";
  linkStyle?: "inlined" | "referenced";
  linkReferenceStyle?: "full" | "collapsed" | "shortcut";
}

export type MarkdownFilter = (html: string, options?: MarkdownOptions) => string;

export const MARKDOWN_DEFAULTS = {
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
} as const;

const turndownCache = new Map<string, TurndownService>();

function createTurndown(options: MarkdownOptions): TurndownService {
  const service = new TurndownService({ ...MARKDOWN_DEFAULTS, ...options });
  if (options.gfm ?? false) {
    const {
      tables = true,
      strikethrough = true,
      taskListItems = true,
    } = options;
    if (tables) gfmTables(service);
    if (taskListItems) gfmTaskListItems(service);
    if (strikethrough) {
      gfmStrikethrough(service);
      // turndown-plugin-gfm's strikethrough rule emits single tildes (pre-GFM
      // spec); GitHub uses `~~`, so override it.
      service.addRule("strikethrough", {
        filter: ["del", "s", "strike"],
        replacement: (content: string) => `~~${content}~~`,
      });
    }
  }
  const { superscript = ["^", "^"], subscript = ["~", "~"] } = options;
  if (superscript) {
    service.addRule("superscript", {
      filter: ["sup"],
      replacement: (content: string) =>
        `${superscript[0]}${content}${superscript[1]}`,
    });
  }
  if (subscript) {
    service.addRule("subscript", {
      filter: ["sub"],
      replacement: (content: string) =>
        `${subscript[0]}${content}${subscript[1]}`,
    });
  }
  return service;
}

function getTurndown(options: MarkdownOptions): TurndownService {
  const key = JSON.stringify(options);
  let service = turndownCache.get(key);
  if (!service) {
    service = createTurndown(options);
    turndownCache.set(key, service);
  }
  return service;
}

function convertMarkdown(html: string, options: MarkdownOptions): string {
  if (!html.trim()) return "";
  const md = getTurndown(options).turndown(html);
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Creates a markdown conversion filter. The returned filter also accepts
 * per-call options that override the factory options. Pass `{ gfm: true }`
 * for GitHub-flavored markdown (tables, strikethrough, task lists).
 */
export function makeToMarkdown(options?: MarkdownOptions): MarkdownFilter {
  return (html, callOptions) =>
    convertMarkdown(html, { ...options, ...callOptions });
}

/** Default markdown filter (standard; pass `{ gfm: true }` for GitHub-flavored). */
export const toMarkdown = makeToMarkdown();
/**
 * GitHub-flavored variant: `toMarkdown` preconfigured with `{ gfm: true }`.
 * Kept for compatibility; prefer `{{ content | toMarkdown({ gfm: true }) }}`.
 */
export const toGfm = makeToMarkdown({ gfm: true });

/* ------------------------------------------------------------------ */
/* HTML -> Typst                                                       */
/* ------------------------------------------------------------------ */

/** Options for Typst conversion. */
export interface TypstOptions extends SupSubOptions {
  /** Heading prefixes for levels 1-6 (default `["", "= ", "== ", ...]`). */
  headingPrefixes?: string[];
  /** Code fence marker (default "```"). */
  codeFence?: string;
  /** Escape Typst special characters in text (default true). */
  escape?: boolean;
  /** Horizontal-rule markup (default `#line(length: 100%)`). */
  hr?: string;
}

export type TypstFilter = (html: string, options?: TypstOptions) => string;

interface TypstRendererOptions {
  headingPrefixes: string[];
  codeFence: string;
  escape: boolean;
  hr: string;
  superscript: [string, string] | false;
  subscript: [string, string] | false;
}

const TYPST_DEFAULTS: TypstRendererOptions = {
  headingPrefixes: ["", "= ", "== ", "=== ", "==== ", "===== ", "====== "],
  codeFence: "```",
  escape: true,
  hr: "#line(length: 100%)",
  superscript: ["^", ""],
  subscript: ["_", ""],
};

/** Escapes Typst markup special characters in plain text. */
function escapeTypstText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/@/g, "\\@")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_");
}

function makeTypstConverter(options: TypstOptions): (html: string) => string {
  const opts: TypstRendererOptions = { ...TYPST_DEFAULTS, ...options };

  function escapeText(text: string): string {
    return opts.escape ? escapeTypstText(text) : text;
  }

  /** Renders the children of `node` as inline Typst markup. */
  function inline(node: domino.DomNode): string {
    let out = "";
    for (const child of node.childNodes) {
      out += renderNode(child);
    }
    return out;
  }

  function renderNode(node: domino.DomNode): string {
    if (node.nodeType === 3) return escapeText(node.textContent ?? "");
    const tag = node.nodeName.toLowerCase();
    switch (tag) {
      case "p":
      case "div":
        return `${inline(node).trim()}\n\n`;
      case "br":
        return "\\\\";
      case "strong":
      case "b":
        return `*${inline(node)}*`;
      case "em":
      case "i":
        return `_${inline(node)}_`;
      case "code":
        return `\`${node.textContent ?? ""}\``;
      case "pre": {
        const code = node.childNodes.find((c) => c.nodeName === "CODE");
        const lang =
          code?.getAttribute("class")?.match(/language-(\S+)/)?.[1] ?? "";
        const text = code?.textContent ?? node.textContent ?? "";
        const fence = pickFence(text, opts.codeFence[0] ?? "`", opts.codeFence.length || 3);
        return `\n${fence}${lang}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
      }
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(tag[1]);
        return `${opts.headingPrefixes[level] ?? ""}${inline(node).trim()}\n\n`;
      }
      case "ul":
      case "ol": {
        const marker = tag === "ol" ? "+ " : "- ";
        let out = "";
        for (const li of node.childNodes) {
          if (li.nodeName !== "LI") continue;
          out += `\n${marker}${inline(li).trim()}`;
        }
        return `${out}\n\n`;
      }
      case "a": {
        const href = node.getAttribute("href") ?? "";
        const text = inline(node).trim();
        return text ? `#link("${href}")[${text}]` : `#link("${href}")`;
      }
      case "img":
        return `#image("${node.getAttribute("src") ?? ""}")`;
      case "sup":
        return opts.superscript
          ? `${opts.superscript[0]}${inline(node)}${opts.superscript[1]}`
          : inline(node);
      case "sub":
        return opts.subscript
          ? `${opts.subscript[0]}${inline(node)}${opts.subscript[1]}`
          : inline(node);
      case "del":
      case "s":
      case "strike":
        return `#strike[${inline(node)}]`;
      case "u":
        return `#underline[${inline(node)}]`;
      case "mark":
        return `#highlight[${inline(node)}]`;
      case "small":
        return `#small[${inline(node)}]`;
      case "blockquote":
        return `#quote[${inline(node)}]`;
      case "hr":
        return `${opts.hr}\n\n`;
      case "script":
      case "style":
      case "head":
      case "title":
      case "meta":
      case "noscript":
      case "template":
        return "";
      case "table": {
        const rows = node.childNodes.filter((n) => n.nodeName === "TR");
        if (rows.length === 0) return "";
        const cells = rows.map((r) =>
          r.childNodes
            .filter((n) => n.nodeName === "TD" || n.nodeName === "TH")
            .map((c) => inline(c).trim())
        );
        const cols = Math.max(...cells.map((r) => r.length));
        const flat = cells.flat();
        return `#table(columns: ${cols}, ${flat.map((c) => `[${c}]`).join(", ")})\n\n`;
      }
      default:
        return inline(node);
    }
  }

  return (html: string): string => {
    if (!html.trim()) return "";
    const doc = domino.createDocument(html);
    return inline(doc.body).replace(/\n{3,}/g, "\n\n").trim() + "\n";
  };
}

/**
 * Creates a Typst conversion filter. The returned filter also accepts
 * per-call options that override the factory options.
 */
export function makeToTypst(options?: TypstOptions): TypstFilter {
  return (html, callOptions) =>
    makeTypstConverter({ ...options, ...callOptions })(html);
}

/** Default Typst filter. */
export const toTypst = makeToTypst();

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
    env.addFilter("codeBlock", codeBlock);
    env.addFilter("regexReplace", regexReplace);
    env.addFilter("toMarkdown", toMarkdown);
    env.addFilter("toGfm", toGfm);
    env.addFilter("toTypst", toTypst);
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
    content: string;
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
      content: question.contentHtml,
      acceptance_rate: question.acceptanceRate,
      is_paid_only: question.isPaidOnly,
    },
  };
}
