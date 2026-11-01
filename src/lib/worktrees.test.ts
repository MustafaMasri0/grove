import { describe, expect, it } from "vitest";
import type { CommitSummary, WorktreeInfo, WorktreeSummary } from "../api";
import { ACTIVITY_LIMIT, activityBetween, addActivity, DEFAULT_OVERVIEW_SORT, editsOf, heldOrder, isActive, lastActivity, MERGE_SECS, nextSort, originOf, overviewRows, readablePaths, sharedFiles, sortRows, summaryBranch, worktreeName, worktreeState, type ActivityEvent, type OverviewColumn } from "./worktrees";

const commit = (sha: string, parents: string[], subject: string): CommitSummary => ({
  sha,
  parents,
  authorName: "A",
  authorEmail: "a@example.com",
  authorDate: "2026-01-01T00:00:00Z",
  subject,
});

const wt = (path: string, over: Partial<WorktreeSummary> = {}): WorktreeSummary => ({
  path,
  branch: path,
  head: "h1",
  uncommitted: [],
  baseAhead: 0,
  baseBehind: 0,
  upstream: null,
  upstreamAhead: 0,
  upstreamBehind: 0,
  lastCommit: commit("h1", ["h0"], "first"),
  changedFiles: 0,
  linesAdded: 0,
  linesRemoved: 0,
  ...over,
});

const dirty = (...paths: string[]) => paths.map((path) => ({ path, origPath: null, kind: "modified" as const }));

describe("activityBetween", () => {
  it("reports nothing when nothing changed", () => {
    expect(activityBetween([wt("a")], [wt("a")], 1)).toEqual([]);
  });

  it("reports a commit on top of the old HEAD", () => {
    const next = wt("a", { head: "h2", lastCommit: commit("h2", ["h1"], "Fix parser") });
    expect(activityBetween([wt("a")], [next], 5)).toEqual([{ at: 5, path: "a", kind: "commit", text: "committed “Fix parser”", sha: "h2" }]);
  });

  it("reports other HEAD moves (reset, rebase, pull) as a move", () => {
    const next = wt("a", { head: "h9", lastCommit: commit("h9000000", ["h8"], "Other") });
    expect(activityBetween([wt("a")], [next], 0)[0]).toMatchObject({ kind: "moved", text: "now at h900000 “Other”", sha: "h9000000" });
  });

  it("reports a branch switch rather than the HEAD move it causes", () => {
    const next = wt("a", { branch: "other", head: "h5", lastCommit: commit("h5", ["h4"], "x") });
    expect(activityBetween([wt("a")], [next], 0).map((e) => e.text)).toEqual(["switched to other"]);
  });

  it("leaves file edits to the watcher", () => {
    expect(activityBetween([wt("a")], [wt("a", { uncommitted: dirty("new.ts") })], 0)).toEqual([]);
  });

  it("reports worktrees added and removed", () => {
    const events = activityBetween([wt("gone")], [wt("new", { branch: "feature" })], 0);
    expect(events.map((e) => [e.path, e.kind, e.text])).toEqual([
      ["new", "added", "new worktree on feature"],
      ["gone", "removed", "worktree removed"],
    ]);
  });
});

describe("isActive", () => {
  it("is active for a while after the last change", () => {
    expect(isActive(undefined, 100)).toBe(false);
    expect(isActive(1000, 1000 + 14.9)).toBe(true);
    expect(isActive(1000, 1000 + 15)).toBe(false);
  });
});

describe("readablePaths", () => {
  it("leaves out missing and bare worktrees", () => {
    const w = (path: string, over: Partial<WorktreeInfo> = {}) => ({ path, missing: false, bare: false, ...over }) as WorktreeInfo;
    expect(readablePaths([w("a"), w("gone", { missing: true }), w("bare", { bare: true }), w("b")])).toEqual(["a", "b"]);
  });
});

describe("sharedFiles", () => {
  it("lists each file once with every worktree it overlaps in, in worktree order", () => {
    const worktrees = [wt("main", { uncommitted: dirty("gen.cc") }), wt("ios", { uncommitted: dirty("gen.cc") }), wt("fire"), wt("other")];
    const files = sharedFiles(
      [
        { a: "main", b: "ios", files: ["gen.cc"] },
        { a: "main", b: "fire", files: ["gen.cc"] },
        { a: "ios", b: "fire", files: ["api.ts", "gen.cc"] },
      ],
      worktrees,
    );
    expect(files).toEqual([
      {
        path: "api.ts",
        worktrees: [
          { path: "ios", uncommitted: false },
          { path: "fire", uncommitted: false },
        ],
      },
      {
        path: "gen.cc",
        worktrees: [
          { path: "main", uncommitted: true },
          { path: "ios", uncommitted: true },
          { path: "fire", uncommitted: false },
        ],
      },
    ]);
  });

  it("counts a rename's old name as uncommitted too", () => {
    const a = wt("a", { uncommitted: [{ path: "new.ts", origPath: "old.ts", kind: "renamed" }] });
    expect(sharedFiles([{ a: "a", b: "b", files: ["old.ts"] }], [a, wt("b")])[0].worktrees[0]).toEqual({ path: "a", uncommitted: true });
  });

  it("is empty without overlaps", () => {
    expect(sharedFiles([], [wt("a")])).toEqual([]);
  });
});

