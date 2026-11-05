// The backend of a made-up repository with three worktrees, for the real App in harness/app.html.
const ROOT = "/home/user/src/shop-platform";
const WT = [
  { path: ROOT, branch: "main", isMain: true },
  { path: "/home/user/src/agent-01", branch: "agent/orders-refund", isMain: false },
  { path: "/home/user/src/agent-02", branch: "agent/cart-rounding", isMain: false },
];
const HEAD = "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567";
const query = new URLSearchParams(location.search);
// ?states=1 adds a worktree that is gone and the bare repository, ?none=1 opens no repository, ?settings=<JSON> adds saved settings, ?reject=1 refuses pushes.
// ?many=1 gives agent-01 a long list of changes and the repository a long history, for the lists' keyboard use.
// ?ov=loading|fail|nobase|errors|many|one|odd picks what the Worktrees overview gets.
const OV = query.get("ov");
// ?issues=anonymous|limited|offline|notFound|sso|noOrigin|envToken picks what the issue commands answer; the default is a signed-in list.
const ISSUES = query.get("issues");
const UNUSUAL = [
  { path: "/home/user/src/agent-09", branch: "agent/old-spike", isMain: false, missing: true, prunable: "gitdir file points to non-existent location", bare: false },
  { path: "/home/user/src/shop-platform.git", branch: null, isMain: false, missing: false, prunable: null, bare: true },
];
const OTHER = "1b2c3d4e5f60718293a4b5c6d7e8f90123456789";
const commit = (sha: string, subject: string) => ({ sha, parents: [OTHER], authorName: "Dev Example", authorEmail: "dev@example.com", authorDate: "2026-10-30T10:00:00Z", subject });
const CHANGED = [
  { path: "src/server/orders/create.ts", origPath: null, kind: "modified", staged: ".", unstaged: "M" },
  { path: "src/client/cart/total.ts", origPath: null, kind: "added", staged: "A", unstaged: "." },
];
const MANY = query.has("many");
const EXTRA = Array.from({ length: 80 }, (_, i) => ({ path: `src/generated/part-${String(i + 1).padStart(2, "0")}.ts`, origPath: null, kind: "modified", staged: ".", unstaged: "M" }));
const CHANGES = MANY ? [...CHANGED, ...EXTRA] : CHANGED;
const FILES = ["README.md", "package.json", "src/client/cart/total.ts", "src/server/orders/create.ts", "src/server/orders/refund.ts", "assets/app.bin", "data/dump.json", "docs/preview.html", "docs/assets/logo.png", "docs/assets/order-flow.svg"];

// What the files hold. Long enough that sticky scroll, the minimap and the overview ruler have something to show.
const CODE = (extra: boolean) => [
  "// The order service.",
  'import { money } from "./money";',
  "",
  "export class Orders {",
  "  private readonly rate = 0.2;",
  "",
  ...Array.from({ length: 60 }, (_, i) => [`  async step${i}(input: string) {`, "    const value = input.trim();", i === 0 && extra ? '    const checked = audit.record("change");' : "    const parsed = parse(value);", i === 20 && extra ? "    return checked;" : '    return money(parsed, "EUR");', "  }", ""]).flat(),
  "}",
  "",
].join("\n");
const MARKDOWN = ["# shop-platform", "", "A sample storefront. See [Architecture](docs/architecture.md), or jump to [Usage](#usage).", "", "![Build status](https://example.com/badges/build.svg)", "", "![Order flow](docs/assets/order-flow.svg)", "", "## Usage", "", "Run the dev server with `npm run dev`.", "", "| Command | What it does |", "| --- | --- |", "| `npm test` | Runs the unit tests |", "", "```ts", "export const total = 1;", "```", "", "> Keep changes small.", ""].join("\n");
const HTML_PAGE = '<!doctype html><html><head><title>Order status</title></head><body><h1>Order status</h1><p><a href="#x">Back</a> <a href="guide.html">Guide</a></p></body></html>';
const svg = (fill: string, w: number, h: number) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`)}`;
const text = (t: string) => ({ kind: "text", text: t });
type Src = { kind: string; path?: string };
const contentOf = (s: Src, right: boolean) => {
  if (s.kind === "empty") return text("");
  switch (s.path) {
    case "assets/app.bin":
      return { kind: "binary", size: 12698 };
    case "data/dump.json":
      return { kind: "tooLarge", size: 6815744 };
    case "src/removed.ts":
      return { kind: "missing" };
    case "README.md":
      return text(MARKDOWN);
    case "docs/preview.html":
      return text(HTML_PAGE);
    default:
      return text(CODE(right));
  }
};
const imageOf = (s: Src, i: number) => {
  if (s.kind === "empty" || s.path === "docs/assets/gone.png") return { kind: "missing" };
  if (s.path === "docs/assets/huge.png") return { kind: "tooLarge", size: 50331648 };
  if (s.path === "docs/assets/broken.png") return { kind: "image", size: 2048, url: "data:image/png;base64,AAAA" };
  return { kind: "image", size: 2900 + i, url: svg(i ? "#1d6b64" : "#2b5fa8", 320, 200) };
};
const HISTORY = Array.from({ length: 120 }, (_, i) => ({ ...commit(String(i).padStart(40, "a"), `Change number ${i}`), parents: [OTHER] }));
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

