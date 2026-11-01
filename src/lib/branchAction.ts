// The worktree's fetch, push or publish: its label, caption and why a push is blocked all follow from the branch's state.
import type { BranchStatus } from "../api";
import type { IconName } from "../components/Icon";
import { relativeTime } from "./format";

export type ActionKind = "fetch" | "push" | "publish";

export interface BranchAction {
  kind: ActionKind;
  label: string;
  caption: string;
  icon: IconName;
  /** Why the main action is not a push. */
  blocked: string | null;
  fetched: string;
  hasOrigin: boolean;
}

export function branchAction(bs: BranchStatus, viewing: boolean, now: number): BranchAction {
  const fetched = bs.lastFetched ? `Last fetched ${relativeTime(bs.lastFetched, now)}` : "Never fetched";
  const a: BranchAction = { kind: "fetch", label: "Fetch origin", caption: fetched, icon: "sync", blocked: null, fetched, hasOrigin: bs.hasOrigin };
  if (!bs.hasOrigin) a.blocked = "This repository has no remote named origin.";
  else if (!bs.branch) a.blocked = viewing ? "Remote branches cannot be pushed." : "HEAD is detached; there is no branch to push.";
  else if (viewing) a.blocked = "Pushing is only available from a worktree that has this branch checked out.";
  else if (!bs.upstream || bs.upstreamGone) return { ...a, kind: "publish", label: "Publish branch", caption: `Push ${bs.branch} to origin`, icon: "cloud-upload" };
  else if (bs.behind > 0) {
    a.caption = `↓${bs.behind}${bs.ahead ? ` ↑${bs.ahead}` : ""} · ${fetched}`;
    a.blocked = bs.ahead ? "The branch has diverged from origin; pushing would need a pull first (not available here)." : "The branch is behind origin; there is nothing to push.";
  } else if (bs.ahead > 0) return { ...a, kind: "push", label: `Push origin ↑${bs.ahead}`, icon: "arrow-up" };
  return a;
}
