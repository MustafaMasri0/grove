// The issues of the shown repository: loading, checking for changes, Load more, single
// issues and the list's filters. Kept in memory per repository and account for the
// session; the backend keeps the ETag and merges pages, this store holds its answers.

import { create } from "zustand";
import { api, issueError, type IssueDetail, type IssueError, type IssueListRequest, type IssueSummary, type TrackerInfo } from "./api";
import { DEFAULT_ISSUE_FILTER, type IssueFilter } from "./lib/issues";
import { useStore } from "./store";

/** How often the shown list checks for changes while the window has focus. */
export const AUTO_REFRESH_MS = 60_000;

/** One repository's issues as read with one account. */
export interface IssueList {
  /** Known after the first request; null while there is none or it failed. */
  tracker: TrackerInfo | null;
  /** Most recently updated first. */
  issues: IssueSummary[];
  /** Older issues can be loaded. */
  more: boolean;
  /** Issues have arrived at least once. */
  loaded: boolean;
  /** The request running, one at a time. */
  loading: IssueListRequest | null;
  /** Why the last request failed; the issues loaded before it stay. */
  error: IssueError | null;
  /** When the last answer came (ms), for "checked … ago" and checks on focus. */
  checkedAt: number | null;
  filter: IssueFilter;
}

/** One issue opened from the list (or on its own). */
export interface IssueView {
  detail: IssueDetail | null;
  loading: boolean;
  error: IssueError | null;
}

export const EMPTY_ISSUE_LIST: IssueList = {
  tracker: null,
  issues: [],
  more: false,
  loaded: false,
  loading: null,
  error: null,
  checkedAt: null,
  filter: DEFAULT_ISSUE_FILTER,
};

const EMPTY_VIEW: IssueView = { detail: null, loading: false, error: null };

interface IssuesState {
  /** `issueListKey` → its list. */
  lists: Record<string, IssueList>;
  /** `issueViewKey` → that issue. */
  views: Record<string, IssueView>;
  /** The issues list is on screen. */
  shown: boolean;
  /** The window has focus. */
  focused: boolean;

  /** The list came on screen: loads it the first time and starts the auto-refresh. */
  show(): void;
  hide(): void;
  setFocused(focused: boolean): void;
  /** Asked for by the user (refresh button, F5): loads the list, or checks it for changes. */
  refresh(): Promise<void>;
  /** The auto-refresh's check; held back by the backend when few requests are left. */
  check(): Promise<void>;
  loadMore(): Promise<void>;
  /** Loads an issue with its comments; again only with `force`. */
  loadIssue(number: number, force?: boolean): Promise<void>;
  /** Drops an issue nothing shows any more. */
  forgetIssue(number: number): void;
  setFilter(patch: Partial<IssueFilter>): void;
}

/** The account setting as the backend reads it: blank is the default login. */
export const accountOf = (accounts: Record<string, string>, repo: string): string | null => accounts[repo]?.trim() || null;

export const issueListKey = (repo: string, account: string | null) => `${account ?? ""}\n${repo}`;
export const issueViewKey = (listKey: string, number: number) => `${listKey}\n${number}`;

/** Where the shown repository's issues come from, read fresh from the app store. */
interface Target {
  at: { repo: string; cwd: string };
  account: string | null;
  key: string;
}

function target(): Target | null {
  const { repo, settings } = useStore.getState();
  if (!repo) return null;
  const account = accountOf(settings.issueAccounts, repo.id);
  // Any worktree has the same origin; the root does not change with the shown worktree.
  return { at: { repo: repo.id, cwd: repo.root }, account, key: issueListKey(repo.id, account) };
}

let timer: number | undefined;

