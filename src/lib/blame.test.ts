import { describe, expect, it } from "vitest";
import type { Blame } from "../api";
import { blameMargin, commitAtLine } from "./blame";

const A = "a".repeat(40);
const B = "b".repeat(40);
const Z = "0".repeat(40);
// Noon UTC, so the local date is the same day in every time zone the tests run in.
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`) / 1000;

const blame: Blame = {
  hunks: [
    { sha: A, start: 1, count: 2 },
    { sha: B, start: 3, count: 1 },
    { sha: Z, start: 4, count: 1 },
    { sha: A, start: 5, count: 1 },
  ],
  commits: {
    [A]: { authorName: "Ana Author", authorEmail: "ana@x", authorTime: day("2026-01-02"), summary: "first", uncommitted: false },
    [B]: { authorName: "Bartholomew Longname-Smith", authorEmail: "b@x", authorTime: day("2025-12-31"), summary: "edit", uncommitted: false },
    [Z]: { authorName: "Not Committed Yet", authorEmail: "not.committed.yet", authorTime: day("2026-10-29"), summary: "", uncommitted: true },
  },
};

describe("blameMargin", () => {
  it("labels the first line of each run with short SHA, author and date, then the line number", () => {
    const m = blameMargin(blame, 5);
    expect(m.text(1)).toBe("aaaaaaa Ana Author     2026-01-02  1");
    expect(m.text(2)).toBe("                                   2");
    expect(m.text(3)).toBe("bbbbbbb Bartholomew L… 2025-12-31  3");
    expect(m.text(4)).toBe("Uncommitted                        4");
    expect(m.text(5)).toBe("aaaaaaa Ana Author     2026-01-02  5");
    // Every line is as wide as the margin, so the numbers stay aligned.
    expect(new Set([1, 2, 3, 4, 5].map((n) => m.text(n).length))).toEqual(new Set([m.width]));
  });

  it("pads line numbers to the widest one and leaves lines blame does not know blank", () => {
    const m = blameMargin(blame, 120);
    expect(m.text(1).endsWith("    1")).toBe(true);
    expect(m.text(120)).toBe(" ".repeat(m.width - 3) + "120");
  });
});

describe("commitAtLine", () => {
  it("finds the commit of a line, but not for uncommitted or unknown lines", () => {
    expect(commitAtLine(blame, 1)).toBe(A);
    expect(commitAtLine(blame, 2)).toBe(A);
    expect(commitAtLine(blame, 3)).toBe(B);
    expect(commitAtLine(blame, 4)).toBeNull();
    expect(commitAtLine(blame, 5)).toBe(A);
    expect(commitAtLine(blame, 99)).toBeNull();
  });
});