const SHARED_DIRS = ["src/server/orders/", "src/client/cart/", "src/shared/", "test/"];
const SHARED = Array.from({ length: 15 }, (_, i) => `${SHARED_DIRS[i % SHARED_DIRS.length]}shared-${String(i + 1).padStart(2, "0")}.ts`);
const overview = () => {
  const worktrees = WT.map(summary);
  const [root, one, two] = worktrees;
  switch (OV) {
    case "loading":
      return new Promise(() => {});
    case "fail":
      throw "Could not read the worktrees: the connection to dev-box timed out";
    case "errors":
      return { worktrees: [root, one], errors: { [two.path]: "fatal: not a git repository: /home/user/src/agent-02" }, overlaps: [] };
    case "many":
      return { worktrees, errors: {}, overlaps: [{ a: root.path, b: one.path, files: SHARED.filter((_, i) => i % 2) }, { a: one.path, b: two.path, files: SHARED }] };
    case "one":
      return { worktrees: [root], errors: {}, overlaps: [] };
    case "odd":
      return {
        worktrees: [
          { ...root, upstreamAhead: 2, upstreamBehind: 1 },
          { ...one, branch: null, upstream: null },
          { ...two, branch: null, head: null, lastCommit: null, baseAhead: 0 },
        ],
        errors: {},
        overlaps: [],
      };
    default:
      return { worktrees, errors: {}, overlaps: [] };
  }
};

const auto = () => {
  const given = JSON.parse(new URLSearchParams(location.search).get("auto") ?? "{}");
  const none = Object.fromEntries(["openDiffs", "openFile", "showHistory", "runAction", "openSettings", "leftTab", "settingsPatch", "contextMenu", "fileHistory", "blame", "historySearch", "openRevFile", "openCommitFile", "imageZoom", "previewLink", "reveal", "listKeys", "worktrees"].map((k) => [k, null]));
  return { ...none, ...given };
};

