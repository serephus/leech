import { describe, expect, it } from "vitest";
import { collectCandidates, planAssets } from "../src/sync";
import type { SubmissionListEntry } from "../src/types";

const mk = (id: number, timestamp: number): SubmissionListEntry => ({
  id,
  title: `t${id}`,
  titleSlug: `t${id}`,
  timestamp,
  statusDisplay: "Accepted",
  lang: "python3",
  runtime: null,
  memory: null,
});

describe("collectCandidates", () => {
  it("stops at the watermark without fetching further pages", async () => {
    const pages = [
      { hasMore: true, submissions: [mk(5, 500), mk(4, 400)] },
      { hasMore: true, submissions: [mk(3, 300), mk(2, 200)] },
      { hasMore: false, submissions: [mk(1, 100)] },
    ];
    const offsets: number[] = [];
    const client = {
      listSubmissions: async (offset: number) => {
        offsets.push(offset);
        return pages[offsets.length - 1]!;
      },
    };

    const result = await collectCandidates(client, 250);

    expect(result.map((entry) => entry.id)).toEqual([5, 4, 3]);
    expect(offsets).toEqual([0, 2]);
  });

  it("paginates until the API reports no more pages", async () => {
    const pages = [
      { hasMore: true, submissions: [mk(2, 200)] },
      { hasMore: false, submissions: [mk(1, 100)] },
    ];
    let call = 0;
    const client = { listSubmissions: async () => pages[call++]! };

    const result = await collectCandidates(client, 0);

    expect(result.map((entry) => entry.id)).toEqual([2, 1]);
  });

  it("returns nothing when the newest submission is already synced", async () => {
    const client = {
      listSubmissions: async () => ({ hasMore: false, submissions: [mk(1, 100)] }),
    };
    expect(await collectCandidates(client, 100)).toEqual([]);
  });
});

describe("planAssets", () => {
  it("names assets from the url and deduplicates filename collisions", () => {
    const html =
      '<img src="https://e.com/a/img.png"/>' +
      '<img src="https://e.com/b/img.png"/>' +
      '<img src="https://e.com/a/img.png"/>';
    expect(planAssets(html)).toEqual([
      { url: "https://e.com/a/img.png", filename: "img.png" },
      { url: "https://e.com/b/img.png", filename: "1-img.png" },
    ]);
  });

  it("returns an empty plan for html without images", () => {
    expect(planAssets("<p>x</p>")).toEqual([]);
  });
});
