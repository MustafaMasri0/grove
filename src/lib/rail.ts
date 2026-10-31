// What the rail shows. Rows come from the worktree list, so missing and bare worktrees stay and
// nothing blanks while the overview reloads; the overview only adds to them.
import type { Overview, WorktreeInfo, WorktreeSummary } from "../api";
import { shortSha } from "./format";
import { lastActivity, sharedFiles, STATE_LABEL, worktreeName, worktreeState, type WorktreeState } from "./worktrees";

export const STATE_MARK = { rejected: "error", changing: "active", changes: "changes", clean: "idle" } as const satisfies Record<WorktreeState, string>;

/** Detached and bare read in place of a branch. */
export function branchLabel(w: Pick<WorktreeInfo, "branch" | "head">): string {
  return w.branch ?? (w.head ? `detached @ ${shortSha(w.head)}` : "bare");
}

/** Why a worktree cannot be opened; null when it can. */
export function unopenable(w: Pick<WorktreeInfo, "missing" | "prunable" | "bare">): string | null {
  if (w.missing) return `Missing or prunable${w.prunable ? `: ${w.prunable}` : ""}`;
  return w.bare ? "Bare repository" : null;
}

export interface RailRow {
  worktree: WorktreeInfo;
  name: string;
  branch: string;
  state: WorktreeState;
  /** Unix seconds; null when nothing is known yet. */
  last: number | null;
  /** Changed files, as the overview counts them; the status count until it loads. */
  changed: number;
  added: number;
  removed: number;
  /** Files another worktree changes too. */
  shared: number;
  off: string | null;
}

export interface RailInput {
  worktrees: readonly WorktreeInfo[];
  overview: Overview | null;
  changeCounts: Readonly<Record<string, number>>;
  lastChange: Readonly<Record<string, number>>;
  actions: Readonly<Record<string, { rejected: boolean }>>;
}

export function railRows({ worktrees, overview, changeCounts, lastChange, actions }: RailInput, now: number): RailRow[] {
  const summaries = new Map<string, WorktreeSummary>(overview?.worktrees.map((w) => [w.path, w]));
  const shared = new Map<string, number>();
  for (const f of overview ? sharedFiles(overview.overlaps, overview.worktrees) : []) {
    for (const w of f.worktrees) shared.set(w.path, (shared.get(w.path) ?? 0) + 1);
  }
  return worktrees.map((worktree) => {
    const { path } = worktree;
    const s = summaries.get(path);
    const changed = s?.changedFiles ?? changeCounts[path];
    return {
      worktree,
      name: worktreeName(worktree),
      branch: branchLabel(worktree),
      state: worktreeState({ rejected: !!actions[path]?.rejected, lastChange: lastChange[path], changedFiles: changed }, now),
      last: lastActivity(lastChange[path], s?.lastCommit),
      changed: changed ?? 0,
      added: s?.linesAdded ?? 0,
      removed: s?.linesRemoved ?? 0,
      shared: shared.get(path) ?? 0,
      off: unopenable(worktree),
    };
  });
}

export function railMatches(r: RailRow, query: string, changesOnly: boolean): boolean {
  const q = query.trim().toLowerCase();
  return (!q || `${r.name} ${r.branch}`.toLowerCase().includes(q)) && (!changesOnly || r.changed > 0);
}

export interface RailFilter {
  query: string;
  changesOnly: boolean;
  /** Icons mode has no filter, so one left on must not hide rows with no way to clear it. */
  icons: boolean;
  /** The worktree shown stays listed, so the page never loses its row. */
  open: string | null;
}

/** The rows to list, and whether the filter itself matched nothing. */
export function railVisible(rows: readonly RailRow[], f: RailFilter): { rows: RailRow[]; none: boolean } {
  if (f.icons) return { rows: [...rows], none: false };
  const matched = rows.filter((r) => railMatches(r, f.query, f.changesOnly));
  return { rows: rows.filter((r) => matched.includes(r) || r.worktree.path === f.open), none: rows.length > 0 && matched.length === 0 };
}

export const sharedTitle = (n: number) => `${n} file${n === 1 ? "" : "s"} also changed in another worktree`;

/** The tooltip of a row. Icons mode shows only the mark and the count, so it carries the rest. */
export function railTitle(r: RailRow, icons: boolean): string {
  const lines = [r.name, r.branch];
  if (icons) {
    lines.push(STATE_LABEL[r.state]);
    if (r.changed) lines.push(`${r.changed} changed file${r.changed === 1 ? "" : "s"}`);
    if (r.shared) lines.push(sharedTitle(r.shared));
  }
  return lines.join("\n");
}
