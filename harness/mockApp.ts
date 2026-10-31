// The backend of a made-up repository with three worktrees, for the real App in harness/app.html.
const ROOT = "/home/user/src/shop-platform";
const WT = [
  { path: ROOT, branch: "main", isMain: true },
  { path: "/home/user/src/agent-01", branch: "agent/orders-refund", isMain: false },
  { path: "/home/user/src/agent-02", branch: "agent/cart-rounding", isMain: false },
];
const HEAD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const OTHER = "1b2c3d4e5f60718293a4b5c6d7e8f90123456789";
const CHANGED = [
  { path: "src/server/orders/create.ts", origPath: null, kind: "modified", staged: ".", unstaged: "M" },
  { path: "src/client/cart/total.ts", origPath: null, kind: "added", staged: "A", unstaged: "." },
];
const FILES = ["README.md", "package.json", "src/client/cart/total.ts", "src/server/orders/create.ts", "src/server/orders/refund.ts"];
const commit = (sha: string, subject: string) => ({ sha, parents: [OTHER], authorName: "Dev Example", authorEmail: "dev@example.com", authorDate: "2026-10-30T10:00:00Z", subject });
const summary = (w: (typeof WT)[number], i: number) => ({
  path: w.path,
  branch: w.branch,
  head: HEAD,
  uncommitted: i === 1 ? CHANGED.map((c) => ({ path: c.path, origPath: null, kind: c.kind })) : [],
  changedFiles: i === 1 ? 2 : 0,
  linesAdded: i === 1 ? 12 : 0,
  linesRemoved: i === 1 ? 3 : 0,
  baseAhead: i ? 1 : 0,
  baseBehind: 0,
  upstream: i ? null : "origin/main",
  upstreamAhead: 0,
  upstreamBehind: 0,
  lastCommit: commit(HEAD, "Allow partial refunds"),
});

const auto = () => {
  const given = JSON.parse(new URLSearchParams(location.search).get("auto") ?? "{}");
  const none = Object.fromEntries(["openDiffs", "openFile", "showHistory", "runAction", "openSettings", "leftTab", "settingsPatch", "contextMenu", "fileHistory", "blame", "historySearch", "openRevFile", "openCommitFile", "imageZoom", "previewLink", "reveal", "listKeys", "worktrees"].map((k) => [k, null]));
  return { ...none, ...given };
};

const repoInfo = (path: string) => ({ id: path, name: path.split("/").filter(Boolean).pop(), kind: path.startsWith("ssh://") ? "ssh" : "local", distro: null, separator: "/", root: path.startsWith("ssh://") ? "/home/user/src/example" : ROOT });

declare global {
  interface Window {
    __ipc: { cmd: string; args: unknown }[];
  }
}
window.__ipc = [];

export function respondApp(cmd: string, args?: unknown): unknown {
  window.__ipc.push({ cmd, args });
  const a = (args ?? {}) as Record<string, never>;
  switch (cmd) {
    case "load_settings":
      return { repos: [ROOT], lastRepo: ROOT, theme: new URLSearchParams(location.search).get("theme") ?? "dark", lastWorktree: { [ROOT]: WT[1].path } };
    case "save_settings":
    case "watch":
    case "copy_text":
      return null;
    case "settings_file":
      return { path: "C:\\Users\\user\\AppData\\Roaming\\Grove\\settings.json", text: "{}" };
    case "automation":
      return auto();
    case "open_repo":
      return repoInfo(a.path);
    case "worktrees":
      return WT.map((w) => ({ path: w.path, head: HEAD, branch: w.branch, detached: false, bare: false, locked: null, prunable: null, isMain: w.isMain, displayPath: w.path, missing: false }));
    case "branches":
      return [...WT.map((w) => ({ name: w.branch, fullRef: `refs/heads/${w.branch}`, kind: "local", oid: HEAD, upstream: null, ahead: 0, behind: 0, upstreamGone: false, committerUnix: 1_790_000_000, isHead: false })), { name: "origin/main", fullRef: "refs/remotes/origin/main", kind: "remote", oid: HEAD, upstream: null, ahead: 0, behind: 0, upstreamGone: false, committerUnix: 1_790_000_000, isHead: false }];
    case "status":
      return { branch: { oid: HEAD, head: "agent/orders-refund", upstream: null, ahead: 1, behind: 0 }, entries: a.cwd === WT[1].path ? CHANGED : [] };
    case "worktrees_overview":
      return { worktrees: WT.map(summary), errors: {}, overlaps: [] };
    case "resolve_base":
      return "main";
    case "branch_changes":
      return { mergeBase: OTHER, files: CHANGED.map((c) => ({ path: c.path, origPath: null, kind: c.kind })) };
    case "branch_status":
      return { branch: a.branch, upstream: null, upstreamGone: false, ahead: 1, behind: 0, hasOrigin: true, lastFetched: 1_790_000_000 };
    case "github_repo":
      return null;
    case "log":
      return [commit(HEAD, "Allow partial refunds"), commit(OTHER, "Update readme")];
    case "commit":
      return { detail: { sha: a.sha, parents: [OTHER], authorName: "Dev Example", authorEmail: "dev@example.com", authorDate: "2026-10-30T10:00:00Z", committerName: "Dev Example", committerDate: "2026-10-30T10:00:00Z", message: "Allow partial refunds" }, parent: OTHER, files: CHANGED.map((c) => ({ path: c.path, origPath: null, kind: c.kind })) };
    case "list_files":
      return { files: FILES, ignored: [] };
    case "list_dir": {
      const rel = a.rel as string;
      const at = rel ? `${rel}/` : "";
      const names = new Map(FILES.filter((f) => f.startsWith(at)).map((f) => { const [n, ...more] = f.slice(at.length).split("/"); return [n, more.length > 0]; }));
      return [...names].map(([name, isDir]) => ({ name, isDir }));
    }
    case "grep":
      return { hits: [{ path: FILES[3], line: 3, column: 1, text: "import { money } from './money';" }, { path: FILES[4], line: 8, column: 1, text: "import { money } from './money';" }], truncated: false };
    case "read_sources":
      return (a.sources as unknown as unknown[]).map(() => ({ kind: "text", text: "export const total = 1;\nexport const tax = 2;\n" }));
    case "file_history":
      return [];
    case "search_log":
      return { commits: [], truncated: false };
    case "blame":
      return { hunks: [], commits: {} };
    case "avatar":
      return null;
    case "run_action":
      return { ok: true, rejected: false, text: "" };
    default:
      if (cmd.startsWith("plugin:")) return null;
      throw new Error(`The harness has no answer for ${cmd}`);
  }
}
