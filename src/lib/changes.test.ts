import { describe, expect, it } from "vitest";
import type { Status, StatusEntry } from "../api";
import { changeCountTitle, uncommittedCount } from "./changes";

const entry = (path: string, kind: StatusEntry["kind"]): StatusEntry => ({ path, origPath: null, kind, staged: ".", unstaged: "M" });
const status = (entries: StatusEntry[]): Status => ({ branch: { oid: null, head: "main", upstream: null, ahead: 0, behind: 0 }, entries });

describe("uncommittedCount", () => {
  it("counts every changed file except ignored ones", () => {
    expect(uncommittedCount(status([entry("a", "modified"), entry("b", "untracked"), entry("c", "ignored"), entry("d", "renamed")]))).toBe(3);
    expect(uncommittedCount(status([]))).toBe(0);
  });

  it("is unknown without a status", () => {
    expect(uncommittedCount(null)).toBeNull();
  });
});

describe("changeCountTitle", () => {
  it("says how many files have uncommitted changes", () => {
    expect(changeCountTitle(1)).toBe("1 file with uncommitted changes");
    expect(changeCountTitle(14)).toBe("14 files with uncommitted changes");
  });
});