describe("worktreeName", () => {
  it("is the folder name, or 'main worktree'", () => {
    expect(worktreeName({ path: "/home/user/src/example/.claude/worktrees/agent-a" })).toBe("agent-a");
    expect(worktreeName({ path: "C:\\src\\example\\", isMain: false })).toBe("example");
    expect(worktreeName({ path: "/x", isMain: true })).toBe("main worktree");
  });
});

describe("addActivity", () => {
  const edit = (path: string, at: number, ...files: string[]): ActivityEvent => ({ at, path, kind: "editing", files: dirty(...files) });
  const commit = (path: string, at: number): ActivityEvent => ({ at, path, kind: "commit", text: "committed", sha: "s" });
  const view = (feed: ActivityEvent[]) => feed.map((e) => `${e.path} ${e.kind}@${e.at} ${e.kind === "editing" ? e.files.map((f) => f.path).join(",") : ""}`.trim());

  it("joins a worktree's steady edits into one entry, newest files first", () => {
    let feed = addActivity([], [edit("a", 0, "x.ts")]);
    feed = addActivity(feed, [edit("b", 10, "y.ts")]);
    feed = addActivity(feed, [edit("a", 20, "z.ts", "x.ts")]);
    expect(view(feed)).toEqual(["a editing@20 z.ts,x.ts", "b editing@10 y.ts"]);
  });

  it("starts a new entry after a commit or a pause", () => {
    let feed = addActivity([], [edit("a", 0, "x.ts"), commit("a", 5)]);
    feed = addActivity(feed, [edit("a", 10, "y.ts")]);
    feed = addActivity(feed, [edit("a", 10 + MERGE_SECS, "z.ts")]);
    expect(view(feed)).toEqual([`a editing@${10 + MERGE_SECS} z.ts`, "a editing@10 y.ts", "a commit@5", "a editing@0 x.ts"]);
  });

  it("keeps at most the limit", () => {
    const many = Array.from({ length: ACTIVITY_LIMIT + 5 }, (_, i) => commit("a", i));
    expect(addActivity([], many)).toHaveLength(ACTIVITY_LIMIT);
  });
});

describe("editsOf", () => {
  const seen = (entries: Record<string, string[]>) => new Map(Object.entries(entries).map(([k, v]) => [k, new Set(v)]));

  it("reports files edited again while already changed", () => {
    const a = wt("a", { uncommitted: dirty("src/a.ts", "b.ts", "c.ts", "d.ts", "untouched.ts") });
    expect(editsOf(seen({ a: ["src/a.ts", "b.ts", "c.ts", "d.ts"] }), [a], 7)).toEqual([
      { at: 7, path: "a", kind: "editing", files: dirty("src/a.ts", "b.ts", "c.ts", "d.ts") },
    ]);
  });

  it("skips what the Changes list does not show: ignored output, folders, edits undone", () => {
    const a = wt("a", { uncommitted: dirty("src/a.ts") });
    expect(editsOf(seen({ a: ["build/out.js", "src", "reverted.ts"] }), [a], 0)).toEqual([]);
  });

  it("finds a renamed file by either name, in worktree order", () => {
    const a = wt("a", { uncommitted: [{ path: "new.ts", origPath: "old.ts", kind: "renamed" }] });
    const b = wt("b", { uncommitted: dirty("x.ts") });
    expect(editsOf(seen({ b: ["x.ts"], a: ["old.ts"] }), [a, b], 0).map((e) => e.path)).toEqual(["a", "b"]);
  });
});

describe("worktreeState", () => {
  const now = 1000;
  const idle = { rejected: false, lastChange: undefined, changedFiles: 0 };

  it("puts a refused push first, then live edits, then changes", () => {
    expect(worktreeState({ rejected: true, lastChange: now, changedFiles: 3 }, now)).toBe("rejected");
    expect(worktreeState({ ...idle, lastChange: now - 1, changedFiles: 3 }, now)).toBe("changing");
    expect(worktreeState({ ...idle, changedFiles: 3 }, now)).toBe("changes");
    expect(worktreeState(idle, now)).toBe("clean");
  });

  it("calls a worktree clean again once its edits are old", () => {
    expect(worktreeState({ ...idle, lastChange: now - 60 }, now)).toBe("clean");
  });

  it("reads a worktree the overview has not reached as clean", () => {
    expect(worktreeState({ ...idle, changedFiles: undefined }, now)).toBe("clean");
  });
});

