// The items of each context menu. Nothing here writes to a repository: the
// options open tabs, copy text, show File Explorer or a web page, or change
// the app's own list of repositories.
import { shortSha, splitPath } from "./format";
import { githubCommitUrl, joinPath, relativeForCopy, windowsPath, type HostKind } from "./hostPaths";
import type { MenuItem } from "./menu";

/** What the options do outside the app's own state. */
export interface MenuEnv {
  copy(text: string | Promise<string>): void | Promise<void>;
  /** Shows the item selected in File Explorer; `path` is a Windows path. */
  reveal(path: string): void | Promise<void>;
  openUrl(url: string): void | Promise<void>;
}

/** The worktree (or branch view) a row belongs to. */
export interface Where {
  host: HostKind;
  cwd: string;
}

const SEP: MenuItem = { separator: true };
const REVEAL = "Reveal in File Explorer";

function pathItems(env: MenuEnv, where: Where, rel: string): MenuItem[] {
  return [
    { label: "Copy path", run: () => env.copy(windowsPath(where.host, joinPath(where.cwd, rel))) },
    { label: "Copy relative path", run: () => env.copy(relativeForCopy(where.host, rel)) },
  ];
}

function revealItem(env: MenuEnv, where: Where, rel: string, onDisk: boolean): MenuItem {
  return { label: REVEAL, disabled: !onDisk, run: () => env.reveal(windowsPath(where.host, joinPath(where.cwd, rel))) };
}

export interface FileTarget {
  path: string;
  /** Opens the row (a diff for change rows). Left out where opening is not an option. */
  open?: () => void;
  /** For diff rows: opens the plain file; null when there is none (deleted). */
  openFile?: (() => void) | null;
  /** Shows the commits that touched the file. Left out where there is no history to show. */
  history?: () => void;
  /** Whether the file is in the worktree folder, so File Explorer can show it. */
  onDisk: boolean;
}

const HISTORY = "View file history";

/** Change lists, commit files, Explorer files, search results and Quick Open. */
export function fileItems(env: MenuEnv, where: Where, f: FileTarget): MenuItem[] {
  const opens: MenuItem[] = [];
  if (f.open) opens.push({ label: "Open", run: f.open });
  if (f.openFile !== undefined) opens.push({ label: "Open file", disabled: !f.openFile, run: () => f.openFile?.() });
  if (f.history) opens.push({ label: HISTORY, run: f.history });
  return [
    ...(opens.length ? [...opens, SEP] : []),
    ...pathItems(env, where, f.path),
    { label: "Copy file name", run: () => env.copy(splitPath(f.path).name) },
    SEP,
    revealItem(env, where, f.path, f.onDisk),
  ];
}

export function folderItems(env: MenuEnv, where: Where, d: { path: string; onDisk: boolean; collapseAll: () => void }): MenuItem[] {
  return [...pathItems(env, where, d.path), SEP, revealItem(env, where, d.path, d.onDisk), SEP, { label: "Collapse all", run: d.collapseAll }];
}

export interface TabTarget {
  index: number;
  count: number;
  preview: boolean;
  /** The file's Windows path; null for tabs that are not a file (Settings). */
  path: string | null;
  /** Shows the file's history; left out for tabs that are not a repository file. */
  history?: () => void;
  close(): void;
  closeOthers(): void;
  closeRight(): void;
  closeAll(): void;
  keepOpen(): void;
}

export function tabItems(env: MenuEnv, t: TabTarget): MenuItem[] {
  const path = t.path;
  return [
    { label: "Close", shortcut: "Ctrl+W", run: t.close },
    { label: "Close others", disabled: t.count < 2, run: t.closeOthers },
    { label: "Close to the right", disabled: t.index >= t.count - 1, run: t.closeRight },
    { label: "Close all", run: t.closeAll },
    SEP,
    { label: "Keep open", disabled: !t.preview, run: t.keepOpen },
    SEP,
    ...(t.history ? [{ label: HISTORY, run: t.history }] : []),
    { label: "Copy path", disabled: !path, run: () => (path ? env.copy(path) : undefined) },
  ];
}

export interface CommitTarget {
  sha: string;
  subject: string;
  /** The full message; may need a request for commits other than the selected one. */
  message: () => string | Promise<string>;
  /** `owner/repo` when origin is on github.com. */
  github: string | null;
}

export function commitItems(env: MenuEnv, c: CommitTarget): MenuItem[] {
  const items: MenuItem[] = [
    { label: "Copy SHA", run: () => env.copy(c.sha) },
    { label: "Copy short SHA", run: () => env.copy(shortSha(c.sha)) },
    { label: "Copy subject", run: () => env.copy(c.subject) },
    { label: "Copy message", run: () => env.copy(Promise.resolve(c.message()).then((m) => m.trimEnd())) },
  ];
  const url = githubCommitUrl(c.github, c.sha);
  if (url) items.push(SEP, { label: "Open on GitHub", run: () => env.openUrl(url) });
  return items;
}

/** A repository in the top bar list; `path` is null when it could not be opened. */
export function repoItems(env: MenuEnv, r: { name: string; path: string | null; remove: () => void }): MenuItem[] {
  const path = r.path;
  return [
    { label: "Copy path", disabled: !path, run: () => (path ? env.copy(path) : undefined) },
    { label: "Copy name", run: () => env.copy(r.name) },
    SEP,
    { label: REVEAL, disabled: !path, run: () => (path ? env.reveal(path) : undefined) },
    SEP,
    { label: "Remove from list", run: r.remove },
  ];
}

/** A worktree in the top bar list; `path` is its Windows path. */
export function worktreeItems(env: MenuEnv, w: { path: string; branch: string | null; missing: boolean }): MenuItem[] {
  const branch = w.branch;
  return [
    { label: "Copy path", run: () => env.copy(w.path) },
    { label: "Copy branch name", disabled: !branch, run: () => (branch ? env.copy(branch) : undefined) },
    SEP,
    { label: REVEAL, disabled: w.missing, run: () => env.reveal(w.path) },
  ];
}

export function branchItems(env: MenuEnv, b: { name: string }): MenuItem[] {
  return [{ label: "Copy name", run: () => env.copy(b.name) }];
}