export const useIssues = create<IssuesState>()((set, get) => {
  const listOf = (key: string) => get().lists[key] ?? EMPTY_ISSUE_LIST;
  const patchList = (key: string, patch: Partial<IssueList>) => set((s) => ({ lists: { ...s.lists, [key]: { ...(s.lists[key] ?? EMPTY_ISSUE_LIST), ...patch } } }));
  const patchView = (key: string, patch: Partial<IssueView>) => set((s) => ({ views: { ...s.views, [key]: { ...(s.views[key] ?? EMPTY_VIEW), ...patch } } }));

  const fetchIssue = async (t: Target, number: number) => {
    const key = issueViewKey(t.key, number);
    patchView(key, { loading: true });
    try {
      const detail = await api.issue(t.at, t.account, number);
      patchView(key, { detail, loading: false, error: null });
    } catch (e) {
      patchView(key, { loading: false, error: issueError(e) });
    }
  };

  /** Opened issues that the list now shows as updated are loaded again. */
  const reloadChanged = (t: Target, issues: readonly IssueSummary[]) => {
    const { views } = get();
    for (const i of issues) {
      const v = views[issueViewKey(t.key, i.number)];
      if (v?.detail && !v.loading && v.detail.issue.updatedAt !== i.updatedAt) void fetchIssue(t, i.number);
    }
  };

  const request = async (kind: IssueListRequest) => {
    const t = target();
    if (!t) return;
    const list = listOf(t.key);
    if (list.loading || (kind === "loadMore" && !(list.loaded && list.more))) return;
    patchList(t.key, { loading: kind });
    try {
      // Picking the tracker sends nothing, and tells "no usable origin" apart before any request.
      const tracker = list.tracker ?? (await api.issueTracker(t.at));
      const out = await api.issues(t.at, t.account, kind);
      const done = { tracker, loading: null, error: null, checkedAt: Date.now() };
      if (out.kind === "unchanged") return patchList(t.key, done);
      patchList(t.key, { ...done, issues: out.issues, more: out.more, loaded: true });
      reloadChanged(t, out.issues);
    } catch (e) {
      patchList(t.key, { loading: null, error: issueError(e) });
    }
  };

  /** Runs only while the list is on screen, the window has focus and the setting is on. */
  const syncTimer = () => {
    const { shown, focused } = get();
    const { repo, settings } = useStore.getState();
    const want = shown && focused && repo !== null && settings.issuesAutoRefresh;
    if (want && timer === undefined) timer = window.setInterval(() => void get().check(), AUTO_REFRESH_MS);
    if (!want && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  /** The shown list is loaded when it never was (or its first load failed). */
  const ensureLoaded = () => {
    const t = target();
    if (t && get().shown && !listOf(t.key).loaded) void get().refresh();
  };

  // Another repository, another account or the setting turned over: the timer and the list follow.
  useStore.subscribe((s, prev) => {
    const accountChanged = s.repo && accountOf(s.settings.issueAccounts, s.repo.id) !== accountOf(prev.settings.issueAccounts, s.repo.id);
    if (s.repo?.id !== prev.repo?.id || accountChanged) ensureLoaded();
    if (s.repo !== prev.repo || s.settings.issuesAutoRefresh !== prev.settings.issuesAutoRefresh) syncTimer();
  });

  return {
    lists: {},
    views: {},
    shown: false,
    focused: typeof document !== "undefined" && document.hasFocus(),

    show() {
      set({ shown: true });
      syncTimer();
      ensureLoaded();
    },

    hide() {
      set({ shown: false });
      syncTimer();
    },

    setFocused(focused) {
      if (focused === get().focused) return;
      set({ focused });
      syncTimer();
      // Back after a while: check now rather than a minute later.
      const t = target();
      const checkedAt = t ? listOf(t.key).checkedAt : null;
      if (focused && timer !== undefined && checkedAt !== null && Date.now() - checkedAt >= AUTO_REFRESH_MS) void get().check();
    },

    refresh: () => request("refresh"),
    check: () => request("timedCheck"),
    loadMore: () => request("loadMore"),

    async loadIssue(number, force = false) {
      const t = target();
      if (!t) return;
      const v = get().views[issueViewKey(t.key, number)];
      if (v?.loading || (v?.detail && !force)) return;
      await fetchIssue(t, number);
    },

    forgetIssue(number) {
      const t = target();
      if (!t) return;
      const { [issueViewKey(t.key, number)]: _, ...views } = get().views;
      set({ views });
    },

    setFilter(patch) {
      const t = target();
      if (t) patchList(t.key, { filter: { ...listOf(t.key).filter, ...patch } });
    },
  };
});

/** The shown repository's issue list. */
export function useIssueList(): IssueList {
  const repo = useStore((s) => s.repo?.id ?? null);
  const account = useStore((s) => (repo ? accountOf(s.settings.issueAccounts, repo) : null));
  return useIssues((s) => (repo ? s.lists[issueListKey(repo, account)] : undefined) ?? EMPTY_ISSUE_LIST);
}

/** One issue of the shown repository. */
export function useIssueView(number: number): IssueView {
  const repo = useStore((s) => s.repo?.id ?? null);
  const account = useStore((s) => (repo ? accountOf(s.settings.issueAccounts, repo) : null));
  return useIssues((s) => (repo ? s.views[issueViewKey(issueListKey(repo, account), number)] : undefined) ?? EMPTY_VIEW);
}
