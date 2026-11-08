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
  type Overview,
  type RepoInfo,
  type Status,
  type WorktreeChanged,
  type WorktreeInfo,
} from "./api";
import { uncommittedCount } from "./lib/changes";
import { coalesce } from "./lib/coalesce";
import { shortSha } from "./lib/format";
import type { PaletteScope } from "./lib/palette";
import type { SectionId } from "./lib/settingsSchema";
import { bandOf, isNarrow } from "./lib/shell";
import { activityBetween, addActivity, DEFAULT_OVERVIEW_SORT, editsOf, readablePaths, type ActivityEvent, type OverviewSort } from "./lib/worktrees";
import { sortPaths } from "./lib/tree";

import { normalizeSettings, defaultSettings, type ChangesMode, type Settings } from "./lib/settings";
import { docKey, fileTab, isAppTab, issueTab, parkTabs, revisionTab, settingsTab, uncommittedTab, unparkTabs, type ParkedTab, type Tab, type TabDraft } from "./tabs";

export type { ChangesMode, Settings, Theme } from "./lib/settings";
export type LeftTab = "changes" | "history" | "explorer" | "search";

/** What fills the window: every worktree side by side, or one worktree's files. */
export type View = "overview" | "work";

/** What the work view's list pane shows: the worktree's panes, or the repository's issues. */
export type ListPane = "worktree" | "issues";

/** A branch shown read-only because no worktree has it checked out. */
export interface ViewBranch {
  name: string;
  fullRef: string;
}

/** What a worktree has open while another one is shown; this session only. */
export interface WorktreeView {
  tabs: ParkedTab[];
  activeTab: string | null;
  leftTab: LeftTab;
  viewBranch: ViewBranch | null;
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
  /** The remote refused this worktree's last push; stays until a push or publish succeeds. */
  rejected: boolean;
}

const IDLE_ACTION: ActionState = { running: false, label: "", progress: "", error: null, rejected: false };

