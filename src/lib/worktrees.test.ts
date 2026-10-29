import { describe, expect, it } from "vitest";
import type { ChangeKind, CommitSummary, WorktreeSummary } from "../api";
import { activityBetween, isActive, sharedFiles, worktreeName } from "./worktrees";

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
  committed: [],
  baseAhead: 0,
  baseBehind: 0,
  upstream: null,
  upstreamAhead: 0,
  upstreamBehind: 0,
  lastCommit: commit("h1", ["h0"], "first"),
  ...over,
});

const dirty = (...paths: string[]) => paths.map((path) => ({ path, origPath: null, kind: "modified" as const }));
const file = (path: string, kind: ChangeKind) => ({ path, origPath: null, kind });

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

  it("lists files that started changing, not the ones already changed", () => {
    const prev = wt("a", { uncommitted: dirty("src/old.ts") });
    const next = wt("a", { uncommitted: dirty("src/old.ts", "src/a.ts", "b.ts", "c.ts", "d.ts") });
    expect(activityBetween([prev], [next], 0)).toEqual([{ at: 0, path: "a", kind: "editing", text: "changed a.ts, b.ts, c.ts and 1 more", files: ["src/a.ts", "b.ts", "c.ts", "d.ts"] }]);
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
    expect(isActive(1000, 1000 + 14_999)).toBe(true);
    expect(isActive(1000, 1000 + 15_000)).toBe(false);
  });
});

describe("sharedFiles", () => {
  it("lists each file once with every worktree it overlaps in, in worktree order", () => {
    const worktrees = [
      wt("main", { uncommitted: dirty("gen.cc") }),
      wt("ios", { uncommitted: dirty("gen.cc"), committed: [file("api.ts", "added")] }),
      wt("fire", { committed: [file("gen.cc", "modified"), file("api.ts", "added")] }),
      wt("other"),
    ];
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
        kind: "added",
        worktrees: [
          { path: "ios", kind: "added", uncommitted: false },
          { path: "fire", kind: "added", uncommitted: false },
        ],
      },
      {
        path: "gen.cc",
        kind: "modified",
        worktrees: [
          { path: "main", kind: "modified", uncommitted: true },
          { path: "ios", kind: "modified", uncommitted: true },
          { path: "fire", kind: "modified", uncommitted: false },
        ],
      },
    ]);
  });

  it("has no single kind when worktrees change the file differently", () => {
    const a = wt("a", { uncommitted: [{ path: "f.ts", origPath: null, kind: "deleted" }] });
    const b = wt("b", { committed: [file("f.ts", "modified")] });
    const [f] = sharedFiles([{ a: "a", b: "b", files: ["f.ts"] }], [a, b]);
    expect(f.kind).toBeNull();
    expect(f.worktrees.map((w) => w.kind)).toEqual(["deleted", "modified"]);
  });

  it("counts a rename's old name as uncommitted, and as deleted there", () => {
    const a = wt("a", { uncommitted: [{ path: "new.ts", origPath: "old.ts", kind: "renamed" }] });
    expect(sharedFiles([{ a: "a", b: "b", files: ["old.ts"] }], [a, wt("b")])[0].worktrees[0]).toEqual({ path: "a", kind: "deleted", uncommitted: true });
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