describe("lastActivity", () => {
  const commit = { authorDate: "1970-01-01T00:01:40Z" } as CommitSummary;

  it("prefers file changes, then the last commit", () => {
    expect(lastActivity(500, commit)).toBe(500);
    expect(lastActivity(undefined, commit)).toBe(100);
    expect(lastActivity(undefined, null)).toBeNull();
  });
});

describe("overview table", () => {
  const rows = (summaries: WorktreeSummary[], extra: { lastChange?: Record<string, number>; rejected?: string } = {}) =>
    overviewRows({ summaries, shared: [], lastChange: extra.lastChange ?? {}, actions: extra.rejected ? { [extra.rejected]: { rejected: true } } : {}, nameOf: (p) => p }, 1000);
  const order = (list: ReadonlyArray<{ summary: WorktreeSummary }>) => list.map((r) => r.summary.path);

  it("names the branch, a detached HEAD and an unborn one", () => {
    expect(summaryBranch({ branch: "main", head: "h" })).toBe("main");
    expect(summaryBranch({ branch: null, head: "0123456789" })).toBe("detached @ 0123456");
    expect(summaryBranch({ branch: null, head: null })).toBe("no commits");
  });

  it("reads where a branch stands against its upstream", () => {
    expect(originOf(wt("a"))).toEqual({ kind: "none" });
    expect(originOf(wt("a", { branch: null }))).toBeNull();
    expect(originOf(wt("a", { upstream: "origin/a" }))).toEqual({ kind: "sync", upstream: "origin/a" });
    expect(originOf(wt("a", { upstream: "origin/a", upstreamBehind: 2 }))).toEqual({ kind: "diverged", upstream: "origin/a", ahead: 0, behind: 2 });
  });

  it("takes each row's state from worktreeState", () => {
    expect(rows([wt("a", { changedFiles: 2 })])[0].state).toBe("changes");
    expect(rows([wt("a")], { rejected: "a" })[0].state).toBe("rejected");
    expect(rows([wt("a")], { lastChange: { a: 999 } })[0].state).toBe("changing");
    expect(rows([wt("a")])[0].state).toBe("clean");
  });

  it("counts the shared files and the others that change them", () => {
    const summaries = [wt("a"), wt("b"), wt("c")];
    const shared = [{ path: "x", worktrees: [{ path: "a", uncommitted: true }, { path: "b", uncommitted: false }] }, { path: "y", worktrees: [{ path: "a", uncommitted: true }, { path: "c", uncommitted: true }] }];
    const [a, b] = overviewRows({ summaries, shared, lastChange: {}, actions: {}, nameOf: (p) => p.toUpperCase() }, 0);
    expect([a.shared, a.sharedWith]).toEqual([2, ["B", "C"]]);
    expect([b.shared, b.sharedWith]).toEqual([1, ["A"]]);
  });

  it("sorts by state with the most pressing first, and keeps ties in order", () => {
    const list = rows([wt("clean-1"), wt("changes", { changedFiles: 1 }), wt("clean-2"), wt("rejected"), wt("changing")], { rejected: "rejected", lastChange: { changing: 999 } });
    expect(order(sortRows(list, DEFAULT_OVERVIEW_SORT))).toEqual(["rejected", "changing", "changes", "clean-1", "clean-2"]);
  });

  it("sorts every column without losing a row, including rows that lack the value", () => {
    const list = rows([wt("a", { branch: null, head: null, lastCommit: null }), wt("b", { upstream: "origin/b", upstreamAhead: 3 }), wt("c", { upstream: "origin/c" })]);
    for (const key of ["name", "branch", "state", "files", "lines", "origin", "ahead", "conflicts", "commit", "last"] satisfies OverviewColumn[]) {
      expect(order(sortRows(list, { key, dir: 1 })).sort()).toEqual(["a", "b", "c"]);
    }
    expect(order(sortRows(list, { key: "origin", dir: -1 }))).toEqual(["b", "c", "a"]);
  });

  it("shows the newest activity first when sorted by Last", () => {
    const list = rows([wt("old"), wt("new")], { lastChange: { old: 10, new: 20 } });
    expect(order(sortRows(list, { key: "last", dir: 1 }))).toEqual(["new", "old"]);
  });

  it("turns the sorted column around and starts others ascending", () => {
    expect(nextSort({ key: "name", dir: 1 }, "name")).toEqual({ key: "name", dir: -1 });
    expect(nextSort({ key: "name", dir: -1 }, "name")).toEqual({ key: "name", dir: 1 });
    expect(nextSort({ key: "name", dir: -1 }, "files")).toEqual({ key: "files", dir: 1 });
  });

  it("holds an order: gone rows leave, new ones join at the end", () => {
    expect(heldOrder(["a", "b", "c"], ["c", "b", "a"])).toEqual(["a", "b", "c"]);
    expect(heldOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    expect(heldOrder(["a", "b"], ["n", "b", "a"])).toEqual(["a", "b", "n"]);
  });
});
