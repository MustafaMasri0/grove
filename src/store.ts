import { create } from "zustand";
import {
  api,
  errorText,
  type BaseDiff,
  type BranchRef,
  type BranchStatus,
  type CommitSummary,
  type CommitWithFiles,
  type FileHistoryEntry,
  type FileList,
  type RepoInfo,
  type Source,
  type Status,
  type WorktreeInfo,
} from "./api";
import { uncommittedCount } from "./lib/changes";
import { sortPaths } from "./lib/tree";

import { normalizeSettings, defaultSettings, type ChangesMode, type Settings } from "./lib/settings";
import { isAppTab } from "./tabs";

export type { ChangesMode, Settings, Theme } from "./lib/settings";
export type LeftTab = "changes" | "history" | "explorer" | "search";

export type TabSpec =
  | { type: "diff"; path: string; origPath?: string | null; left: Source; right: Source; leftLabel: string; rightLabel: string }
  | { type: "file"; path: string; source: Source; line?: number }
  /** App-level tabs (no repository): the Settings page and settings.json. */
  | { type: "settings"; path: string }
  | { type: "settingsJson"; path: string };

export interface Tab {
  id: string;
  title: string;
  description: string;
  preview: boolean;
  spec: TabSpec;
  /** Empty for app-level tabs, which stay open across repositories. */
  repo: string;
  cwd: string;
}

/** A branch shown read-only because no worktree has it checked out. */
export interface ViewBranch {
  name: string;
  fullRef: string;
}

/** The file whose commits History shows instead of the branch's. */
export interface FileHistory {
  path: string;
  /** The revision its history is walked from. */
  rev: string;
  entries: FileHistoryEntry[];
  done: boolean;
  error: string | null;
}

/** Commits matching the History search, from the whole history of the revision. */
export interface HistoryMatches {
  query: string;
  commits: CommitSummary[];
  truncated: boolean;
  error: string | null;
}

/** At most this many search matches are listed. */
export const SEARCH_LIMIT = 500;

export interface ActionState {
  running: boolean;
  label: string;
  progress: string;
  error: string | null;
}

interface State {
  settings: Settings;
  settingsLoaded: boolean;
  /** Bumped after each write of settings.json. */
  settingsSaved: number;
  settingsQuery: string;
  repos: Record<string, RepoInfo | { error: string }>;
  repo: RepoInfo | null;
  repoError: string | null;
  worktrees: WorktreeInfo[];
  cwd: string | null;
  branches: BranchRef[];
  viewBranch: ViewBranch | null;
  status: Status | null;
  statusError: string | null;
  /** Worktree path → files with uncommitted changes; the current worktree's comes from its status. */
  changeCounts: Record<string, number>;
  leftTab: LeftTab;
  base: string | null;
  baseDiff: BaseDiff | null;
  baseError: string | null;
  commits: CommitSummary[];
  commitsDone: boolean;
  commitsError: string | null;
  selectedCommit: CommitWithFiles | null;
  fileHistory: FileHistory | null;
  historyQuery: string;
  /** Null while the search box is empty or its first search runs. */
  historyMatches: HistoryMatches | null;
  /** Blame margin in file views; for this session only. */
  blame: boolean;
  fileList: FileList | null;
  fileListKey: string;
  branchStatus: BranchStatus | null;
  action: ActionState;
  /** Bumped on every refresh so views reload what they show. */
  tick: number;
  tabs: Tab[];
  activeTab: string | null;
  quickOpen: boolean;
  searchFocus: number;
  systemDark: boolean;
  /** `owner/repo` when the repository's origin is on github.com. */
  githubRepo: string | null;
  /** A short message shown in a banner (a context menu option that failed). */
  notice: string | null;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  addRepo(path: string): Promise<void>;
  removeRepo(path: string): void;
  selectRepo(id: string): Promise<void>;
  selectWorktree(path: string): Promise<void>;
  selectBranch(b: BranchRef): Promise<void>;
  refresh(): Promise<void>;
  setLeftTab(t: LeftTab): void;
  setChangesMode(m: ChangesMode): void;
  setBase(b: string): void;
  /** Sets (or with null clears) the remembered base branch of any added repository. */
  setRepoBase(repoId: string, base: string | null): void;
  loadBaseDiff(): Promise<void>;
  loadMoreCommits(): Promise<void>;
  selectCommit(sha: string): Promise<void>;
  /** Shows a commit in History, whether or not its page of the list is loaded. */
  showCommit(sha: string): Promise<void>;
  /** Lists the commits that touched `path` (from `rev`, else the current revision) in History. */
  openFileHistory(path: string, rev?: string | null): Promise<void>;
  loadMoreFileHistory(): Promise<void>;
  closeFileHistory(): void;
  searchHistory(query: string): Promise<void>;
  toggleBlame(): void;
  loadFileList(): Promise<FileList | null>;
  loadBranchStatus(): Promise<void>;
  runAction(kind: "fetch" | "push" | "publish"): Promise<void>;
  clearActionError(): void;
  openTab(tab: Omit<Tab, "preview" | "repo" | "cwd">, pin: boolean): void;
  pinTab(id: string): void;
  closeTab(id: string): void;
  /** Closes several tabs; `keep` becomes active if the active tab is among them. */
  closeTabs(ids: string[], keep?: string): void;
  activateTab(id: string): void;
  cycleTab(delta: number): void;
  setQuickOpen(open: boolean): void;
  focusSearch(): void;
  setSystemDark(dark: boolean): void;
  openSettings(): void;
  openSettingsFile(): Promise<void>;
  setSettingsQuery(q: string): void;
  setNotice(n: string | null): void;
  loadChangeCounts(): Promise<void>;
}

