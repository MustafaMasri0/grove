// The Worktrees overview: names, live activity and overlaps between worktrees.
// Times are unix seconds, like the rest of the app.
import type { ChangedFile, Overlap, WorktreeInfo, WorktreeSummary } from "../api";
import { isoToUnix, shortSha } from "./format";

/** A worktree counts as active this long after its files last changed. */
export const ACTIVE_SECS = 15;
/** A worktree's edits join its last "changed" entry while they are less than this far apart. */
export const MERGE_SECS = 120;
/** The activity feed keeps this many entries. */
export const ACTIVITY_LIMIT = 200;

export const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function worktreeName(w: { path: string; isMain?: boolean }): string {
  return w.isMain ? "main worktree" : folderName(w.path);
}

/** The worktrees git can read (not missing, not bare), by path. */
export function readablePaths(worktrees: readonly WorktreeInfo[]): string[] {
  return worktrees.filter((w) => !w.missing && !w.bare).map((w) => w.path);
}

export function isActive(lastChange: number | undefined, now: number): boolean {
  return lastChange !== undefined && now - lastChange < ACTIVE_SECS;
}

export type WorktreeState = "rejected" | "changing" | "changes" | "clean";

export const STATE_LABEL: Record<WorktreeState, string> = { rejected: "Push rejected", changing: "Changing", changes: "Has changes", clean: "Clean" };

/** A worktree's state, the most pressing one first. `changedFiles` is unknown until the overview loads. */
export function worktreeState(w: { rejected: boolean; lastChange: number | undefined; changedFiles: number | undefined }, now: number): WorktreeState {
  if (w.rejected) return "rejected";
  if (isActive(w.lastChange, now)) return "changing";
  return w.changedFiles ? "changes" : "clean";
}

/** When a worktree last moved: its files this session, else its last commit; null for neither. */
export function lastActivity(lastChange: number | undefined, lastCommit: WorktreeSummary["lastCommit"] | undefined): number | null {
  return lastChange ?? (lastCommit ? isoToUnix(lastCommit.authorDate) : null);
}

/** The paths a change touches: its own, and a rename's old one. */
export function namesOf(f: ChangedFile): string[] {
  return f.origPath ? [f.path, f.origPath] : [f.path];
}

/** Something that happened in a worktree (`path`). */
export type ActivityEvent = { at: number; path: string } & (
  /** Files of the Changes list the watcher saw change. */
  | { kind: "editing"; files: ChangedFile[] }
  /** HEAD moved to `sha`: a commit on top of it, or anything else (reset, rebase, pull). */
  | { kind: "commit" | "moved"; text: string; sha: string }
  | { kind: "branch" | "added" | "removed"; text: string }
);

/**
 * What happened to HEADs and worktrees between two overviews of the same repository, in worktree
 * order. File edits come from the watcher instead ({@link editsOf}): an already changed file that
 * is edited again looks the same to `git status`.
 */
export function activityBetween(prev: readonly WorktreeSummary[], next: readonly WorktreeSummary[], at: number): Exclude<ActivityEvent, { kind: "editing" }>[] {
  const before = new Map(prev.map((w) => [w.path, w]));
  const events: Exclude<ActivityEvent, { kind: "editing" }>[] = [];
  for (const w of next) {
    const p = before.get(w.path);
    const c = w.lastCommit;
    if (!p) events.push({ at, path: w.path, kind: "added", text: `new worktree on ${w.branch ?? "a detached HEAD"}` });
    else if (p.branch !== w.branch) events.push({ at, path: w.path, kind: "branch", text: `switched to ${w.branch ?? `a detached HEAD at ${shortSha(w.head ?? "")}`}` });
    else if (p.head !== w.head && c) {
      if (p.head && c.parents.includes(p.head)) events.push({ at, path: w.path, kind: "commit", text: `committed “${c.subject}”`, sha: c.sha });
      else events.push({ at, path: w.path, kind: "moved", text: `now at ${shortSha(c.sha)} “${c.subject}”`, sha: c.sha });
    }
  }
  const still = new Set(next.map((w) => w.path));
  for (const p of prev) if (!still.has(p.path)) events.push({ at, path: p.path, kind: "removed", text: "worktree removed" });
  return events;
}