const TRACKER = { name: "GitHub", project: "example-org/shop-platform", webUrl: "https://github.com/example-org/shop-platform/issues" };
const person = (name: string) => ({ name, avatarUrl: null });
const ISSUE_LIST = [
  { number: 142, title: "Refunds round the wrong way for some currencies", state: "open", labels: [{ name: "bug", color: "#d73a4a" }], author: person("ada-l"), assignees: [person("ada-l")], commentCount: 3, updatedAt: "2026-11-05T09:00:00Z" },
  { number: 139, title: "Export to CSV drops the last column", state: "open", labels: [{ name: "bug", color: "#d73a4a" }, { name: "performance", color: "#fbca04" }], author: person("noor-h"), assignees: [], commentCount: 1, updatedAt: "2026-11-04T09:00:00Z" },
  { number: 128, title: "Add a keyboard shortcut for the search box", state: "open", labels: [{ name: "enhancement", color: "#a2eeef" }], author: person("rui-p"), assignees: [], commentCount: 0, updatedAt: "2026-11-02T09:00:00Z" },
  { number: 116, title: "Avatar placeholder is clipped in the profile menu", state: "closed", labels: [], author: person("rui-p"), assignees: [], commentCount: 1, updatedAt: "2026-10-20T09:00:00Z" },
];
const issueList = () => {
  const soon = Math.floor(Date.now() / 1000) + 1800;
  switch (ISSUES) {
    case "noOrigin":
      throw { kind: "noOrigin" };
    case "notFound":
      throw { kind: "notFound", account: "work-login", signedIn: true };
    case "sso":
      throw { kind: "singleSignOn", url: "https://github.com/orgs/example-org/sso" };
    // The first load succeeds; Refresh shows the trouble over the loaded issues.
    case "limited":
    case "offline":
      if (window.__ipc.filter((c) => c.cmd === "issues").length > 1) throw ISSUES === "limited" ? { kind: "rateLimited", resetsAt: soon } : { kind: "network", message: "offline" };
  }
  return { kind: "issues", issues: ISSUE_LIST, more: false, signedIn: ISSUES !== "anonymous" };
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
      return { ...(query.has("none") ? {} : { repos: [ROOT], lastRepo: ROOT, lastWorktree: { [ROOT]: WT[1].path } }), theme: query.get("theme") ?? "dark", uiFontSize: Number(query.get("font")) || 13, ...JSON.parse(query.get("settings") ?? "{}") };
    case "save_settings":
    case "watch":
    case "copy_text":
    case "open_terminal":
      return null;
    case "settings_file":
      return { path: "C:\\Users\\user\\AppData\\Roaming\\Grove\\settings.json", text: "{}" };
    case "automation":
      return auto();
    case "clone_repo":
      if (String(a.url).includes("denied")) throw "fatal: could not read Username for 'https://example.com': terminal prompts disabled";
      return `${a.parent}\\${a.name}`;
    case "open_repo":
      // Made-up failures, for the repository menu: what remote.rs and open_repo answer.
      if (String(a.path).includes("denied-box")) throw "ssh user@denied-box: user@denied-box: Permission denied (publickey).\nGrove signs in with your ssh config, keys and agent. It cannot ask for a password or passphrase: load the key into ssh-agent.";
      if (String(a.path).includes("not-a-repo")) throw `${a.path} is not a git repository (fatal: not a git repository (or any of the parent directories): .git)`;
      return repoInfo(a.path);
    case "worktrees":
      return [...WT.map((w) => ({ ...w, missing: false, prunable: null, bare: false })), ...(query.has("states") ? UNUSUAL : [])].map((w) => ({ path: w.path, head: w.bare ? null : HEAD, branch: w.branch, detached: false, bare: w.bare, locked: null, prunable: w.prunable, isMain: w.isMain, displayPath: w.path, missing: w.missing }));
    case "branches":
      return [...WT.map((w) => ({ name: w.branch, fullRef: `refs/heads/${w.branch}`, kind: "local", oid: HEAD, upstream: null, ahead: 0, behind: 0, upstreamGone: false, committerUnix: 1_790_000_000, isHead: false })), { name: "origin/main", fullRef: "refs/remotes/origin/main", kind: "remote", oid: HEAD, upstream: null, ahead: 0, behind: 0, upstreamGone: false, committerUnix: 1_790_000_000, isHead: false }];
    case "status":
      return { branch: { oid: HEAD, head: "agent/orders-refund", upstream: null, ahead: 1, behind: 0 }, entries: a.cwd === WT[1].path ? CHANGES : [] };
    case "worktrees_overview":
      return overview();
    case "resolve_base":
      return OV === "nobase" ? null : "main";
    case "branch_changes":
      return { mergeBase: OTHER, files: CHANGED.map((c) => ({ path: c.path, origPath: null, kind: c.kind })) };
    case "branch_status":
      return { branch: a.branch, upstream: null, upstreamGone: false, ahead: 1, behind: 0, hasOrigin: true, lastFetched: 1_790_000_000 };
    case "github_repo":
      return null;
    case "log":
      if (MANY) return HISTORY.slice(a.skip as number, (a.skip as number) + (a.limit as number));
      return a.skip ? [] : [commit(HEAD, "Allow partial refunds"), commit(OTHER, "Update readme")];
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
    case "read_sources": {
      const sources = a.sources as unknown as Src[];
      return sources.map((s, i) => contentOf(s, i === sources.length - 1 && sources.length > 1));
    }
    case "image_sources":
      return (a.sources as unknown as Src[]).map(imageOf);
    case "read_image":
      return svg("#2b5fa8", 480, 200);
    case "preview_base":
      return "http://wvfile.localhost/base/";
    case "preview_page":
      return `data:text/html;charset=utf-8,${encodeURIComponent(a.html as string)}`;
    case "drop_preview_page":
      return null;
    case "file_history":
      return a.skip ? [] : [commit(HEAD, "Allow partial refunds"), commit(OTHER, "Update readme")].map((c) => ({ commit: c, file: { path: a.path, origPath: null, kind: "modified" }, parent: OTHER }));
    case "search_log":
      return { commits: [commit(HEAD, "Allow partial refunds"), commit(OTHER, "Update readme")].filter((c) => c.subject.toLowerCase().includes(String(a.query).toLowerCase())), truncated: false };
    case "blame":
      return {
        hunks: [{ sha: HEAD, start: 1, count: 40 }, { sha: OTHER, start: 41, count: 400 }],
        commits: { [HEAD]: { authorName: "Dev Example", authorEmail: "dev@example.com", authorTime: 1_790_000_000, summary: "Allow partial refunds", uncommitted: false }, [OTHER]: { authorName: "Ada Example", authorEmail: "ada@example.com", authorTime: 1_789_000_000, summary: "Update readme", uncommitted: false } },
      };
    case "avatar":
      return null;
    case "issue_tracker":
      if (ISSUES === "noOrigin") throw { kind: "noOrigin" };
      return TRACKER;
    case "issues":
      return issueList();
    case "issue": {
      const s = ISSUE_LIST.find((i) => i.number === a.number) ?? ISSUE_LIST[0];
      return { issue: { ...s, body: "Steps to reproduce are in the first comment.", milestone: null, createdAt: s.updatedAt, closedAt: null, webUrl: `${TRACKER.webUrl}/${s.number}` }, comments: [] };
    }
    case "issue_logins":
      return { accounts: ["octo", "work-login"], default: "octo", fixedBy: ISSUES === "envToken" ? "GH_TOKEN" : null };
    case "run_action":
      return query.has("reject") ? { ok: false, rejected: true, text: "! [rejected] agent/orders-refund -> agent/orders-refund (fetch first)" } : { ok: true, rejected: false, text: "" };
    default:
      if (cmd.startsWith("plugin:")) return null;
      throw new Error(`The harness has no answer for ${cmd}`);
  }
}