let saveTimer: number | undefined;
/** One count batch at a time; refreshes that arrive meanwhile are covered by the running one. */
let countsLoading = false;

export const useStore = create<State>()((set, get) => {
  const at = () => {
    const { repo, cwd } = get();
    return repo && cwd ? { repo: repo.id, cwd } : null;
  };

  /** The revision the views show: the view-only branch, or the worktree's HEAD. */
  const currentRev = () => get().viewBranch?.fullRef ?? "HEAD";

  const loadStatus = async () => {
    const a = at();
    if (!a || get().viewBranch) return set({ status: null, statusError: null });
    try {
      const status = await api.status(a);
      if (at()?.cwd === a.cwd) set((s) => ({ status, statusError: null, changeCounts: { ...s.changeCounts, [a.cwd]: uncommittedCount(status) ?? 0 } }));
    } catch (e) {
      set({ statusError: errorText(e) });
    }
  };

  const resetViews = () =>
    set({
      commits: [],
      commitsDone: false,
      commitsError: null,
      selectedCommit: null,
      fileHistory: null,
      historyQuery: "",
      historyMatches: null,
      baseDiff: null,
      baseError: null,
      fileList: null,
      fileListKey: "",
      branchStatus: null,
    });

  /** Tabs that stay open when the repository changes, and which of them stays active. */
  const keepAppTabs = () => {
    const { tabs, activeTab } = get();
    const kept = tabs.filter(isAppTab);
    return { tabs: kept, activeTab: kept.some((t) => t.id === activeTab) ? activeTab : null };
  };

  const openAppTab = (tab: Omit<Tab, "preview" | "repo" | "cwd">) => {
    const { tabs, activeTab } = get();
    if (tabs.some((t) => t.id === tab.id)) return set({ tabs: tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t)), activeTab: tab.id });
    const copy = [...tabs];
    copy.splice(tabs.findIndex((t) => t.id === activeTab) + 1, 0, { ...tab, preview: false, repo: "", cwd: "" });
    set({ tabs: copy, activeTab: tab.id });
  };

  const loadForLeftTab = () => {
    const { leftTab, settings } = get();
    if (leftTab === "history" && get().commits.length === 0 && !get().fileHistory) void get().loadMoreCommits();
    if (leftTab === "changes" && settings.changesMode === "base") void get().loadBaseDiff();
    if (leftTab === "explorer") void get().loadFileList();
  };

  return {
    settings: defaultSettings,
    settingsLoaded: false,
    settingsSaved: 0,
    settingsQuery: "",
    repos: {},
    repo: null,
    repoError: null,
    worktrees: [],
    cwd: null,
    branches: [],
    viewBranch: null,
    status: null,
    statusError: null,
    changeCounts: {},
    leftTab: "changes",
    base: null,
    baseDiff: null,
    baseError: null,
    commits: [],
    commitsDone: false,
    commitsError: null,
    selectedCommit: null,
    fileHistory: null,
    historyQuery: "",
    historyMatches: null,
    blame: false,
    fileList: null,
    fileListKey: "",
    branchStatus: null,
    action: { running: false, label: "", progress: "", error: null },
    tick: 0,
    tabs: [],
    activeTab: null,
    quickOpen: false,
    searchFocus: 0,
    systemDark: true,
    githubRepo: null,
    notice: null,

    async init() {
      let saved: unknown = null;
      try {
        saved = await api.loadSettings();
      } catch {
        // First launch or unreadable settings: start fresh.
      }
      const settings = normalizeSettings(saved);
      set({ settings, settingsLoaded: true });
      for (const r of settings.repos) {
        api.openRepo(r).then(
          (info) => set((s) => ({ repos: { ...s.repos, [r]: info } })),
          (e) => set((s) => ({ repos: { ...s.repos, [r]: { error: errorText(e) } } })),
        );
      }
      if (settings.lastRepo && settings.repos.includes(settings.lastRepo)) await get().selectRepo(settings.lastRepo);
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        api.saveSettings(settings).then(
          () => set((s) => ({ settingsSaved: s.settingsSaved + 1 })),
          () => {},
        );
      }, 300);
    },

    async addRepo(path) {
      const trimmed = path.trim();
      if (!trimmed) return;
      const info = await api.openRepo(trimmed);
      const { settings } = get();
      if (!settings.repos.includes(trimmed)) get().updateSettings({ repos: [...settings.repos, trimmed] });
      set((s) => ({ repos: { ...s.repos, [trimmed]: info } }));
      await get().selectRepo(trimmed);
    },

    removeRepo(path) {
      const { settings, repo } = get();
      get().updateSettings({ repos: settings.repos.filter((r) => r !== path), lastRepo: settings.lastRepo === path ? null : settings.lastRepo });
      if (repo?.id === path) set({ repo: null, worktrees: [], cwd: null, branches: [], status: null, ...keepAppTabs() });
    },

    async selectRepo(id) {
      set({ repoError: null, viewBranch: null, ...keepAppTabs(), worktrees: [], branches: [], status: null, cwd: null, githubRepo: null, changeCounts: {} });
      resetViews();
      try {
        const info = await api.openRepo(id);
        set((s) => ({ repo: info, repos: { ...s.repos, [id]: info } }));
        get().updateSettings({ lastRepo: id });
        api.githubRepo({ repo: id, cwd: info.root }).then(
          (githubRepo) => {
            if (get().repo?.id === id) set({ githubRepo });
          },
          () => {},
        );
        const worktrees = await api.worktrees({ repo: id, cwd: info.root });
        set({ worktrees });
        void get().loadChangeCounts();
        const remembered = get().settings.lastWorktree[id];
        const pick =
          worktrees.find((w) => w.path === remembered && !w.missing) ??
          worktrees.find((w) => w.path === info.root) ??
          worktrees.find((w) => !w.missing);
        await get().selectWorktree(pick?.path ?? info.root);
      } catch (e) {
        set({ repo: null, repoError: errorText(e) });
      }
    },

    async selectWorktree(path) {
      const { repo, settings } = get();
      if (!repo) return;
      set({ cwd: path, viewBranch: null, status: null });
      resetViews();
      get().updateSettings({ lastWorktree: { ...settings.lastWorktree, [repo.id]: path } });
      const a = { repo: repo.id, cwd: path };
      api.watch(a).catch(() => {});
      await Promise.all([
        loadStatus(),
        api.branches(a).then((branches) => set({ branches }), () => {}),
        api.resolveBase(a, settings.base[repo.id] ?? null).then((base) => set({ base }), () => {}),
        get().loadBranchStatus(),
      ]);
      loadForLeftTab();
    },

    async selectBranch(b) {
      const wt = b.kind === "local" ? get().worktrees.find((w) => w.branch === b.name && !w.missing) : undefined;
      if (wt) return get().selectWorktree(wt.path);
      set({ viewBranch: { name: b.name, fullRef: b.fullRef }, status: null });
      resetViews();
      await get().loadBranchStatus();
      loadForLeftTab();
    },

    async refresh() {
      const a = at();
      if (!a) return;
      set((s) => ({ tick: s.tick + 1 }));
      const { repo } = get();
      await Promise.all([
        loadStatus(),
        api.worktrees(a).then(
          (worktrees) => {
            set({ worktrees });
            void get().loadChangeCounts();
          },
          () => {},
        ),
        api.branches(a).then((branches) => set({ branches }), () => {}),
        get().loadBranchStatus(),
      ]);
      if (!repo) return;
      const { leftTab, settings, commits } = get();
      if (leftTab === "changes" && settings.changesMode === "base") void get().loadBaseDiff();
      if (leftTab === "explorer") void get().loadFileList();
      if (leftTab === "history" && commits.length > 0) {
        // Reload the first page; keep the selection if it still exists.
        try {
          const page = settings.historyPageSize;
          const first = await api.log(a, currentRev(), 0, page);
          if (first[0]?.sha !== get().commits[0]?.sha) set({ commits: first, commitsDone: first.length < page });
        } catch {
          // Keep what is shown.
        }
      }
    },

    setLeftTab(t) {
      set({ leftTab: t });
      loadForLeftTab();
    },

    setChangesMode(m) {
      get().updateSettings({ changesMode: m });
      if (m === "base") void get().loadBaseDiff();
    },

    setBase(b) {
      const { repo, settings } = get();
      if (!repo) return;
      get().updateSettings({ base: { ...settings.base, [repo.id]: b } });
      set({ base: b, baseDiff: null });
      void get().loadBaseDiff();
    },

    setRepoBase(repoId, b) {
      const { settings, repo, cwd } = get();
      const base = { ...settings.base };
      if (b?.trim()) base[repoId] = b.trim();
      else delete base[repoId];
      get().updateSettings({ base });
      if (repo?.id !== repoId || !cwd) return;
      api.resolveBase({ repo: repoId, cwd }, base[repoId] ?? null).then(
        (resolved) => {
          if (get().repo?.id !== repoId) return;
          set({ base: resolved, baseDiff: null });
          if (get().settings.changesMode === "base") void get().loadBaseDiff();
        },
        () => {},
      );
    },

    async loadBaseDiff() {
      const a = at();
      const { base } = get();
      if (!a) return;
      if (!base) return set({ baseError: "No base branch found (looked for development, main and master)." });
      try {
        const baseDiff = await api.branchChanges(a, base, currentRev());
        set({ baseDiff, baseError: null });
      } catch (e) {
        set({ baseError: errorText(e) });
      }
    },

    async loadMoreCommits() {
      const a = at();
      const { commits, commitsDone, settings } = get();
      if (!a || commitsDone) return;
      const size = settings.historyPageSize;
      try {
        const page = await api.log(a, currentRev(), commits.length, size);
        set({ commits: [...commits, ...page], commitsDone: page.length < size, commitsError: null });
      } catch (e) {
        set({ commitsError: errorText(e), commitsDone: true });
      }
    },

    async selectCommit(sha) {
      const a = at();
      if (!a) return;
      try {
        set({ selectedCommit: await api.commit(a, sha) });
      } catch (e) {
        set({ commitsError: errorText(e) });
      }
    },

    async showCommit(sha) {
      if (get().leftTab !== "history") get().setLeftTab("history");
      await get().selectCommit(sha);
    },

    async openFileHistory(path, rev) {
      set({ fileHistory: { path, rev: rev ?? currentRev(), entries: [], done: false, error: null } });
      if (get().leftTab !== "history") get().setLeftTab("history");
      await get().loadMoreFileHistory();
    },

    async loadMoreFileHistory() {
      const a = at();
      const fh = get().fileHistory;
      if (!a || !fh || fh.done) return;
      const size = get().settings.historyPageSize;
      const still = () => get().fileHistory?.path === fh.path && get().fileHistory?.rev === fh.rev;
      try {
        const page = await api.fileHistory(a, fh.rev, fh.path, fh.entries.length, size);
        if (still()) set({ fileHistory: { ...fh, entries: [...fh.entries, ...page], done: page.length < size, error: null } });
      } catch (e) {
        if (still()) set({ fileHistory: { ...fh, done: true, error: errorText(e) } });
      }
    },

    closeFileHistory() {
      set({ fileHistory: null });
      if (get().leftTab === "history" && get().commits.length === 0) void get().loadMoreCommits();
    },

    async searchHistory(query) {
      const a = at();
      set({ historyQuery: query });
      const q = query.trim();
      if (!a || !q) return set({ historyMatches: null });
      try {
        const r = await api.searchLog(a, currentRev(), q, SEARCH_LIMIT);
        if (get().historyQuery.trim() === q) set({ historyMatches: { query: q, ...r, error: null } });
      } catch (e) {
        if (get().historyQuery.trim() === q) set({ historyMatches: { query: q, commits: [], truncated: false, error: errorText(e) } });
      }
    },

    toggleBlame() {
      set((s) => ({ blame: !s.blame }));
    },

    async loadFileList() {
      const a = at();
      if (!a) return null;
      const { viewBranch, settings } = get();
      const rev = viewBranch?.fullRef ?? null;
      const key = `${a.cwd}|${rev}|${settings.showIgnored}`;
      try {
        const list = await api.listFiles(a, rev, settings.showIgnored && !rev);
        const fileList = { files: sortPaths(list.files), ignored: sortPaths(list.ignored) };
        if (at()?.cwd === a.cwd) set({ fileList, fileListKey: key });
        return fileList;
      } catch {
        return null;
      }
    },

    async loadBranchStatus() {
      const a = at();
      if (!a) return;
      const { viewBranch, worktrees } = get();
      const branch = viewBranch ? (viewBranch.fullRef.startsWith("refs/heads/") ? viewBranch.name : null) : worktrees.find((w) => w.path === a.cwd)?.branch;
      try {
        const branchStatus = await api.branchStatus(a, branch ?? "");
        if (at()?.cwd === a.cwd) set({ branchStatus: { ...branchStatus, branch: branch ?? "" } });
      } catch {
        set({ branchStatus: null });
      }
    },

    async runAction(kind) {
      const a = at();
      const { branchStatus, action } = get();
      if (!a || action.running) return;
      const label = kind === "fetch" ? "Fetching origin" : kind === "push" ? "Pushing to origin" : "Publishing branch";
      set({ action: { running: true, label, progress: "", error: null } });
      try {
        await api.runAction(a, kind, branchStatus?.branch ?? "");
        set({ action: { running: false, label: "", progress: "", error: null } });
      } catch (e) {
        set({ action: { running: false, label: "", progress: "", error: errorText(e) } });
      }
      await get().refresh();
    },

    clearActionError() {
      set((s) => ({ action: { ...s.action, error: null } }));
    },

    openTab(tab, pin) {
      const { tabs, repo, cwd } = get();
      if (!repo || !cwd) return;
      const existing = tabs.find((t) => t.id === tab.id);
      if (existing) {
        set({
          tabs: tabs.map((t) => (t.id === tab.id ? { ...t, spec: tab.spec, preview: t.preview && !pin } : t)),
          activeTab: tab.id,
        });
        return;
      }
      const next: Tab = { ...tab, preview: !pin, repo: repo.id, cwd };
      const previewIdx = tabs.findIndex((t) => t.preview);
      if (!pin && previewIdx >= 0) {
        const copy = [...tabs];
        copy[previewIdx] = next;
        set({ tabs: copy, activeTab: next.id });
      } else {
        const activeIdx = tabs.findIndex((t) => t.id === get().activeTab);
        const copy = [...tabs];
        copy.splice(activeIdx + 1, 0, next);
        set({ tabs: copy, activeTab: next.id });
      }
    },

    pinTab(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) }));
    },

    closeTab(id) {
      const { tabs, activeTab } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const rest = tabs.filter((t) => t.id !== id);
      const nextActive = activeTab === id ? (rest[idx] ?? rest[idx - 1])?.id ?? null : activeTab;
      set({ tabs: rest, activeTab: nextActive });
    },

    closeTabs(ids, keep) {
      const { tabs, activeTab } = get();
      const gone = new Set(ids);
      const rest = tabs.filter((t) => !gone.has(t.id));
      if (rest.length === tabs.length) return;
      let nextActive = activeTab;
      if (activeTab && gone.has(activeTab)) {
        // The tab the menu was opened on, else the nearest one left of the active tab, else the first.
        const before = tabs.slice(0, tabs.findIndex((t) => t.id === activeTab)).filter((t) => !gone.has(t.id));
        nextActive = (keep && !gone.has(keep) ? keep : before.at(-1)?.id ?? rest[0]?.id) ?? null;
      }
      set({ tabs: rest, activeTab: nextActive });
    },

    activateTab(id) {
      set({ activeTab: id });
    },

    cycleTab(delta) {
      const { tabs, activeTab } = get();
      if (tabs.length === 0) return;
      const idx = tabs.findIndex((t) => t.id === activeTab);
      set({ activeTab: tabs[(idx + delta + tabs.length) % tabs.length].id });
    },

    setQuickOpen(open) {
      set({ quickOpen: open });
    },

    focusSearch() {
      set((s) => ({ leftTab: "search", searchFocus: s.searchFocus + 1 }));
    },

    setSystemDark(dark) {
      set({ systemDark: dark });
    },

    openSettings() {
      openAppTab({ id: "app:settings", title: "Settings", description: "", spec: { type: "settings", path: "Settings" } });
    },

    async openSettingsFile() {
      const { path } = await api.settingsFile();
      openAppTab({ id: "app:settings.json", title: "settings.json", description: "Read-only", spec: { type: "settingsJson", path } });
    },

    setSettingsQuery(q) {
      set({ settingsQuery: q });
    },

    setNotice(n) {
      set({ notice: n });
    },

    async loadChangeCounts() {
      const { repo, worktrees } = get();
      if (!repo || countsLoading) return;
      const paths = worktrees.filter((w) => !w.missing && !w.bare).map((w) => w.path);
      if (paths.length === 0) return;
      countsLoading = true;
      try {
        const counts = await api.changeCounts(repo.id, paths);
        if (get().repo?.id !== repo.id) return;
        const next: Record<string, number> = {};
        paths.forEach((p, i) => {
          const n = counts[i];
          if (n !== null && n !== undefined) next[p] = n;
        });
        // The current worktree's own status is newer than this batch.
        const { cwd, status, viewBranch } = get();
        const own = !viewBranch && cwd ? uncommittedCount(status) : null;
        if (cwd && own !== null) next[cwd] = own;
        set({ changeCounts: next });
      } catch {
        // Counts are a hint; keep what is shown.
      } finally {
        countsLoading = false;
      }
    },
  };
});

export function useAt() {
  const repo = useStore((s) => s.repo);
  const cwd = useStore((s) => s.cwd);
  return repo && cwd ? { repo: repo.id, cwd } : null;
}

export function effectiveDark(s: { settings: Settings; systemDark: boolean }): boolean {
  return s.settings.theme === "dark" || (s.settings.theme === "system" && s.systemDark);
}

export function setActionProgress(line: string) {
  useStore.setState((s) => (s.action.running ? { action: { ...s.action, progress: line } } : {}));
}