/**
 * The feed (newest first) with `events` (oldest first) added. An edit joins the worktree's latest
 * entry when that is also an edit, less than {@link MERGE_SECS} older: the entry moves to the top with
 * the new time and the files edited since listed first. So steady work reads as one entry, and a
 * commit or a pause starts the next. At most {@link ACTIVITY_LIMIT} entries are kept.
 */
export function addActivity(feed: readonly ActivityEvent[], events: readonly ActivityEvent[]): ActivityEvent[] {
  const next = [...feed];
  for (const e of events) {
    const i = next.findIndex((x) => x.path === e.path);
    const last = next[i];
    if (e.kind === "editing" && last?.kind === "editing" && e.at - last.at < MERGE_SECS) {
      const fresh = new Set(e.files.map((f) => f.path));
      next.splice(i, 1);
      next.unshift({ ...e, files: [...e.files, ...last.files.filter((f) => !fresh.has(f.path))] });
    } else next.unshift(e);
  }
  return next.slice(0, ACTIVITY_LIMIT);
}

/**
 * The files the watcher saw change (worktree path → paths relative to it), as Activity entries:
 * only those the worktree's Changes list shows, so build output, ignored files and edits undone
 * leave no entry. In worktree order.
 */
export function editsOf(seen: ReadonlyMap<string, ReadonlySet<string>>, worktrees: readonly WorktreeSummary[], at: number): ActivityEvent[] {
  return worktrees.flatMap((w): ActivityEvent[] => {
    const paths = seen.get(w.path);
    const files = paths ? w.uncommitted.filter((f) => namesOf(f).some((n) => paths.has(n))) : [];
    return files.length ? [{ at, path: w.path, kind: "editing", files }] : [];
  });
}

/** A file several worktrees change, and whether each one's change is still uncommitted. */
export interface SharedFile {
  path: string;
  /** In the order of the overview's worktrees. */
  worktrees: { path: string; uncommitted: boolean }[];
}

/** The overlaps by file instead of by pair: each file once, with every worktree it overlaps in. Sorted by path. */
export function sharedFiles(overlaps: readonly Overlap[], worktrees: readonly WorktreeSummary[]): SharedFile[] {
  const by = new Map<string, Set<string>>();
  for (const o of overlaps) {
    for (const f of o.files) {
      const set = by.get(f) ?? new Set<string>();
      set.add(o.a).add(o.b);
      by.set(f, set);
    }
  }
  const dirty = new Map(worktrees.map((w) => [w.path, new Set(w.uncommitted.flatMap(namesOf))]));
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, set]) => ({
      path,
      worktrees: worktrees.filter((w) => set.has(w.path)).map((w) => ({ path: w.path, uncommitted: dirty.get(w.path)?.has(path) ?? false })),
    }));
}

/** How a worktree stands against its upstream; null without a branch. */
export type OriginState = { kind: "none" } | { kind: "sync"; upstream: string } | { kind: "diverged"; upstream: string; ahead: number; behind: number };

export function originOf(w: Pick<WorktreeSummary, "branch" | "upstream" | "upstreamAhead" | "upstreamBehind">): OriginState | null {
  if (w.upstream) return w.upstreamAhead || w.upstreamBehind ? { kind: "diverged", upstream: w.upstream, ahead: w.upstreamAhead, behind: w.upstreamBehind } : { kind: "sync", upstream: w.upstream };
  return w.branch ? { kind: "none" } : null;
}

export const ORIGIN_TEXT = { none: "not published", sync: "in sync" } as const;

