// The issues of the shown repository: loading, checking for changes, Load more, single
// issues and the list's filters. Kept in memory per repository and account for the
// session; the backend keeps the ETag and merges pages, this store holds its answers.

import { create } from "zustand";
import { api, issueError, type IssueDetail, type IssueError, type IssueListRequest, type IssueSummary, type TrackerInfo } from "./api";
import { DEFAULT_ISSUE_FILTER, type IssueFilter } from "./lib/issues";
import { issuesOnScreen, useStore } from "./store";
import type { Tab } from "./tabs";

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
  /** A refresh asked for while another request ran; it is sent when that one is done. */
  refreshQueued: boolean;
  /** The last answer was read with a login; null before the first. Without one there are no timed checks. */
  signedIn: boolean | null;
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
  refreshQueued: false,
  signedIn: null,
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
  /** The window has focus. */
  focused: boolean;

  setFocused(focused: boolean): void;
  /** Asked for by the user (refresh button, F5): loads the list, or checks it for changes; after the request running, if any. */
  refresh(): Promise<void>;
  /** The auto-refresh's check; held back by the backend when few requests are left. */
  check(): Promise<void>;
  loadMore(): Promise<void>;
  /** Loads an issue with its comments; again only with `force`. */
  loadIssue(number: number, force?: boolean): Promise<void>;
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
/** List key → its request running. */
const running = new Map<string, Promise<void>>();
/** List key → the refresh waiting for it. */
const queued = new Map<string, Promise<void>>();

export const useIssues = create<IssuesState>()((set, get) => {
  const listOf = (key: string) => get().lists[key] ?? EMPTY_ISSUE_LIST;
  const patchList = (key: string, patch: Partial<IssueList>) => set((s) => ({ lists: { ...s.lists, [key]: { ...(s.lists[key] ?? EMPTY_ISSUE_LIST), ...patch } } }));
  const patchView = (key: string, patch: Partial<IssueView>) => set((s) => ({ views: { ...s.views, [key]: { ...(s.views[key] ?? EMPTY_VIEW), ...patch } } }));

  const fetchIssue = async (t: Target, number: number) => {
    const key = issueViewKey(t.key, number);
    // A retry shows "Loading…", not the error it is retrying.
    patchView(key, { loading: true, error: null });
    let answer: Partial<IssueView>;
    try {
      answer = { detail: await api.issue(t.at, t.account, number), loading: false, error: null };
    } catch (e) {
      answer = { loading: false, error: issueError(e) };
    }
    // Its tab closed while it loaded: the view was dropped and stays dropped.
    if (key in get().views) patchView(key, answer);
  };

  /** Opened issues that the list now shows as updated are loaded again. */
  const reloadChanged = (t: Target, issues: readonly IssueSummary[]) => {
    const { views } = get();
    for (const i of issues) {
      const v = views[issueViewKey(t.key, i.number)];
      if (v?.detail && !v.loading && v.detail.issue.updatedAt !== i.updatedAt) void fetchIssue(t, i.number);
    }
  };

  const send = async (kind: IssueListRequest, t: Target) => {
    const list = listOf(t.key);
    patchList(t.key, { loading: kind });
    try {
      // Picking the tracker sends nothing, and tells "no usable origin" apart before any request.
      // Kept even when the list request fails, so its error can name the project.
      if (!list.tracker) patchList(t.key, { tracker: await api.issueTracker(t.at) });
      const out = await api.issues(t.at, t.account, kind);
      const done = { loading: null, error: null, checkedAt: Date.now(), signedIn: out.signedIn };
      if (out.kind === "unchanged") patchList(t.key, done);
      else {
        patchList(t.key, { ...done, issues: out.issues, more: out.more, loaded: true });
        reloadChanged(t, out.issues);
      }
    } catch (e) {
      patchList(t.key, { loading: null, error: issueError(e) });
    }
    // Whether there is a login decides the timed checks.
    syncTimer();
  };

  /** One request at a time per list. A refresh asked for meanwhile is sent after it, once; a check or Load more is not repeated. */
  const request = (kind: IssueListRequest, t = target()): Promise<void> => {
    if (!t) return Promise.resolve();
    const busy = running.get(t.key);
    if (busy) {
      if (kind !== "refresh" || listOf(t.key).loading === "refresh") return busy;
      let next = queued.get(t.key);
      if (!next) {
        patchList(t.key, { refreshQueued: true });
        next = busy.then(() => {
          queued.delete(t.key);
          patchList(t.key, { refreshQueued: false });
          return request("refresh", t);
        });
        queued.set(t.key, next);
      }
      return next;
    }
    const list = listOf(t.key);
    if (kind === "loadMore" && !(list.loaded && list.more)) return Promise.resolve();
    const run = send(kind, t).finally(() => running.delete(t.key));
    running.set(t.key, run);
    return run;
  };

  /** Runs only while the list is on screen, the window has focus and the setting is on. */
  const syncTimer = () => {
    const app = useStore.getState();
    const t = target();
    const want = !!t && issuesOnScreen(app) && get().focused && app.settings.issuesAutoRefresh && listOf(t.key).signedIn !== false;
    if (want && timer === undefined) timer = window.setInterval(() => void get().check(), AUTO_REFRESH_MS);
    if (!want && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  /** The shown list is loaded when it never was (or its first load failed). */
  const ensureLoaded = () => {
    const t = target();
    if (t && issuesOnScreen(useStore.getState()) && !listOf(t.key).loaded) void get().refresh();
  };

  // The list came on screen or went, another repository or account, the setting turned over: the timer and the list follow.
  useStore.subscribe((s, prev) => {
    const onScreen = issuesOnScreen(s);
    const cameOn = onScreen && !issuesOnScreen(prev);
    const accountChanged = s.repo && accountOf(s.settings.issueAccounts, s.repo.id) !== accountOf(prev.settings.issueAccounts, s.repo.id);
    const otherList = s.repo?.id !== prev.repo?.id || accountChanged;
    if (onScreen !== issuesOnScreen(prev) || s.settings.issuesAutoRefresh !== prev.settings.issuesAutoRefresh || otherList) syncTimer();
    if (cameOn || otherList) ensureLoaded();
    if (s.tabs !== prev.tabs) dropClosed(s.tabs, s.settings.issueAccounts);
  });

  /** An issue's comments are kept only while its tab is open. */
  const dropClosed = (tabs: readonly Tab[], accounts: Record<string, string>) => {
    const open = new Set(tabs.flatMap((t) => (t.kind === "issue" ? [issueViewKey(issueListKey(t.repo, accountOf(accounts, t.repo)), t.number)] : [])));
    const { views } = get();
    if (Object.keys(views).every((k) => open.has(k))) return;
    set({ views: Object.fromEntries(Object.entries(views).filter(([k]) => open.has(k))) });
  };

  return {
    lists: {},
    views: {},
    focused: typeof document !== "undefined" && document.hasFocus(),

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
