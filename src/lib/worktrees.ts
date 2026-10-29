// The Worktrees overview: names, live activity and overlaps between worktrees.
// Times are unix seconds, like the rest of the app.
import type { ChangedFile, Overlap, WorktreeInfo, WorktreeSummary } from "../api";
import { shortSha } from "./format";

/** A worktree counts as active this long after its files last changed. */
export const ACTIVE_SECS = 15;
/** A worktree's edits join its last "changed" entry while they are less than this far apart. */
export const MERGE_SECS = 120;
/** The activity feed keeps this many entries. */
export const ACTIVITY_LIMIT = 200;

export function worktreeName(w: { path: string; isMain?: boolean }): string {
  return w.isMain ? "main worktree" : w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path;
}

/** The worktrees git can read (not missing, not bare), by path. */
export function readablePaths(worktrees: readonly WorktreeInfo[]): string[] {
  return worktrees.filter((w) => !w.missing && !w.bare).map((w) => w.path);
}

export function isActive(lastChange: number | undefined, now: number): boolean {
  return lastChange !== undefined && now - lastChange < ACTIVE_SECS;
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
