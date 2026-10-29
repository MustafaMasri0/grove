// Builds editor tabs for the things the left pane can open.
import type { ChangedFile, Source, StatusEntry } from "./api";
import { shortSha, splitPath } from "./lib/format";
import type { Tab } from "./store";

type NewTab = Omit<Tab, "preview" | "repo" | "cwd">;

/** Working tree vs HEAD for one entry of `git status`. */
export function uncommittedTab(cwd: string, e: StatusEntry): NewTab {
  const noLeft = e.kind === "added" || e.kind === "untracked";
  const left: Source = noLeft ? { kind: "empty" } : { kind: "rev", rev: "HEAD", path: e.origPath ?? e.path };
  const right: Source = e.kind === "deleted" ? { kind: "empty" } : { kind: "worktree", path: e.path };
  const { name, dir } = splitPath(e.path);
  return {
    id: `wt:${cwd}:${e.path}`,
    title: name,
    description: `${dir ? `${dir} · ` : ""}Working tree`,
    spec: { type: "diff", path: e.path, origPath: e.origPath, left, right, leftLabel: "HEAD", rightLabel: "Working tree" },
  };
}

/** A file changed between two revisions (branch vs base, or a commit vs its parent). */
export function revisionTab(f: ChangedFile, leftRev: string, rightRev: string, leftLabel: string, rightLabel: string): NewTab {
  const left: Source = f.kind === "added" ? { kind: "empty" } : { kind: "rev", rev: leftRev, path: f.origPath ?? f.path };
  const right: Source = f.kind === "deleted" ? { kind: "empty" } : { kind: "rev", rev: rightRev, path: f.path };
  const { name, dir } = splitPath(f.path);
  return {
    id: `rev:${leftRev}..${rightRev}:${f.path}`,
    title: name,
    description: `${dir ? `${dir} · ` : ""}${leftLabel} ↔ ${rightLabel}`,
    spec: { type: "diff", path: f.path, origPath: f.origPath, left, right, leftLabel, rightLabel },
  };
}

/** A file as one commit changed it, against the commit's first parent (`parent`, the empty tree for a root commit). */
export function commitFileTab(f: ChangedFile, commit: { sha: string; parents: string[] }, parent: string): NewTab {
  const parentLabel = commit.parents.length ? shortSha(parent) : "empty";
  return revisionTab(f, parent, commit.sha, parentLabel, shortSha(commit.sha));
}

/** A read-only file, from the worktree or from a branch tip. */
export function fileTab(cwd: string, path: string, rev: string | null, line?: number): NewTab {
  const source: Source = rev ? { kind: "rev", rev, path } : { kind: "worktree", path };
  const { name, dir } = splitPath(path);
  const where = rev ? (rev.startsWith("refs/") ? rev.replace(/^refs\/(heads|remotes)\//, "") : shortSha(rev)) : "";
  return {
    id: `file:${rev ?? cwd}:${path}`,
    title: name,
    description: [dir, where].filter(Boolean).join(" · "),
    spec: { type: "file", path, source, line },
  };
}

/** Settings and settings.json: not tied to a repository, kept when it changes. */
export function isAppTab(t: Tab): boolean {
  return t.repo === "";
}

/** Whether a tab shows files from disk and must be reloaded when the worktree changes. */
export function isLive(t: Tab): boolean {
  const s = t.spec;
  if (s.type === "settings" || s.type === "settingsJson") return false;
  if (s.type === "file") return s.source.kind === "worktree" || (s.source.kind === "rev" && s.source.rev === "HEAD");
  return [s.left, s.right].some((x) => x.kind === "worktree" || (x.kind === "rev" && x.rev === "HEAD"));
}

export type CloseWhich = "this" | "others" | "right" | "all";

/** The ids a tab's Close / Close others / Close to the right / Close all option closes. */
export function tabsToClose(tabs: readonly { id: string }[], id: string, which: CloseWhich): string[] {
  const idx = tabs.findIndex((t) => t.id === id);
  if (which === "all") return tabs.map((t) => t.id);
  if (idx < 0) return [];
  if (which === "this") return [id];
  if (which === "others") return tabs.filter((t) => t.id !== id).map((t) => t.id);
  return tabs.slice(idx + 1).map((t) => t.id);
}

/** The file Explorer reveals for a tab of worktree `cwd`; null for app tabs and other worktrees' tabs. */
export function revealPathOf(t: Tab | null | undefined, cwd: string | null): string | null {
  if (!t || isAppTab(t) || t.cwd !== cwd) return null;
  return t.spec.type === "file" || t.spec.type === "diff" ? t.spec.path : null;
}
