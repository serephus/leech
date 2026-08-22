import { afterEach, describe, expect, it } from "vitest";
import {
  buildContext,
  codeBlock,
  configureRender,
  datefmt,
  langExt,
  makeToMarkdown,
  makeToTypst,
  pad,
  regexReplace,
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

  it("does not emit GFM-only syntax", () => {
    const md = toMarkdown(
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"
    );
    expect(md).not.toContain("|");
  });
});

describe("toMarkdown gfm mode", () => {
  it("converts tables to pipe tables", () => {
    const md = toMarkdown(
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
      { gfm: true }
    );
    expect(md).toContain("| a | b |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("converts strikethrough", () => {
    expect(toMarkdown("<p><del>gone</del></p>", { gfm: true })).toContain(
      "~~gone~~"
    );
  });

  it("handles empty input", () => {
    expect(toMarkdown("", { gfm: true })).toBe("");
  });
});

describe("makeToMarkdown", () => {
  it("applies factory options", () => {
    const md = makeToMarkdown({ headingStyle: "setext" })("<h1>Hi</h1>");
    expect(md).toContain("Hi\n==");
  });

  it("per-call options override factory options", () => {
    const md = makeToMarkdown({ headingStyle: "setext" })("<h1>Hi</h1>", {
      headingStyle: "atx",
    });
    expect(md).toContain("# Hi");
  });

  it("enables gfm from factory options", () => {
    const md = makeToMarkdown({ gfm: true })(
      "<table><tr><th>a</th></tr><tr><td>1</td></tr></table>"
    );
    expect(md).toContain("|");
  });

  it("disables tables in gfm mode", () => {
    const md = makeToMarkdown({ gfm: true, tables: false })(
      "<table><tr><th>a</th></tr><tr><td>1</td></tr></table>"
    );
    expect(md).not.toContain("|");
  });

  it("disables strikethrough in gfm mode", () => {
    const md = makeToMarkdown({ gfm: true, strikethrough: false })(
      "<p><del>gone</del></p>"
    );
    expect(md).not.toContain("~");
  });
});

describe("makeToTypst", () => {
  it("applies custom heading prefixes", () => {
    const ts = makeToTypst({ headingPrefixes: ["", "H1 ", "H2 "] })(
      "<h2>Hi</h2>"
    );
    expect(ts).toContain("H2 Hi");
  });

  it("customizes the code fence", () => {
    const ts = makeToTypst({ codeFence: "~~~" })(
      '<pre><code class="language-python">x\n</code></pre>'
    );
    expect(ts).toContain("~~~python");
  });

  it("disables escaping", () => {
    const ts = makeToTypst({ escape: false })("<p>cost $10</p>");
    expect(ts).toContain("cost $10");
  });

  it("customizes the horizontal rule", () => {
    const ts = makeToTypst({ hr: "#line()" })("<hr>");
    expect(ts).toContain("#line()");
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
    expect(renderTemplate("{{ question.content | toMarkdown({ gfm: true }) }}", ctx)).toContain(
      "Given `nums`, return *indices*"
    );
    expect(renderTemplate("{{ question.content | toTypst }}", ctx)).toContain(
      "Given `nums`, return _indices_."
    );
    expect(
      renderTemplate("{{ submission.code | codeBlock(submission.lang_ext) }}", ctx)
    ).toBe("```py\nprint('hi')\n```\n");
    expect(renderTemplate("{{ 'a1b2' | regexReplace('[0-9]', 'X', 'g') }}", ctx)).toBe(
      "aXbX"
    );
    expect(renderTemplate("{{ question.frontend_id | pad(3, '-') }}", ctx)).toBe(
      "--1"
    );
  });

  it("passes filter options from templates", () => {
    expect(
      renderTemplate("{{ html | toMarkdown({ headingStyle: 'setext' }) }}", {
        html: "<h1>Hi</h1>",
      })
    ).toContain("Hi\n==");
    expect(
      renderTemplate("{{ html | toMarkdown({ gfm: true }) }}", {
        html: "<table><tr><th>a</th></tr></table>",
      })
    ).toContain("|");
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
  it("supports a custom padding char", () => {
    expect(pad("7", 3, "-")).toBe("--7");
    expect(pad("ab", 5, "-=")).toBe("-=-ab");
    expect(pad("1234", 4, "*")).toBe("1234");
  });
});

describe("codeBlock", () => {
  it("wraps content in a fenced block with a language", () => {
    expect(codeBlock("print('hi')\n", "python")).toBe(
      "```python\nprint('hi')\n```\n"
    );
  });

  it("lengthens the fence to avoid collisions", () => {
    const out = codeBlock("a\n```\nb", "md");
    expect(out).toBe("````md\na\n```\nb\n````\n");
  });

  it("supports a tilde fence", () => {
    expect(codeBlock("x", "python", { fence: "~" })).toBe(
      "~~~python\nx\n~~~\n"
    );
  });

  it("handles empty content", () => {
    expect(codeBlock("")).toBe("```\n\n```\n");
  });
});

describe("regexReplace", () => {
  it("replaces with a regex and flags", () => {
    expect(regexReplace("a1b2", "[0-9]", "X", "g")).toBe("aXbX");
  });

  it("replaces only the first match without the g flag", () => {
    expect(regexReplace("a1b2", "[0-9]", "X")).toBe("aXb2");
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
