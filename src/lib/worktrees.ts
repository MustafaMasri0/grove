// The Worktrees overview: names, live activity and overlaps between worktrees.
import type { ChangeKind, Overlap, WorktreeSummary } from "../api";
import { shortSha } from "./format";

/** A worktree counts as active this long after its files last changed. */
export const ACTIVE_MS = 15_000;
/** The activity feed keeps this many events. */
export const ACTIVITY_LIMIT = 200;

export function worktreeName(w: { path: string; isMain?: boolean }): string {
  return w.isMain ? "main worktree" : w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path;
}

export function isActive(lastChange: number | undefined, now: number): boolean {
  return lastChange !== undefined && now - lastChange < ACTIVE_MS;
}

export interface ActivityEvent {
  /** Unix milliseconds. */
  at: number;
  /** The worktree's path. */
  path: string;
  kind: "commit" | "moved" | "branch" | "editing" | "added" | "removed";
  text: string;
  /** Files that started changing ("editing"). */
  files?: string[];
  /** The commit HEAD is now at ("commit", "moved"). */
  sha?: string;
}

/** Of a list of files, the ones shown by name; the rest are counted. */
export const LISTED_FILES = 3;

function list(paths: string[]): string {
  const shown = paths.slice(0, LISTED_FILES).map((p) => p.split("/").pop() ?? p);
  return paths.length > LISTED_FILES ? `${shown.join(", ")} and ${paths.length - LISTED_FILES} more` : shown.join(", ");
}

/** What happened between two overviews of the same repository, in worktree order. */
export function activityBetween(prev: readonly WorktreeSummary[], next: readonly WorktreeSummary[], at: number): ActivityEvent[] {
  const before = new Map(prev.map((w) => [w.path, w]));
  const events: ActivityEvent[] = [];
  const push = (path: string, kind: ActivityEvent["kind"], text: string, more: Partial<ActivityEvent> = {}) => events.push({ at, path, kind, text, ...more });
  for (const w of next) {
    const p = before.get(w.path);
    if (!p) {
      push(w.path, "added", `new worktree on ${w.branch ?? "a detached HEAD"}`);
      continue;
    }
    const c = w.lastCommit;
    if (p.branch !== w.branch) push(w.path, "branch", `switched to ${w.branch ?? `a detached HEAD at ${shortSha(w.head ?? "")}`}`);
    else if (p.head !== w.head && c) {
      if (p.head && c.parents.includes(p.head)) push(w.path, "commit", `committed “${c.subject}”`, { sha: c.sha });
      else push(w.path, "moved", `now at ${shortSha(c.sha)} “${c.subject}”`, { sha: c.sha });
    }
    const wasDirty = new Set(p.uncommitted.map((f) => f.path));
    const started = w.uncommitted.map((f) => f.path).filter((f) => !wasDirty.has(f));
    if (started.length) push(w.path, "editing", `changed ${list(started)}`, { files: started });
  }
  const still = new Set(next.map((w) => w.path));
  for (const p of prev) if (!still.has(p.path)) push(p.path, "removed", "worktree removed");
  return events;
}

/** A file several worktrees change: how each one changes it, and whether that is still uncommitted. */
export interface SharedFile {
  path: string;
  /** In the order of the overview's worktrees. */
  worktrees: { path: string; kind: ChangeKind; uncommitted: boolean }[];
  /** How every worktree changes the file, when they all do it the same way; null when they differ. */
  kind: ChangeKind | null;
}

/** How a worktree changes `path`: its uncommitted change if any (that is what is on disk), else its committed one. */
function changeOf(w: WorktreeSummary, path: string): { kind: ChangeKind; uncommitted: boolean } {
  const u = w.uncommitted.find((f) => f.path === path || f.origPath === path);
  if (u) return { kind: u.origPath === path && u.path !== path ? "deleted" : u.kind, uncommitted: true };
  return { kind: w.committed.find((f) => f.path === path)?.kind ?? "modified", uncommitted: false };
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
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, set]) => {
      const sides = worktrees.filter((w) => set.has(w.path)).map((w) => ({ path: w.path, ...changeOf(w, path) }));
      return { path, worktrees: sides, kind: sides.every((s) => s.kind === sides[0].kind) ? sides[0].kind : null };
    });
}