/** Detached and unborn read in place of a branch. */
export const summaryBranch = (w: Pick<WorktreeSummary, "branch" | "head">) => w.branch ?? (w.head ? `detached @ ${shortSha(w.head)}` : "no commits");

/** One line of the overview's table. */
export interface OverviewRow {
  summary: WorktreeSummary;
  name: string;
  branch: string;
  state: WorktreeState;
  origin: OriginState | null;
  /** Unix seconds; null when nothing is known yet. */
  last: number | null;
  /** The shared files this worktree is one of. */
  shared: number;
  /** The other worktrees that change them. */
  sharedWith: string[];
}

export interface OverviewRowInput {
  summaries: readonly WorktreeSummary[];
  shared: readonly SharedFile[];
  lastChange: Readonly<Record<string, number>>;
  actions: Readonly<Record<string, { rejected: boolean }>>;
  nameOf: (path: string) => string;
}

export function overviewRows({ summaries, shared, lastChange, actions, nameOf }: OverviewRowInput, now: number): OverviewRow[] {
  return summaries.map((w) => {
    const mine = shared.filter((f) => f.worktrees.some((x) => x.path === w.path));
    return {
      summary: w,
      name: nameOf(w.path),
      branch: summaryBranch(w),
      state: worktreeState({ rejected: !!actions[w.path]?.rejected, lastChange: lastChange[w.path], changedFiles: w.changedFiles }, now),
      origin: originOf(w),
      last: lastActivity(lastChange[w.path], w.lastCommit),
      shared: mine.length,
      sharedWith: [...new Set(mine.flatMap((f) => f.worktrees.map((x) => x.path)).filter((p) => p !== w.path))].map(nameOf),
    };
  });
}

const STATE_RANK: Record<WorktreeState, number> = { rejected: 0, changing: 1, changes: 2, clean: 3 };

function originRank(o: OriginState | null): number {
  if (!o) return -2;
  return o.kind === "none" ? -1 : o.kind === "sync" ? 0 : o.ahead + o.behind;
}

const SORT_VALUE = {
  name: (r: OverviewRow) => r.name,
  branch: (r: OverviewRow) => r.branch,
  state: (r: OverviewRow) => STATE_RANK[r.state],
  files: (r: OverviewRow) => r.summary.changedFiles,
  lines: (r: OverviewRow) => r.summary.linesAdded + r.summary.linesRemoved,
  origin: (r: OverviewRow) => originRank(r.origin),
  ahead: (r: OverviewRow) => r.summary.baseAhead,
  conflicts: (r: OverviewRow) => r.shared,
  commit: (r: OverviewRow) => r.summary.lastCommit?.subject ?? "",
  // Ascending reads newest first, like the rail.
  last: (r: OverviewRow) => -(r.last ?? -Infinity),
} satisfies Record<string, (r: OverviewRow) => string | number>;

export type OverviewColumn = keyof typeof SORT_VALUE;

export interface OverviewSort {
  key: OverviewColumn;
  dir: 1 | -1;
}

export const DEFAULT_OVERVIEW_SORT: OverviewSort = { key: "state", dir: 1 };

/** Clicking the sorted column turns it around; any other starts ascending. */
export const nextSort = (sort: OverviewSort, key: OverviewColumn): OverviewSort => ({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 });

/** Stable, so equal rows keep the overview's order. */
export function sortRows(rows: readonly OverviewRow[], { key, dir }: OverviewSort): OverviewRow[] {
  const value = SORT_VALUE[key];
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** The order to keep while the table is held: rows that went are dropped, and new ones join at the end, so a row never moves under the pointer. */
export function heldOrder(held: readonly string[], sorted: readonly string[]): string[] {
  const live = new Set(sorted);
  const kept = held.filter((p) => live.has(p));
  const known = new Set(kept);
  return [...kept, ...sorted.filter((p) => !known.has(p))];
}
