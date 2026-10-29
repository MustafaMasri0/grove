// Typed wrappers around the Rust commands. Shapes mirror wv-core's serde types.
import { invoke } from "@tauri-apps/api/core";

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";

export interface RepoInfo {
  id: string;
  name: string;
  kind: "windows" | "wsl";
  distro: string | null;
  root: string;
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: string | null;
  prunable: string | null;
  isMain: boolean;
  displayPath: string;
  missing: boolean;
}

export interface BranchRef {
  name: string;
  fullRef: string;
  kind: "local" | "remote";
  oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  upstreamGone: boolean;
  committerUnix: number;
  isHead: boolean;
}

export interface StatusEntry {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  staged: string;
  unstaged: string;
}

export interface Status {
  branch: { oid: string | null; head: string | null; upstream: string | null; ahead: number; behind: number };
  entries: StatusEntry[];
}

export interface ChangedFile {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
}

export interface BaseDiff {
  mergeBase: string;
  files: ChangedFile[];
}

export interface CommitSummary {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
}

export interface CommitDetail {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerDate: string;
  message: string;
}

export interface CommitWithFiles {
  detail: CommitDetail;
  parent: string;
  files: ChangedFile[];
}

/** A commit in a file's history: the file's name and change there, and what to diff it with. */
export interface FileHistoryEntry {
  commit: CommitSummary;
  file: ChangedFile;
  parent: string;
}

export interface HistorySearch {
  commits: CommitSummary[];
  truncated: boolean;
}

export interface BlameCommit {
  authorName: string;
  authorEmail: string;
  /** Unix seconds. */
  authorTime: number;
  summary: string;
  /** Lines changed in the worktree and not committed yet. */
  uncommitted: boolean;
}

export interface Blame {
  /** Runs of lines last changed by one commit; `start` is 1-based. */
  hunks: { sha: string; start: number; count: number }[];
  commits: Record<string, BlameCommit>;
}

export type Source = { kind: "rev"; rev: string; path: string } | { kind: "worktree"; path: string } | { kind: "empty" };

export type Content =
  | { kind: "text"; text: string }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number }
  | { kind: "missing" };

/** One side of an image view: where it loads from (a wvfile: URL), or why it is not shown. */
export type ImageSource = { kind: "image"; size: number; url: string } | { kind: "tooLarge"; size: number } | { kind: "missing" };

