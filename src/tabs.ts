// What the editor area's tabs are, and how the things the left pane can open become tabs.
import type { ChangedFile, Source, StatusEntry } from "./api";
import { shortSha, splitPath } from "./lib/format";

interface TabBase {
  id: string;
  title: string;
  description: string;
  /** Replaced by the next tab opened as a preview, until it is kept open. */
  isPreview: boolean;
}

/** A read-only file, from a worktree or from a revision. */
export interface FileTab extends TabBase {
  kind: "file";
  repo: string;
  cwd: string;
  path: string;
  source: Source;
  /** The line to reveal and select when the file is shown. */
  line?: number;
}

/** A file compared between two sources. */
export interface DiffTab extends TabBase {
  kind: "diff";
  repo: string;
  cwd: string;
  path: string;
  origPath?: string | null;
  left: Source;
  right: Source;
  leftLabel: string;
  rightLabel: string;
}

/** settings.json: not tied to a repository, so it stays open across repositories. */
export interface SettingsTab extends TabBase {
  kind: "settings";
  path: string;
}

export type Tab = FileTab | DiffTab | SettingsTab;
export type TabKind = Tab["kind"];

/** Tabs the document view shows: text, diffs and pictures, in Monaco or rendered. */
export type DocumentTab = FileTab | DiffTab | SettingsTab;

/** Tabs that belong to one worktree: they are parked while another worktree is shown. */
export type WorktreeTab = FileTab | DiffTab;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A tab as the panes build it: the store adds the worktree it belongs to and whether it is a preview. */
export type TabDraft = DistributiveOmit<WorktreeTab, "isPreview" | "repo" | "cwd">;

/** Tabs that stay open when the repository changes. */
export function isAppTab(t: Tab): t is SettingsTab {
  return t.kind === "settings";
}

export function isWorktreeTab(t: Tab): t is WorktreeTab {
  return t.kind === "file" || t.kind === "diff";
}

/** Working tree vs HEAD for one entry of `git status`. */
export function uncommittedTab(cwd: string, e: StatusEntry): TabDraft {
  const noLeft = e.kind === "added" || e.kind === "untracked";
  const left: Source = noLeft ? { kind: "empty" } : { kind: "rev", rev: "HEAD", path: e.origPath ?? e.path };
  const right: Source = e.kind === "deleted" ? { kind: "empty" } : { kind: "worktree", path: e.path };
  const { name, dir } = splitPath(e.path);
  return {
    kind: "diff",
    id: `wt:${cwd}:${e.path}`,
    title: name,
    description: `${dir ? `${dir} · ` : ""}Working tree`,
    path: e.path,
    origPath: e.origPath,
    left,
    right,
    leftLabel: "HEAD",
    rightLabel: "Working tree",
  };
}

/** A file changed between two revisions (branch vs base, or a commit vs its parent). */
export function revisionTab(f: ChangedFile, leftRev: string, rightRev: string, leftLabel: string, rightLabel: string): TabDraft {
  const left: Source = f.kind === "added" ? { kind: "empty" } : { kind: "rev", rev: leftRev, path: f.origPath ?? f.path };
  const right: Source = f.kind === "deleted" ? { kind: "empty" } : { kind: "rev", rev: rightRev, path: f.path };
  const { name, dir } = splitPath(f.path);
  return {
    kind: "diff",
    id: `rev:${leftRev}..${rightRev}:${f.path}`,
    title: name,
    description: `${dir ? `${dir} · ` : ""}${leftLabel} ↔ ${rightLabel}`,
    path: f.path,
    origPath: f.origPath,
    left,
    right,
    leftLabel,
    rightLabel,
  };
}

/** A file as one commit changed it, against the commit's first parent (`parent`, the empty tree for a root commit). */
export function commitFileTab(f: ChangedFile, commit: { sha: string; parents: string[] }, parent: string): TabDraft {
  const parentLabel = commit.parents.length ? shortSha(parent) : "empty";
  return revisionTab(f, parent, commit.sha, parentLabel, shortSha(commit.sha));
}

/** A read-only file, from the worktree or from a branch tip. */
export function fileTab(cwd: string, path: string, rev: string | null, line?: number): TabDraft {
  const source: Source = rev ? { kind: "rev", rev, path } : { kind: "worktree", path };
  const { name, dir } = splitPath(path);
  const where = rev ? (rev.startsWith("refs/") ? rev.replace(/^refs\/(heads|remotes)\//, "") : shortSha(rev)) : "";
  return {
    kind: "file",
    id: `file:${rev ?? cwd}:${path}`,
    title: name,
    description: [dir, where].filter(Boolean).join(" · "),
    path,
    source,
    line,
  };
}

export function settingsTab(path: string): SettingsTab {
  return { kind: "settings", id: "app:settings.json", title: "settings.json", description: "Read-only", path, isPreview: false };
}

/** Whether a tab shows files from disk and must be reloaded when the worktree changes. */
export function isLive(t: Tab): boolean {
  const atHead = (s: Source) => s.kind === "worktree" || (s.kind === "rev" && s.rev === "HEAD");
  if (t.kind === "file") return atHead(t.source);
  if (t.kind === "diff") return atHead(t.left) || atHead(t.right);
  return false;
}

/** A worktree's tab while another worktree is shown, with the place it had in the tab row. */
export interface ParkedTab {
  tab: WorktreeTab;
  index: number;
}

/** Splits the tab row into the tabs that stay when the worktree changes and the shown worktree's own. */
export function parkTabs(tabs: readonly Tab[]): { staying: Tab[]; parked: ParkedTab[] } {
  const staying: Tab[] = [];
  const parked: ParkedTab[] = [];
  tabs.forEach((tab, index) => (isWorktreeTab(tab) ? parked.push({ tab, index }) : staying.push(tab)));
  return { staying, parked };
}

/** Puts a worktree's parked tabs back where they were among the tabs that stayed. */
export function unparkTabs(staying: readonly Tab[], parked: readonly ParkedTab[]): Tab[] {
  const tabs = [...staying];
  for (const p of [...parked].sort((a, b) => a.index - b.index)) tabs.splice(Math.min(p.index, tabs.length), 0, p.tab);
  return tabs;
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

/** The file Explorer reveals for a tab of worktree `cwd`; null for other kinds and other worktrees' tabs. */
export function revealPathOf(t: Tab | null | undefined, cwd: string | null): string | null {
  return t && isWorktreeTab(t) && t.cwd === cwd ? t.path : null;
}
