import { describe, expect, it } from "vitest";
import type { Overview, WorktreeInfo, WorktreeSummary } from "../api";
import { branchLabel, railRows, railTitle, railVisible, unopenable, type RailInput } from "./rail";

const NOW = 1_000_000;
const info = (name: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({ path: `/src/${name}`, head: "0a1b2c3d4e5f", branch: `agent/${name}`, detached: false, bare: false, locked: null, prunable: null, isMain: false, displayPath: `/src/${name}`, missing: false, ...over });
const summary = (name: string, over: Partial<WorktreeSummary> = {}): WorktreeSummary => ({ path: `/src/${name}`, branch: `agent/${name}`, head: "0a1b2c3d4e5f", uncommitted: [], baseAhead: 0, baseBehind: 0, upstream: null, upstreamAhead: 0, upstreamBehind: 0, lastCommit: null, changedFiles: 0, linesAdded: 0, linesRemoved: 0, ...over });
const input = (o: Partial<RailInput>): RailInput => ({ worktrees: [], overview: null, changeCounts: {}, lastChange: {}, actions: {}, ...o });

describe("railRows", () => {
  it("keeps every worktree when the overview has not loaded", () => {
    const rows = railRows(input({ worktrees: [info("one"), info("gone", { missing: true })], changeCounts: { "/src/one": 2 } }), NOW);
    expect(rows.map((r) => r.name)).toEqual(["one", "gone"]);
    expect(rows[0]).toMatchObject({ changed: 2, state: "changes", added: 0, last: null });
    expect(rows[1].off).toBe("Missing or prunable");
  });

  it("keeps rows the overview cannot read", () => {
    const overview = { worktrees: [summary("one")], errors: {}, overlaps: [] } as unknown as Overview;
    const rows = railRows(input({ worktrees: [info("one"), info("store", { bare: true, head: null, branch: null })], overview }), NOW);
    expect(rows.map((r) => [r.name, r.branch, r.off])).toEqual([
      ["one", "agent/one", null],
      ["store", "bare", "Bare repository"],
    ]);
  });

  it("takes counts, lines, time and shared files from the overview", () => {
    const overview = {
      worktrees: [summary("one", { changedFiles: 3, linesAdded: 12, linesRemoved: 4, lastCommit: { authorDate: "1970-01-02T00:00:00Z" } as never }), summary("two", { changedFiles: 1 })],
      errors: {},
      overlaps: [{ a: "/src/one", b: "/src/two", files: ["a.ts", "b.ts"] }],
    } as unknown as Overview;
    const [one] = railRows(input({ worktrees: [info("one"), info("two")], overview, changeCounts: { "/src/one": 1 } }), NOW);
    expect(one).toMatchObject({ changed: 3, added: 12, removed: 4, shared: 2, last: 86_400 });
  });

  it("reads rejected before changing, and changing from the watcher", () => {
    const rows = railRows(input({ worktrees: [info("one"), info("two")], lastChange: { "/src/one": NOW - 1, "/src/two": NOW - 1 }, actions: { "/src/one": { rejected: true } } }), NOW);
    expect(rows.map((r) => r.state)).toEqual(["rejected", "changing"]);
    expect(rows[1].last).toBe(NOW - 1);
  });
});

describe("railVisible", () => {
  const rows = railRows(input({ worktrees: [info("one"), info("two")], changeCounts: { "/src/one": 1 } }), NOW);
  const base = { query: "", changesOnly: false, icons: false, open: null as string | null };
  const names = (f: Partial<typeof base>) => railVisible(rows, { ...base, ...f }).rows.map((r) => r.name);

  it("matches name and branch, and has-changes", () => {
    expect(names({ query: "AGENT/TWO" })).toEqual(["two"]);
    expect(names({ changesOnly: true })).toEqual(["one"]);
  });

  it("keeps the open worktree listed", () => {
    expect(names({ query: "two", open: "/src/one" })).toEqual(["one", "two"]);
    expect(railVisible(rows, { ...base, query: "nothing", open: "/src/one" })).toMatchObject({ none: true });
  });

  it("ignores the filter in icons mode, which cannot clear it", () => {
    expect(railVisible(rows, { ...base, query: "nothing", icons: true })).toMatchObject({ none: false, rows });
  });
});

describe("labels", () => {
  it("reads detached and bare in place of a branch", () => {
    expect(branchLabel({ branch: null, head: "0a1b2c3d4e5f" })).toBe("detached @ 0a1b2c3");
    expect(branchLabel({ branch: null, head: null })).toBe("bare");
  });

  it("gives the reason a worktree cannot open", () => {
    expect(unopenable({ missing: true, prunable: "gitdir file points to a missing location", bare: false })).toBe("Missing or prunable: gitdir file points to a missing location");
    expect(unopenable({ missing: false, prunable: null, bare: false })).toBeNull();
  });

  it("puts the rest in the tooltip in icons mode", () => {
    const [r] = railRows(input({ worktrees: [info("one")], changeCounts: { "/src/one": 1 } }), NOW);
    expect(railTitle(r, false)).toBe("one\nagent/one");
    expect(railTitle(r, true)).toBe("one\nagent/one\nHas changes\n1 changed file");
  });
});