export interface FileList {
  files: string[];
  ignored: string[];
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface GrepHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface GrepResult {
  hits: GrepHit[];
  truncated: boolean;
}

export interface GrepQuery {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  limit: number;
}

export interface BranchStatus {
  branch: string;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  hasOrigin: boolean;
  lastFetched: number | null;
}

export type Action = "fetch" | "push" | "publish";

export interface WorktreeSummary {
  path: string;
  branch: string | null;
  head: string | null;
  /** What the Changes list shows. */
  uncommitted: ChangedFile[];
  /** Files HEAD changed since it split from the base (renames as delete + add). */
  committed: ChangedFile[];
  baseAhead: number;
  baseBehind: number;
  upstream: string | null;
  upstreamAhead: number;
  upstreamBehind: number;
  lastCommit: CommitSummary | null;
}

/** Files two worktrees both change (`a` and `b` are worktree paths). */
export interface Overlap {
  a: string;
  b: string;
  files: string[];
}

export interface Overview {
  worktrees: WorktreeSummary[];
  /** Worktree path → why it could not be read. */
  errors: Record<string, string>;
  overlaps: Overlap[];
}

/** Payload of the `worktree-changed` event. */
export interface WorktreeChanged {
  cwd: string;
  /** Files of the worktree changed, not only git state that worktrees share (refs, index). */
  files: boolean;
}

type At = { repo: string; cwd: string };
type LeftTabName = "changes" | "history" | "explorer" | "search";

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  worktrees: (a: At) => invoke<WorktreeInfo[]>("worktrees", a),
  branches: (a: At) => invoke<BranchRef[]>("branches", a),
  status: (a: At) => invoke<Status>("status", a),
  /** Every worktree in `cwds` compared with `base`, and the files they both change. */
  worktreesOverview: (repo: string, cwds: string[], base: string | null) => invoke<Overview>("worktrees_overview", { repo, cwds, base }),
  resolveBase: (a: At, preferred: string | null) => invoke<string | null>("resolve_base", { ...a, preferred }),
  branchChanges: (a: At, base: string, rev: string) => invoke<BaseDiff>("branch_changes", { ...a, base, rev }),
  log: (a: At, rev: string, skip: number, limit: number) => invoke<CommitSummary[]>("log", { ...a, rev, skip, limit }),
  fileHistory: (a: At, rev: string, path: string, skip: number, limit: number) =>
    invoke<FileHistoryEntry[]>("file_history", { ...a, rev, path, skip, limit }),
  searchLog: (a: At, rev: string, query: string, limit: number) => invoke<HistorySearch>("search_log", { ...a, rev, query, limit }),
  blame: (a: At, source: Source) => invoke<Blame>("blame", { ...a, source }),
  commit: (a: At, sha: string) => invoke<CommitWithFiles>("commit", { ...a, sha }),
  readSources: (a: At, sources: Source[]) => invoke<Content[]>("read_sources", { ...a, sources }),
  listFiles: (a: At, rev: string | null, ignored: boolean) => invoke<FileList>("list_files", { ...a, rev, ignored }),
  listDir: (a: At, rel: string) => invoke<DirEntry[]>("list_dir", { ...a, rel }),
  grep: (a: At, rev: string | null, query: GrepQuery) => invoke<GrepResult>("grep", { ...a, rev, query }),
  branchStatus: (a: At, branch: string) => invoke<BranchStatus>("branch_status", { ...a, branch }),
  runAction: (a: At, action: Action, branch: string) => invoke<string>("run_action", { ...a, action, branch }),
  /** Watches these worktrees of `repo` (and stops watching anything else): `worktree-changed` events. */
  watch: (repo: string, cwds: string[]) => invoke<void>("watch", { repo, cwds }),
  loadSettings: () => invoke<unknown>("load_settings"),
  saveSettings: (settings: unknown) => invoke<void>("save_settings", { settings }),
  /** settings.json as saved: its path, and its text (null before the first save). */
  settingsFile: () => invoke<{ path: string; text: string | null }>("settings_file"),
  /** A commit author's picture as a data URL, or null (no picture: show initials). Cached by the backend. */
  avatar: (email: string, size: number, at?: At, sha?: string) =>
    invoke<string | null>("avatar", { email, size, repo: at?.repo ?? null, cwd: at?.cwd ?? null, sha: sha ?? null }),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  /** `owner/repo` when origin is on github.com, else null. */
  githubRepo: (a: At) => invoke<string | null>("github_repo", a),
  readImage: (a: At, source: Source) => invoke<string | null>("read_image", { ...a, source }),
  imageSources: (a: At, sources: Source[]) => invoke<ImageSource[]>("image_sources", { ...a, sources }),
  /** The wvfile: URL of the repository root at `rev` (null: the worktree), for HTML previews. */
  previewBase: (a: At, rev: string | null) => invoke<string>("preview_base", { ...a, rev }),
  automation: () =>
    invoke<{
      openDiffs: number | null;
      openFile: string | null;
      showHistory: string | null;
      runAction: Action | null;
      openSettings: string | null;
      leftTab: LeftTabName | null;
      settingsPatch: unknown;
      contextMenu: string | null;
      fileHistory: string | null;
      blame: string | null;
      historySearch: string | null;
      openRevFile: string | null;
      openCommitFile: string | null;
      imageZoom: string | null;
      previewLink: number | null;
      reveal: string | null;
      listKeys: string | null;
      worktrees: string | null;
    }>("automation"),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
