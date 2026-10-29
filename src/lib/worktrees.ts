// The Worktrees overview: names, live activity and overlaps between worktrees.
import type { Overlap, WorktreeSummary } from "../api";
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
}

function list(paths: string[], max = 3): string {
  const shown = paths.slice(0, max).map((p) => p.split("/").pop() ?? p);
  return paths.length > max ? `${shown.join(", ")} and ${paths.length - max} more` : shown.join(", ");
}

/** What happened between two overviews of the same repository, in worktree order. */
export function activityBetween(prev: readonly WorktreeSummary[], next: readonly WorktreeSummary[], at: number): ActivityEvent[] {
  const before = new Map(prev.map((w) => [w.path, w]));
  const events: ActivityEvent[] = [];
  const push = (path: string, kind: ActivityEvent["kind"], text: string) => events.push({ at, path, kind, text });
  for (const w of next) {
    const p = before.get(w.path);
    if (!p) {
      push(w.path, "added", `new worktree on ${w.branch ?? "a detached HEAD"}`);
      continue;
    }
    const c = w.lastCommit;
    if (p.branch !== w.branch) push(w.path, "branch", `switched to ${w.branch ?? `a detached HEAD at ${shortSha(w.head ?? "")}`}`);
    else if (p.head !== w.head && c) {
      if (p.head && c.parents.includes(p.head)) push(w.path, "commit", `committed “${c.subject}”`);
      else push(w.path, "moved", `now at ${shortSha(c.sha)} “${c.subject}”`);
    }
    const wasDirty = new Set(p.uncommitted.map((f) => f.path));
    const started = w.uncommitted.map((f) => f.path).filter((f) => !wasDirty.has(f));
    if (started.length) push(w.path, "editing", `changed ${list(started)}`);
  }
  const still = new Set(next.map((w) => w.path));
  for (const p of prev) if (!still.has(p.path)) push(p.path, "removed", "worktree removed");
  return events;
}

/** For each worktree path, the other worktrees it shares files with. */
export function overlapsByWorktree(overlaps: readonly Overlap[]): Map<string, { other: string; files: string[] }[]> {
  const by = new Map<string, { other: string; files: string[] }[]>();
  const add = (path: string, other: string, files: string[]) => by.set(path, [...(by.get(path) ?? []), { other, files }]);
  for (const o of overlaps) {
    add(o.a, o.b, o.files);
    add(o.b, o.a, o.files);
  }
  return by;
}