interface State {
  settings: Settings;
  settingsLoaded: boolean;
  /** Bumped after each write of settings.json. */
  settingsSaved: number;
  settingsQuery: string;
  /** The section Settings opens at. */
  settingsSection: SectionId;
  /** Repositories opened this session, or why opening failed; saved ones open only when picked. */
  repos: Record<string, KnownRepo>;
  repo: RepoInfo | null;
  repoError: string | null;
  worktrees: WorktreeInfo[];
  cwd: string | null;
  branches: BranchRef[];
  viewBranch: ViewBranch | null;
  /** Worktree path → what it had open, for every worktree but the shown one. */
  parked: Record<string, WorktreeView>;
  view: View;
  listPane: ListPane;
  settingsOpen: boolean;
  status: Status | null;
  statusError: string | null;
  /** Worktree path → files with uncommitted changes; the current worktree's comes from its status. */
  changeCounts: Record<string, number>;
  /** Every worktree of the repository side by side, and the files they both change. */
  overview: Overview | null;
  overviewError: string | null;
  /** The overview table's order. It outlives the page, so opening a worktree and coming back keeps it. */
  overviewSort: OverviewSort;
  /** Worktree path → when its files last changed (unix seconds), from the watcher; this session only. */
  lastChange: Record<string, number>;
  /** What happened in the worktrees, newest first; this session only. */
  activity: ActivityEvent[];
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
  /** A file Explorer is asked to reveal ("Reveal in Explorer"); Explorer clears it once done. */
  explorerReveal: { path: string } | null;
  branchStatus: BranchStatus | null;
  /** Worktree path → its fetch, push or publish. */
  actions: Record<string, ActionState>;
  /** Bumped on every refresh so views reload what they show. */
  tick: number;
  tabs: Tab[];
  activeTab: string | null;
  /** `docKey` → tab title, for every document with edits not saved yet: open tabs and those parked with their worktree. */
  unsaved: Record<string, string>;
  /** What the palette is searching while it is open: everything (Ctrl+K), or the worktree's files (Ctrl+P). */
  palette: PaletteScope | null;
  searchFocus: number;
  /** The issue list is to take the keyboard as soon as it shows (Ctrl+I); it clears this when it does. */
  issuesFocus: boolean;
  systemDark: boolean;
  /** `owner/repo` when the repository's origin is on github.com. */
  githubRepo: string | null;
  /** A short message shown in a banner (a context menu option that failed). */
  notice: string | null;
  /** The host whose connection was lost, while reconnecting. */
  connectionLost: string | null;
  /** The app's width in CSS pixels; the shell's bands follow it. */
  appWidth: number;
  /** Below 1100px: whether the list drawer is out. */
  listOpen: boolean;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;
  addRepo(path: string): Promise<void>;
  /** Asks first when the repository's tabs have unsaved edits. */
  removeRepo(path: string): Promise<void>;
  selectRepo(id: string): Promise<void>;
  selectWorktree(path: string): Promise<void>;
  selectBranch(b: BranchRef): Promise<void>;
  refresh(): Promise<void>;
  /** Shows a worktree pane in the list pane. */
  setLeftTab(t: LeftTab): void;
  /** Shows the repository's issues in the list pane (the rail's Issues row, Ctrl+I); `focus` puts the keyboard in the list. */
  showIssues(focus?: boolean): void;
  /** Shows Explorer with `path` selected and its folders expanded. */
  revealInExplorer(path: string): void;
  setChangesMode(m: ChangesMode): void;
  setBase(b: string): void;
  /** Sets (or with null clears) the remembered base branch of any added repository. */
  setRepoBase(repoId: string, base: string | null): void;
  /** The login a repository's issues are read with; null or blank: the default one. */
  setIssueAccount(repoId: string, login: string | null): void;
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
  openTab(tab: TabDraft, pin: boolean): void;
  /** Opens an issue of the repository as a tab (a preview unless `pin`); `title` when already known. */
  openIssue(number: number, title: string | undefined, pin: boolean): void;
  setTabTitle(id: string, title: string): void;
  pinTab(id: string): void;
  /** Asks first when the tab has unsaved edits; with none it closes at once. */
  closeTab(id: string): Promise<void>;
  /** Closes several tabs, asking first about unsaved edits; `keep` becomes active if the active tab is among them. */
  closeTabs(ids: string[], keep?: string): Promise<void>;
  /** Records whether a tab's document has edits not saved yet; a tab with edits is kept open rather than replaced as a preview. */
  markUnsaved(tab: Tab, unsaved: boolean): void;
  activateTab(id: string): void;
  cycleTab(delta: number): void;
  setPalette(scope: PaletteScope | null): void;
  focusSearch(): void;
  setSystemDark(dark: boolean): void;
  setView(view: View): void;
  /** With a section, shows that section, filtered by `query` (default: unfiltered). */
  openSettings(section?: SectionId, query?: string): void;
  closeSettings(): void;
  openSettingsFile(): Promise<void>;
  setSettingsQuery(q: string): void;
  setNotice(n: string | null): void;
  setAppWidth(width: number): void;
  toggleList(): void;
  /** A helper went away (`name` says which): its watches are gone, so reconnect and watch again. */
  reconnect: (name: string) => Promise<void>;
  /** Reloads the worktree list and the overview; one load at a time, with one more after it when asked meanwhile. */
  loadOverview(): Promise<void>;
  setOverviewSort(sort: OverviewSort): void;
  /** A watcher event: refreshes what it affects and records the activity. */
  noteChange(change: WorktreeChanged): void;
  /**
   * Switches to worktree `cwd` and opens its change to `path`, as the Changes list would: the
   * uncommitted diff, else the branch-vs-base diff, else the file itself.
   */
  openWorktreeChange(cwd: string, path: string): Promise<void>;
  /** Switches to worktree `cwd` and shows commit `sha` in History. */
  openWorktreeCommit(cwd: string, sha: string): Promise<void>;
}

/** Pause between attempts to reach a lost host. */
const RECONNECT_MS = 5_000;
let saveTimer: number | undefined;
let overviewTimer: number | undefined;
/** Worktree path → files the watcher saw change since the last overview load, for Activity. */
let edited = new Map<string, Set<string>>();
/** The repository and worktrees being watched, so an unchanged list is not watched again. */
let watched = "";
let reconnecting = false;
/** Counts repository selections, so only the last one finishes. */
let repoPick = 0;

