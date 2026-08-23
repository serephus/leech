import { describe, expect, it } from "vitest";
import {
  assetFilename,
  assetReference,
  extractAssetUrls,
  relativeAssetPath,
  rewriteAssetUrls,
} from "../src/assets";
import { renderTemplate, toMarkdown, toTypst } from "../src/render";

describe("extractAssetUrls", () => {
  it("finds absolute http(s) img srcs only", () => {
    const html =
      '<p>x</p><img src="https://assets.leetcode.com/uploads/2021/07/19/img_1.png" alt=""/>' +
      '<img src="/local.png"/><img src="data:image/png;base64,AAAA"/>';
    expect(extractAssetUrls(html)).toEqual([
      "https://assets.leetcode.com/uploads/2021/07/19/img_1.png",
    ]);
  });

  it("deduplicates repeated urls", () => {
    const html =
      '<img src="https://e.com/a.png"/><img src="https://e.com/a.png"/>';
    expect(extractAssetUrls(html)).toEqual(["https://e.com/a.png"]);
  });

  it("returns an empty list for no images", () => {
    expect(extractAssetUrls("<p>no images</p>")).toEqual([]);
  });
});

describe("assetFilename", () => {
  it("takes the last path segment", () => {
    expect(
      assetFilename("https://assets.leetcode.com/uploads/2021/07/19/img_1.png")
    ).toBe("img_1.png");
  });

  it("strips query and fragment", () => {
    expect(assetFilename("https://e.com/a/b.png?v=2#x")).toBe("b.png");
  });

  it("sanitizes unsafe characters", () => {
    expect(assetFilename("https://e.com/weird name!.png")).toBe(
      "weird-name-.png"
    );
  });

  it("falls back when the url has no filename", () => {
    expect(assetFilename("https://e.com/")).toBe("asset");
  });
});

describe("relativeAssetPath", () => {
  it("computes relative references between nested dirs", () => {
    expect(
      relativeAssetPath(
        "solutions/two-sum",
        "solutions/assets/two-sum/img_1.png"
      )
    ).toBe("../assets/two-sum/img_1.png");
    expect(
      relativeAssetPath("solutions", "solutions/assets/two-sum/img_1.png")
    ).toBe("assets/two-sum/img_1.png");
    expect(
      relativeAssetPath("", "solutions/assets/two-sum/img_1.png")
    ).toBe("solutions/assets/two-sum/img_1.png");
  });

  it("reaches root-level assets from nested files", () => {
    expect(
      relativeAssetPath("solutions/two-sum", "assets/two-sum/img_1.png")
    ).toBe("../../assets/two-sum/img_1.png");
    expect(relativeAssetPath("solutions", "assets/two-sum/img_1.png")).toBe(
      "../assets/two-sum/img_1.png"
    );
    expect(relativeAssetPath("", "assets/two-sum/img_1.png")).toBe(
      "assets/two-sum/img_1.png"
    );
  });
});

describe("assetReference", () => {
  it("uses relative paths when assetRef is empty", () => {
    expect(
      assetReference(
        "",
        "solutions/two-sum",
        "assets/img_1.png",
        "img_1.png"
      )
    ).toBe("../../assets/img_1.png");
  });

  it("uses root-absolute paths when assetRef is set", () => {
    expect(
      assetReference(
        "/images",
        "solutions/two-sum",
        "static/images/img_1.png",
        "img_1.png"
      )
    ).toBe("/images/img_1.png");
  });

  it("renders a templated assets folder before resolving", () => {
    const ctx = { question: { title_slug: "two-sum" } };
    const assetsDir = renderTemplate("assets/{{ question.title_slug }}", ctx);
    const storage = `${assetsDir}/img_1.png`;
    expect(storage).toBe("assets/two-sum/img_1.png");
    expect(
      assetReference("", "solutions/two-sum", storage, "img_1.png")
    ).toBe("../../assets/two-sum/img_1.png");
  });
});

describe("rewriteAssetUrls", () => {
  it("replaces exact urls", () => {
    const html = '<p><img src="https://e.com/u/i.png"/></p>';
    const out = rewriteAssetUrls(
      html,
      new Map([["https://e.com/u/i.png", "../assets/two-sum/i.png"]])
    );
    expect(out).toBe('<p><img src="../assets/two-sum/i.png"/></p>');
  });
});

describe("assets + conversion", () => {
  it("renders local asset references in markdown and typst", () => {
    const html =
      '<p>see</p><img src="https://assets.leetcode.com/uploads/i.png" alt=""/>';
    const map = new Map([
      ["https://assets.leetcode.com/uploads/i.png", "../assets/two-sum/i.png"],
    ]);
    const rewritten = rewriteAssetUrls(html, map);
    expect(toMarkdown(rewritten)).toContain("![](../assets/two-sum/i.png)");
    expect(toTypst(rewritten)).toContain('#image("../assets/two-sum/i.png")');
  });
});
