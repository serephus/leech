import { afterEach, describe, expect, it, vi } from "vitest";
import { LeetCodeClient } from "../src/leetcode";

/** Stubs global fetch with a canned JSON response. */
function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      statusText: String(status),
      json: async () => body,
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeetCodeClient.listSubmissions", () => {
  it("throws when the session cookie is invalid (null hasNext/submissions)", async () => {
    mockFetch({ data: { submissionList: { hasNext: null, submissions: null } } });
    const client = new LeetCodeClient("session", "csrf", 0);
    await expect(client.listSubmissions(0)).rejects.toThrow(/session cookie/i);
  });

  it("throws when submissionList is missing from the response", async () => {
    mockFetch({ data: {} });
    const client = new LeetCodeClient("session", "csrf", 0);
    await expect(client.listSubmissions(0)).rejects.toThrow(/session cookie/i);
  });

  it("returns an empty page for a valid session with no submissions", async () => {
    mockFetch({ data: { submissionList: { hasNext: false, submissions: [] } } });
    const client = new LeetCodeClient("session", "csrf", 0);
    await expect(client.listSubmissions(0)).resolves.toEqual({
      hasMore: false,
      submissions: [],
    });
  });

  it("returns the normalized page for a valid session", async () => {
    const entry = {
      id: 42,
      title: "Two Sum",
      titleSlug: "two-sum",
      timestamp: 1704067200,
      statusDisplay: "Accepted",
      lang: "python3",
      runtime: "42 ms",
      memory: "13.5 MB",
    };
    mockFetch({
      data: { submissionList: { hasNext: true, submissions: [entry] } },
    });
    const client = new LeetCodeClient("session", "csrf", 0);
    await expect(client.listSubmissions(0)).resolves.toEqual({
      hasMore: true,
      submissions: [entry],
    });
  });
});