export const useStore = create<State>()((set, get) => {
  const at = () => {
    const { repo, cwd } = get();
    return repo && cwd ? { repo: repo.id, cwd } : null;
  };

  /** The revision the views show: the view-only branch, or the worktree's HEAD. */
  const currentRev = () => get().viewBranch?.fullRef ?? "HEAD";

  const shownKey = () => {
    const { repo, cwd, viewBranch } = get();
    return `${repo?.id}\n${cwd}\n${viewBranch?.fullRef}`;
  };

  /** A check that what is shown now is still shown: a late answer must not land in another worktree. */
  const whileShown = () => {
    const key = shownKey();
    return () => shownKey() === key;
  };

  const loadStatus = async () => {
    const a = at();
    if (!a || get().viewBranch) return set({ status: null, statusError: null });
    const shown = whileShown();
    try {
      const status = await api.status(a);
      if (shown()) set((s) => ({ status, statusError: null, changeCounts: { ...s.changeCounts, [a.cwd]: uncommittedCount(status) ?? 0 } }));
    } catch (e) {
      if (shown()) set({ statusError: errorText(e) });
    }
  };

  const loadBranches = (a: { repo: string; cwd: string }) => {
    const shown = whileShown();
    return api.branches(a).then(
      (branches) => {
        if (shown()) set({ branches });
      },
      () => {},
    );
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

  /** Parks what the shown worktree has open and shows `path` with what it had open; other tabs stay where they are. */
  const swapViews = (path: string, dropViewBranch: boolean) => {
    const { cwd, tabs, activeTab, leftTab, viewBranch, parked } = get();
    if (path === cwd) return dropViewBranch ? set({ viewBranch: null }) : undefined;
    const { staying, parked: own } = parkTabs(tabs);
    const { [path]: next = { tabs: [], activeTab: null, leftTab: "changes" as const, viewBranch: null }, ...others } = parked;
    const keepActive = staying.some((t) => t.id === activeTab);
    set({
      parked: cwd ? { ...others, [cwd]: { tabs: own, activeTab: keepActive ? null : activeTab, leftTab, viewBranch } } : others,
      tabs: unparkTabs(staying, next.tabs),
      activeTab: next.activeTab ?? (keepActive ? activeTab : null),
      leftTab: next.leftTab,
      viewBranch: dropViewBranch ? null : next.viewBranch,
    });
  };

  const showWorktree = async (path: string, dropViewBranch: boolean) => {
    const { repo, settings } = get();
    if (!repo) return;
    swapViews(path, dropViewBranch);
    set({ cwd: path, status: null });
    resetViews();
    get().updateSettings({ lastWorktree: { ...settings.lastWorktree, [repo.id]: path } });
    const a = { repo: repo.id, cwd: path };
    const shown = whileShown();
    await Promise.all([
      loadStatus(),
      loadBranches(a),
      api.resolveBase(a, settings.base[repo.id] ?? null).then(
        (base) => {
          if (shown()) set({ base });
        },
        () => {},
      ),
      get().loadBranchStatus(),
    ]);
    if (shown()) loadForLeftTab();
    void get().loadOverview();
  };

  const showWork = () => set({ view: "work", settingsOpen: false });

  /**
   * Whether the unsaved edits of these documents (`docKey`s; all of them when left out) may be thrown away: true at
   * once when none has any, else the user's answer. Callers check `=== true` before awaiting, so closing without
   * edits stays synchronous.
   */
  const mayDiscard = (keys?: readonly string[]): true | Promise<boolean> => {
    const { unsaved } = get();
    const names = (keys ?? Object.keys(unsaved)).flatMap((k) => (k in unsaved ? [unsaved[k]] : []));
    return names.length === 0 ? true : api.confirmDiscard(names);
  };

  /** `unsaved` without these documents. */
  const forget = (keys: readonly string[]) => {
    const unsaved = { ...get().unsaved };
    for (const k of keys) delete unsaved[k];
    return unsaved;
  };

  /** With no repository the work view exists only for settings.json: without a tab it goes back to the welcome page. */
  const afterClosing = (rest: readonly Tab[]) => (!get().repo && rest.length === 0 ? { view: "overview" as const } : {});

  /** Watches every worktree of the repository, for refreshes and live activity. */
  const watchWorktrees = () => {
    const { repo, worktrees } = get();
    if (!repo) return;
    const paths = readablePaths(worktrees);
    const key = [repo.id, ...paths].join("\n");
    if (key === watched) return;
    watched = key;
    api.watch(repo.id, paths).catch(() => {
      watched = "";
    });
  };

  const loadOverviewOnce = async () => {
    const { repo } = get();
    if (!repo) return;
    // Edits seen from here on go to the next load.
    const seen = edited;
    edited = new Map();
    try {
      const worktrees = await api.worktrees({ repo: repo.id, cwd: repo.root });
      if (get().repo?.id !== repo.id) return;
      set({ worktrees });
      watchWorktrees();
      const findOverlaps = get().settings.possibleConflicts;
      const overview = await api.worktreesOverview(repo.id, readablePaths(worktrees), get().base, findOverlaps);
      // After turning the setting over, the load it asked for is the one to show.
      if (get().repo?.id !== repo.id || get().settings.possibleConflicts !== findOverlaps) return;
      const prev = get().overview;
      const now = Date.now() / 1000;
      const events = [...(prev ? activityBetween(prev.worktrees, overview.worktrees, now) : []), ...editsOf(seen, overview.worktrees, now)];
      const changeCounts = Object.fromEntries(overview.worktrees.map((w) => [w.path, w.uncommitted.length]));
      // The current worktree's own status may be newer than this overview.
      const { cwd, status, viewBranch } = get();
      const own = !viewBranch && cwd ? uncommittedCount(status) : null;
      if (cwd && own !== null) changeCounts[cwd] = own;
      set((s) => ({ overview, overviewError: null, changeCounts, activity: addActivity(s.activity, events) }));
    } catch (e) {
      if (get().repo?.id === repo.id) set({ overviewError: errorText(e) });
    }
  };

  /** Shows worktree `cwd`, leaving any branch on view; false when that did not happen. */
  const enterWorktree = async (cwd: string) => {
    showWork();
    if (get().cwd !== cwd || get().viewBranch) await showWorktree(cwd, true);
    return get().cwd === cwd && !get().viewBranch;
  };

  /**
   * Shows `next` in the work view: an open tab of the same id is updated (and kept open with `pin`);
   * else `next` takes the preview tab's place, or opens right of the active tab.
   */
  const placeTab = (next: Tab, pin: boolean) => {
    const { tabs } = get();
    showWork();
    // Below 1100px the tab covers the drawer it was picked from; ListView keeps it out while arrow keys preview.
    if (isNarrow(get().appWidth)) set({ listOpen: false });
    if (tabs.some((t) => t.id === next.id)) {
      set({ tabs: tabs.map((t) => (t.id === next.id ? { ...next, isPreview: t.isPreview && !pin } : t)), activeTab: next.id });
      return;
    }
    const copy = [...tabs];
    const previewIdx = tabs.findIndex((t) => t.isPreview);
    if (!pin && previewIdx >= 0) copy[previewIdx] = next;
    else copy.splice(tabs.findIndex((t) => t.id === get().activeTab) + 1, 0, next);
    set({ tabs: copy, activeTab: next.id });
  };

  /** Shows worktree pane `t` unless it is already shown (it would load again). */
  const showLeftTab = (t: LeftTab) => {
    const { leftTab, listPane } = get();
    if (leftTab !== t || listPane !== "worktree") get().setLeftTab(t);
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
    settingsSection: "appearance",
    repos: {},
    repo: null,
    repoError: null,
    worktrees: [],
    cwd: null,
    branches: [],
    viewBranch: null,
    parked: {},
    view: "overview",
    listPane: "worktree",
    settingsOpen: false,
    status: null,
    statusError: null,
    changeCounts: {},
    overview: null,
    overviewError: null,
    overviewSort: DEFAULT_OVERVIEW_SORT,
    lastChange: {},
    activity: [],
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
    explorerReveal: null,
    branchStatus: null,
    actions: {},
    tick: 0,
    tabs: [],
    activeTab: null,
    unsaved: {},
    palette: null,
    searchFocus: 0,
    issuesFocus: false,
    systemDark: true,
    githubRepo: null,
    notice: null,
    connectionLost: null,
    appWidth: 1440,
    listOpen: true,

    async init() {
      let saved: unknown = null;
      try {
        saved = await api.loadSettings();
      } catch {
        // First launch or unreadable settings: start fresh.
      }
      const settings = normalizeSettings(saved);
      set({ settings, settingsLoaded: true });
      // Only the last repository opens: opening one starts its machine (a WSL distro, an SSH connection).
      if (settings.lastRepo && settings.repos.includes(settings.lastRepo)) await get().selectRepo(settings.lastRepo);
    },

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      const conflictsChanged = settings.possibleConflicts !== get().settings.possibleConflicts;
      // The overview in hand answers the old setting: dropped, so "no conflicts" never shows before they were looked for.
      set(conflictsChanged ? { settings, overview: null } : { settings });
      if (conflictsChanged) void get().loadOverview();
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

    async removeRepo(path) {
      if (get().repo?.id === path) {
        const ok = mayDiscard();
        if (ok !== true && !(await ok)) return;
      }
      const { settings, repo } = get();
      get().updateSettings({ repos: settings.repos.filter((r) => r !== path), lastRepo: settings.lastRepo === path ? null : settings.lastRepo });
      if (repo?.id === path) set({ repo: null, worktrees: [], cwd: null, branches: [], status: null, parked: {}, viewBranch: null, view: "overview", overview: null, unsaved: {}, ...keepAppTabs() });
    },

    async selectRepo(id) {
      // Every worktree tab closes, so all unsaved edits would go.
      const ok = mayDiscard();
      if (ok !== true && !(await ok)) return;
      const pick = ++repoPick;
      set({
        unsaved: {},
        repoError: null,
        viewBranch: null,
        parked: {},
        leftTab: "changes",
        actions: {},
        view: "overview",
        listPane: "worktree",
        settingsOpen: false,
        ...keepAppTabs(),
        worktrees: [],
        branches: [],
        status: null,
        cwd: null,
        githubRepo: null,
        changeCounts: {},
        overview: null,
        overviewError: null,
        lastChange: {},
        activity: [],
      });
      edited = new Map();
      resetViews();
      let info: RepoInfo;
      try {
        info = await api.openRepo(id);
      } catch (e) {
        // Kept by the picker and Settings, which show it beside the repository.
        if (pick === repoPick) set((s) => ({ repo: null, repoError: errorText(e), repos: { ...s.repos, [id]: { error: errorText(e) } } }));
        return;
      }
      if (pick !== repoPick) return;
      set((s) => ({ repo: info, repos: { ...s.repos, [id]: info } }));
      try {
        get().updateSettings({ lastRepo: id });
        api.githubRepo({ repo: id, cwd: info.root }).then(
          (githubRepo) => {
            if (get().repo?.id === id) set({ githubRepo });
          },
          () => {},
        );
        const worktrees = await api.worktrees({ repo: id, cwd: info.root });
        if (pick !== repoPick) return;
        set({ worktrees });
        watchWorktrees();
        const remembered = get().settings.lastWorktree[id];
        const worktree =
          worktrees.find((w) => w.path === remembered && !w.missing) ??
          worktrees.find((w) => w.path === info.root) ??
          worktrees.find((w) => !w.missing);
        await showWorktree(worktree?.path ?? info.root, false);
      } catch (e) {
        if (pick === repoPick) set({ repo: null, repoError: errorText(e) });
      }
    },

    async selectWorktree(path) {
      const { repo, cwd, viewBranch } = get();
      if (!repo) return;
      showWork();
      set({ listOpen: true, listPane: "worktree" });
      if (path === cwd && !viewBranch) return;
      await showWorktree(path, path === cwd);
    },

    async selectBranch(b) {
      const wt = b.kind === "local" ? get().worktrees.find((w) => w.branch === b.name && !w.missing) : undefined;
      if (wt) {
        await enterWorktree(wt.path);
        return;
      }
      showWork();
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
      const shown = whileShown();
      await Promise.all([loadStatus(), get().loadOverview(), loadBranches(a), get().loadBranchStatus()]);
      if (!repo || !shown()) return;
      const { leftTab, settings, commits } = get();
      if (leftTab === "changes" && settings.changesMode === "base") void get().loadBaseDiff();
      if (leftTab === "explorer") void get().loadFileList();
      if (leftTab === "history" && commits.length > 0) {
        // Reload the first page; keep the selection if it still exists.
        try {
          const page = settings.historyPageSize;
          const first = await api.log(a, currentRev(), 0, page);
          if (shown() && first[0]?.sha !== get().commits[0]?.sha) set({ commits: first, commitsDone: first.length < page });
        } catch {
          // Keep what is shown.
        }
      }
    },

    setLeftTab(t) {
      set({ leftTab: t, listOpen: true, listPane: "worktree" });
      loadForLeftTab();
    },

    showIssues(focus = false) {
      if (!get().repo) return;
      set((s) => ({ view: "work", settingsOpen: false, listPane: "issues", listOpen: true, issuesFocus: s.issuesFocus || focus }));
    },

    revealInExplorer(path) {
      set({ explorerReveal: { path } });
      showLeftTab("explorer");
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
      void get().loadOverview();
    },

    setIssueAccount(repoId, login) {
      const issueAccounts = { ...get().settings.issueAccounts };
      if (login?.trim()) issueAccounts[repoId] = login.trim();
      else delete issueAccounts[repoId];
      get().updateSettings({ issueAccounts });
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
          void get().loadOverview();
        },
        () => {},
      );
    },

    async loadBaseDiff() {
      const a = at();
      const { base } = get();
      if (!a) return;
      if (!base) return set({ baseError: "No base branch found (looked for development, main, master and the default branch of origin). Pick one with Base." });
      const shown = whileShown();
      try {
        const baseDiff = await api.branchChanges(a, base, currentRev());
        if (shown() && get().base === base) set({ baseDiff, baseError: null });
      } catch (e) {
        if (shown()) set({ baseError: errorText(e) });
      }
    },

    async loadMoreCommits() {
      const a = at();
      const { commits, commitsDone, settings } = get();
      if (!a || commitsDone) return;
      const size = settings.historyPageSize;
      const shown = whileShown();
      try {
        const page = await api.log(a, currentRev(), commits.length, size);
        if (shown()) set({ commits: [...commits, ...page], commitsDone: page.length < size, commitsError: null });
      } catch (e) {
        if (shown()) set({ commitsError: errorText(e), commitsDone: true });
      }
    },

    async selectCommit(sha) {
      const a = at();
      if (!a) return;
      const shown = whileShown();
      try {
        const selectedCommit = await api.commit(a, sha);
        if (shown()) set({ selectedCommit });
      } catch (e) {
        if (shown()) set({ commitsError: errorText(e) });
      }
    },

    async showCommit(sha) {
      showLeftTab("history");
      await get().selectCommit(sha);
    },

    async openFileHistory(path, rev) {
      set({ fileHistory: { path, rev: rev ?? currentRev(), entries: [], done: false, error: null } });
      showLeftTab("history");
      await get().loadMoreFileHistory();
    },

    async loadMoreFileHistory() {
      const a = at();
      const fh = get().fileHistory;
      if (!a || !fh || fh.done) return;
      const size = get().settings.historyPageSize;
      const shown = whileShown();
      const still = () => shown() && get().fileHistory?.path === fh.path && get().fileHistory?.rev === fh.rev;
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
      const shown = whileShown();
      const still = () => shown() && get().historyQuery.trim() === q;
      try {
        const r = await api.searchLog(a, currentRev(), q, SEARCH_LIMIT);
        if (still()) set({ historyMatches: { query: q, ...r, error: null } });
      } catch (e) {
        if (still()) set({ historyMatches: { query: q, commits: [], truncated: false, error: errorText(e) } });
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
      const shown = whileShown();
      try {
        const list = await api.listFiles(a, rev, settings.showIgnored && !rev);
        const fileList = { files: sortPaths(list.files), ignored: sortPaths(list.ignored) };
        if (shown()) set({ fileList, fileListKey: key });
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
      const shown = whileShown();
      try {
        const branchStatus = await api.branchStatus(a, branch ?? "");
        if (shown()) set({ branchStatus: { ...branchStatus, branch: branch ?? "" } });
      } catch {
        if (shown()) set({ branchStatus: null });
      }
    },

    async runAction(kind) {
      const a = at();
      if (!a || actionOf(get()).running) return;
      const label = kind === "fetch" ? "Fetching origin" : kind === "push" ? "Pushing to origin" : "Publishing branch";
      const update = (patch: Partial<ActionState>) => set((s) => ({ actions: { ...s.actions, [a.cwd]: { ...(s.actions[a.cwd] ?? IDLE_ACTION), ...patch } } }));
      update({ running: true, label, progress: "", error: null });
      const done = { running: false, label: "", progress: "" };
      try {
        const r = await api.runAction(a, kind, get().branchStatus?.branch ?? "");
        // A fetch, or a push that never reached the remote, says nothing about an earlier refusal.
        update({ ...done, error: r.ok ? null : r.text, ...(r.rejected ? { rejected: true } : r.ok && kind !== "fetch" ? { rejected: false } : {}) });
      } catch (e) {
        update({ ...done, error: errorText(e) });
      }
      await get().refresh();
    },

    clearActionError() {
      const { cwd } = get();
      if (cwd) set((s) => ({ actions: { ...s.actions, [cwd]: { ...actionOf(s), error: null } } }));
    },

    openTab(tab, pin) {
      const { repo, cwd } = get();
      if (!repo || !cwd) return;
      placeTab({ ...tab, isPreview: !pin, repo: repo.id, cwd }, pin);
    },

    openIssue(number, title, pin) {
      const { repo, tabs } = get();
      if (!repo) return;
      // A title already known (from the loaded issue) is kept over a bare number.
      const open = tabs.find((t) => t.kind === "issue" && t.number === number);
      const tab = issueTab(repo.id, number, title);
      placeTab({ ...tab, title: title === undefined && open ? open.title : tab.title, isPreview: !pin }, pin);
    },

    setTabTitle(id, title) {
      if (get().tabs.some((t) => t.id === id && t.title !== title)) set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) }));
    },

    pinTab(id) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isPreview: false } : t)) }));
    },

    async closeTab(id) {
      const tab = get().tabs.find((t) => t.id === id);
      if (!tab) return;
      const ok = mayDiscard([docKey(tab)]);
      if (ok !== true && !(await ok)) return;
      // Read again: the tabs may have changed while the user was asked.
      const { tabs, activeTab } = get();
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const rest = tabs.filter((t) => t.id !== id);
      const nextActive = activeTab === id ? (rest[idx] ?? rest[idx - 1])?.id ?? null : activeTab;
      set({ tabs: rest, activeTab: nextActive, unsaved: forget([docKey(tabs[idx])]), ...afterClosing(rest) });
    },

    async closeTabs(ids, keep) {
      const gone = new Set(ids);
      const closing = get().tabs.filter((t) => gone.has(t.id));
      if (closing.length === 0) return;
      const ok = mayDiscard(closing.map(docKey));
      if (ok !== true && !(await ok)) return;
      const { tabs, activeTab } = get();
      const rest = tabs.filter((t) => !gone.has(t.id));
      if (rest.length === tabs.length) return;
      let nextActive = activeTab;
      if (activeTab && gone.has(activeTab)) {
        // The tab the menu was opened on, else the nearest one left of the active tab, else the first.
        const before = tabs.slice(0, tabs.findIndex((t) => t.id === activeTab)).filter((t) => !gone.has(t.id));
        nextActive = (keep && !gone.has(keep) ? keep : before.at(-1)?.id ?? rest[0]?.id) ?? null;
      }
      set({ tabs: rest, activeTab: nextActive, unsaved: forget(tabs.filter((t) => gone.has(t.id)).map(docKey)), ...afterClosing(rest) });
    },

    markUnsaved(tab, unsaved) {
      const key = docKey(tab);
      if (unsaved === key in get().unsaved) return;
      if (!unsaved) return set({ unsaved: forget([key]) });
      set((s) => ({ unsaved: { ...s.unsaved, [key]: tab.title }, tabs: s.tabs.map((t) => (t.id === tab.id && t.isPreview ? { ...t, isPreview: false } : t)) }));
    },

    activateTab(id) {
      showWork();
      set({ activeTab: id });
    },

    cycleTab(delta) {
      const { tabs, activeTab } = get();
      if (tabs.length === 0) return;
      const idx = tabs.findIndex((t) => t.id === activeTab);
      set({ activeTab: tabs[(idx + delta + tabs.length) % tabs.length].id });
    },

    setPalette(scope) {
      // Quick Open lists a worktree's files: with no repository there is nothing to go to.
      if (scope !== "files" || get().repo) set({ palette: scope });
    },

    focusSearch() {
      set((s) => ({ leftTab: "search", searchFocus: s.searchFocus + 1, listOpen: true, listPane: "worktree" }));
    },

    setSystemDark(dark) {
      set({ systemDark: dark });
    },

    setView(view) {
      set({ view, settingsOpen: false });
    },

    openSettings(section, query = "") {
      set({ settingsOpen: true, settingsSection: section ?? "appearance", ...(section ? { settingsQuery: query } : {}) });
    },

    closeSettings() {
      set({ settingsOpen: false });
    },

    async openSettingsFile() {
      const { path } = await api.settingsFile();
      const { tabs, activeTab } = get();
      const tab = settingsTab(path);
      const open = tabs.some((t) => t.id === tab.id);
      showWork();
      set({ tabs: open ? tabs.map((t) => (t.id === tab.id ? tab : t)) : tabs.toSpliced(tabs.findIndex((t) => t.id === activeTab) + 1, 0, tab), activeTab: tab.id });
    },

    setSettingsQuery(q) {
      set({ settingsQuery: q });
    },

    setNotice(n) {
      set({ notice: n });
    },

    setAppWidth(width) {
      const { appWidth } = get();
      if (width === appWidth) return;
      // Crossing a band resets the drawer: out on wide windows, tucked away on narrow ones.
      set(bandOf(width) === bandOf(appWidth) ? { appWidth: width } : { appWidth: width, listOpen: !isNarrow(width) });
    },

    toggleList() {
      set((s) => ({ listOpen: !s.listOpen }));
    },

    async reconnect(name) {
      watched = "";
      const { repo } = get();
      if (!repo || repo.kind === "local" || reconnecting) return;
      reconnecting = true;
      // Named by the connection: it may not be the current repository's.
      set({ connectionLost: name });
      try {
        while (get().repo?.id === repo.id) {
          await new Promise((done) => window.setTimeout(done, RECONNECT_MS));
          try {
            await api.openRepo(repo.id);
            set({ connectionLost: null });
            await get().refresh();
            return;
          } catch {
            // Still gone: try again.
          }
        }
        set({ connectionLost: null });
      } finally {
        reconnecting = false;
      }
    },

    loadOverview: coalesce(loadOverviewOnce),
    setOverviewSort: (overviewSort) => set({ overviewSort }),

    async openWorktreeChange(cwd, path) {
      const a = (await enterWorktree(cwd)) ? at() : null;
      if (!a) return;
      const shown = whileShown();
      const entry = get().status?.entries.find((e) => e.kind !== "ignored" && (e.path === path || e.origPath === path));
      if (entry) return get().openTab(uncommittedTab(cwd, entry), true);
      const { base, worktrees } = get();
      if (base) {
        try {
          const d = await api.branchChanges(a, base, "HEAD");
          if (!shown()) return;
          const f = d.files.find((f) => f.path === path || f.origPath === path);
          const branch = worktrees.find((w) => w.path === cwd)?.branch ?? "HEAD";
          if (f) return get().openTab(revisionTab(f, d.mergeBase, "HEAD", `${base} (${shortSha(d.mergeBase)})`, branch), true);
        } catch {
          // Open the file itself instead.
        }
      }
      if (shown()) get().openTab(fileTab(cwd, path, null), true);
    },

    async openWorktreeCommit(cwd, sha) {
      if (await enterWorktree(cwd)) await get().showCommit(sha);
    },

    noteChange({ cwd, files, paths }) {
      if (files) set((s) => ({ lastChange: { ...s.lastChange, [cwd]: Date.now() / 1000 } }));
      if (paths.length) {
        const seen = edited.get(cwd) ?? new Set<string>();
        paths.forEach((p) => seen.add(p));
        edited.set(cwd, seen);
      }
      // The current worktree refreshes as a whole, which includes the overview.
      if (cwd === get().cwd) return void get().refresh();
      window.clearTimeout(overviewTimer);
      overviewTimer = window.setTimeout(() => void get().loadOverview(), 500);
    },
  };
});

