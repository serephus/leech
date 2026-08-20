import { afterEach, describe, expect, it } from "vitest";
import {
  buildContext,
  configureRender,
  datefmt,
  langExt,
  pad,
  renderFilename,
  renderTemplate,
  toMarkdown,
  toTypst,
} from "../src/render";
import type { Question, SubmissionDetails } from "../src/types";

const submission: SubmissionDetails = {
  id: 123,
  timestamp: 1704067200, // 2024-01-01T00:00:00Z
  statusDisplay: "Accepted",
  lang: "python3",
  code: "print('hi')\n",
  runtime: "42 ms",
  memory: "13.5 MB",
  runtimePercentile: 88.1,
  memoryPercentile: 75.2,
};

const question: Question = {
  frontendId: "1",
  title: "Two Sum",
  titleSlug: "two-sum",
  difficulty: "Easy",
  tags: ["Array", "Hash Table"],
  contentHtml:
    "<p>Given <code>nums</code>, return <em>indices</em>.</p>" +
    '<pre><code class="language-python">def f(): pass\n</code></pre>' +
    "<p>Up to 10<sup>9</sup>.</p><ul><li>a &lt; b</li></ul>",
  acceptanceRate: 53.2,
  isPaidOnly: false,
};

describe("toMarkdown", () => {
  it("converts common LeetCode HTML", () => {
    const md = toMarkdown(question.contentHtml);
    expect(md).toContain("Given `nums`, return *indices*");
    expect(md).toContain("```python");
    expect(md).toContain("10^9^");
    expect(md).toContain("a < b");
  });

  it("handles empty input", () => {
    expect(toMarkdown("")).toBe("");
  });
});

describe("toTypst", () => {
  it("converts common LeetCode HTML", () => {
    const ts = toTypst(question.contentHtml);
    expect(ts).toContain("Given `nums`, return _indices_.");
    expect(ts).toContain("```python");
    expect(ts).toContain("Up to 10^9.");
    expect(ts).toContain("- a < b");
  });

  it("converts sup/sub to native typst syntax", () => {
    const ts = toTypst("<p>H<sub>2</sub>O and 10<sup>9</sup></p>");
    expect(ts).toContain("H_2O and 10^9");
  });

  it("escapes typst special characters in text", () => {
    expect(toTypst("<p>cost $10, a * b, #tag</p>")).toContain(
      "cost \\$10, a \\* b, \\#tag"
    );
  });

  it("converts links, formatting, and strikethrough", () => {
    expect(
      toTypst('<p><a href="https://e.com">x</a> <strong>b</strong> <del>d</del></p>')
    ).toContain('#link("https://e.com")[x] *b* #strike[d]');
  });

  it("drops script and style", () => {
    expect(toTypst("<p>x</p><script>alert(1)</script>")).toBe("x\n");
  });

  it("handles empty input", () => {
    expect(toTypst("")).toBe("");
  });
});

describe("templates", () => {
  it("renders variables and filters", () => {
    const ctx = buildContext(submission, question);
    expect(renderTemplate("{{ question.title }} in {{ submission.lang_ext }}", ctx)).toBe(
      "Two Sum in py"
    );
    expect(renderTemplate("{{ submission.timestamp | datefmt('YYYY-MM-DD') }}", ctx)).toBe(
      "2024-01-01"
    );
    expect(renderTemplate("{{ question.tags | join(', ') }}", ctx)).toBe(
      "Array, Hash Table"
    );
    expect(renderTemplate("{{ question.content | toMarkdown }}", ctx)).toContain(
      "Given `nums`, return *indices*"
    );
    expect(renderTemplate("{{ question.content | toTypst }}", ctx)).toContain(
      "Given `nums`, return _indices_."
    );
  });

  it("renders undefined variables as empty", () => {
    expect(renderTemplate("a{{ missing }}b", {})).toBe("ab");
  });

  it("sanitizes filenames", () => {
    const ctx = buildContext(submission, question);
    expect(
      renderFilename("solutions/{{ question.title_slug }}/README.md", ctx, "")
    ).toBe("solutions/two-sum/README.md");
    expect(
      renderFilename("{{ question.title }}: {{ submission.lang }}?/f.md", ctx, "")
    ).toBe("Two-Sum-python3/f.md");
    expect(
      renderFilename("solutions/{{ question.title_slug }}/README.md", ctx, "leech")
    ).toBe("leech/solutions/two-sum/README.md");
  });

  it("throws on empty rendered filename", () => {
    expect(() => renderFilename("{{ missing }}", {}, "")).toThrow(/rendered empty/);
  });
});

describe("datefmt", () => {
  it("formats unix seconds in UTC", () => {
    expect(datefmt(1704067200, "YYYY-MM-DD")).toBe("2024-01-01");
    expect(datefmt(1704067200, "YYYY/MM/DD HH:mm:ss")).toBe("2024/01/01 00:00:00");
  });
  it("handles invalid input", () => {
    expect(datefmt(Number.NaN)).toBe("");
  });
});

describe("langExt", () => {
  it("maps languages", () => {
    expect(langExt("python3")).toBe("py");
    expect(langExt("rust")).toBe("rs");
    expect(langExt("typescript")).toBe("ts");
    expect(langExt("brainfuck")).toBe("brainfuck");
  });
});

describe("pad", () => {
  it("pads to at least 4 digits", () => {
    expect(pad("1")).toBe("0001");
    expect(pad(42)).toBe("0042");
    expect(pad("1234")).toBe("1234");
    expect(pad("12345")).toBe("12345");
  });
  it("supports a custom width", () => {
    expect(pad("7", 3)).toBe("007");
  });
});

describe("throwOnUndefined", () => {
  afterEach(() => {
    configureRender({ throwOnUndefined: false });
  });

  it("renders undefined variables empty by default", () => {
    expect(renderTemplate("a{{ missing }}b", {})).toBe("ab");
  });

  it("throws when throwOnUndefined is enabled", () => {
    configureRender({ throwOnUndefined: true });
    expect(() => renderTemplate("a{{ missing }}b", {})).toThrow(
      /null or undefined/
    );
  });
});
