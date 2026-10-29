// Uncommitted change counts, shown beside worktrees and branches and on the Changes tab.
import type { Status } from "../api";

/** Files with uncommitted changes: what the Changes list shows (everything but ignored files); null when unknown. */
export function uncommittedCount(s: Status | null): number | null {
  return s ? s.entries.filter((e) => e.kind !== "ignored").length : null;
}

export function changeCountTitle(n: number): string {
  return `${n} file${n === 1 ? "" : "s"} with uncommitted changes`;
}
