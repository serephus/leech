import { describe, expect, it } from "vitest";
import { pickWatermark } from "../src/state";

const mk = (message: string, date: string) => ({
  commit: { message, author: { date } },
});

describe("pickWatermark", () => {
  it("finds the max author date of prefixed commits", () => {
    const commits = [
      mk("chore: something else", "2024-05-01T00:00:00Z"),
      mk("leech: Sync Two Sum (python3)", "2024-03-15T10:00:00Z"),
      mk("leech: Sync Add Two Numbers (rust)", "2024-06-01T00:00:00Z"),
      mk("leech-extra: unrelated", "2025-01-01T00:00:00Z"),
    ];
    expect(pickWatermark(commits, "leech:")).toBe(
      Math.floor(Date.parse("2024-06-01T00:00:00Z") / 1000)
    );
  });

  it("matches the prefix against the start of the message", () => {
    const commits = [
      mk("[LeetCode Sync] add two-sum", "2024-02-01T00:00:00Z"),
      mk("leech: Sync Two Sum", "2024-01-01T00:00:00Z"),
    ];
    expect(pickWatermark(commits, "[LeetCode Sync]")).toBe(
      Math.floor(Date.parse("2024-02-01T00:00:00Z") / 1000)
    );
    expect(pickWatermark(commits, "leech:")).toBe(
      Math.floor(Date.parse("2024-01-01T00:00:00Z") / 1000)
    );
  });

  it("returns 0 when nothing matches", () => {
    expect(pickWatermark([mk("hello", "2024-01-01T00:00:00Z")], "leech:")).toBe(0);
    expect(pickWatermark([], "leech:")).toBe(0);
  });
});