/** A repository opened this session, or why it could not be. */
export type KnownRepo = RepoInfo | { error: string };

/** The repository's name: its top folder once opened, else the saved path's last part. */
export function repoName(id: string, known: KnownRepo | undefined): string {
  return known && "name" in known ? known.name : (id.split(/[\\/]/).filter(Boolean).pop() ?? id);
}

export function useAt() {
  const repo = useStore((s) => s.repo);
  const cwd = useStore((s) => s.cwd);
  return repo && cwd ? { repo: repo.id, cwd } : null;
}

/** The issues list is on screen: the work view shows it, not covered by the overview nor folded away in the drawer. */
export function issuesOnScreen(s: Pick<State, "repo" | "view" | "listPane" | "appWidth" | "listOpen">): boolean {
  return s.repo !== null && s.view === "work" && s.listPane === "issues" && (!isNarrow(s.appWidth) || s.listOpen);
}

export function effectiveDark(s: { settings: Settings; systemDark: boolean }): boolean {
  return s.settings.theme === "dark" || (s.settings.theme === "system" && s.systemDark);
}

/** The fetch, push or publish of the worktree shown. */
export function actionOf(s: { cwd: string | null; actions: Record<string, ActionState> }): ActionState {
  return (s.cwd ? s.actions[s.cwd] : undefined) ?? IDLE_ACTION;
}

export function setActionProgress(cwd: string, line: string) {
  useStore.setState((s) => (s.actions[cwd]?.running ? { actions: { ...s.actions, [cwd]: { ...s.actions[cwd], progress: line } } } : {}));
}
