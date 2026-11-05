// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type IssueDetail, type IssueSummary, type RepoInfo } from "./api";
import { AUTO_REFRESH_MS, issueListKey, useIssues } from "./issuesStore";
import { useStore } from "./store";
import { issueTab } from "./tabs";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: {
    saveSettings: vi.fn(async () => {}),
    issueTracker: vi.fn(async () => ({ name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" })),
    issues: vi.fn(),
    issue: vi.fn(),
  },
}));

const issues = vi.mocked(api.issues);
const issue = vi.mocked(api.issue);
const tracker = vi.mocked(api.issueTracker);

const summary = (number: number, updatedAt = "2026-11-01T10:00:00Z"): IssueSummary => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  labels: [],
  author: null,
  assignees: [],
  commentCount: 0,
  updatedAt,
});

const detail = (number: number, updatedAt = "2026-11-01T10:00:00Z"): IssueDetail => ({
  issue: { ...summary(number, updatedAt), body: "", milestone: null, createdAt: updatedAt, closedAt: null, webUrl: "" },
  comments: [],
});

const repo = (id: string) => ({ id, root: `/src/${id}` }) as RepoInfo;
const list = (repoId = "r", account: string | null = null) => useIssues.getState().lists[issueListKey(repoId, account)];
/** Lets mocked answers arrive. Not `vi.waitFor`, which moves fake timers on. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  issues.mockReset();
  issue.mockReset();
  tracker.mockClear();
  useStore.setState({ repo: repo("r"), settings: { ...useStore.getInitialState().settings, issuesAutoRefresh: true, issueAccounts: {} } });
  useIssues.setState({ ...useIssues.getInitialState(), focused: true });
});

afterEach(() => {
  useIssues.getState().hide();
  vi.useRealTimers();
});

describe("the issues list", () => {
  it("loads when first shown, from the repository root, with the default login", async () => {
    issues.mockResolvedValue({ kind: "issues", issues: [summary(2), summary(1)], more: true });
    useIssues.getState().show();
    await flush();
    expect(issues).toHaveBeenCalledWith({ repo: "r", cwd: "/src/r" }, null, "refresh");
    expect(list()).toMatchObject({ loaded: true, more: true, error: null, tracker: { name: "GitHub" } });
    expect(list().issues.map((i) => i.number)).toEqual([2, 1]);

    // Shown again: already loaded, nothing is asked.
    useIssues.getState().hide();
    useIssues.getState().show();
    expect(issues).toHaveBeenCalledTimes(1);
  });

  it("keeps the issues on unchanged, and replaces them on a changed answer", async () => {
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(1)], more: false });
    await useIssues.getState().refresh();
    issues.mockResolvedValueOnce({ kind: "unchanged" });
    await useIssues.getState().refresh();
    expect(list().issues.map((i) => i.number)).toEqual([1]);
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(3), summary(1)], more: false });
    await useIssues.getState().refresh();
    expect(list().issues.map((i) => i.number)).toEqual([3, 1]);
    // The tracker is picked once.
    expect(tracker).toHaveBeenCalledTimes(1);
  });

  it("keeps what is loaded when a request fails, and shows why", async () => {
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(1)], more: false });
    await useIssues.getState().refresh();
    issues.mockRejectedValueOnce({ kind: "rateLimited", resetsAt: 9000 });
    await useIssues.getState().refresh();
    expect(list()).toMatchObject({ loaded: true, error: { kind: "rateLimited", resetsAt: 9000 } });
    expect(list().issues).toHaveLength(1);
    // Anything that is not an IssueError is a network error.
    issues.mockRejectedValueOnce("connection reset");
    await useIssues.getState().refresh();
    expect(list().error).toEqual({ kind: "network", message: "connection reset" });
  });

  it("tells a repository without a usable origin apart before asking for issues", async () => {
    tracker.mockRejectedValueOnce({ kind: "noOrigin" });
    await useIssues.getState().refresh();
    expect(list().error).toEqual({ kind: "noOrigin" });
    expect(issues).not.toHaveBeenCalled();
  });

  it("loads more only when there is more, and one request at a time", async () => {
    await useIssues.getState().loadMore();
    expect(issues).not.toHaveBeenCalled();
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(2)], more: true });
    await useIssues.getState().refresh();
    let finish = (_: unknown) => {};
    issues.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)) as never);
    const more = useIssues.getState().loadMore();
    void useIssues.getState().refresh();
    void useIssues.getState().loadMore();
    finish({ kind: "issues", issues: [summary(2), summary(1)], more: false });
    await more;
    expect(issues.mock.calls.map((c) => c[2])).toEqual(["refresh", "loadMore"]);
    expect(list()).toMatchObject({ more: false, loading: null });
  });

  it("keeps lists apart per repository and per account", async () => {
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(1)], more: false });
    await useIssues.getState().refresh();
    useStore.getState().updateSettings({ issueAccounts: { r: " work-login " } });
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(2)], more: false });
    await useIssues.getState().refresh();
    expect(issues.mock.calls[1][1]).toBe("work-login");
    expect(list("r", "work-login").issues.map((i) => i.number)).toEqual([2]);
    expect(list("r", null).issues.map((i) => i.number)).toEqual([1]);
  });

  it("loads the next repository's list when it is shown while the list is open", async () => {
    issues.mockResolvedValue({ kind: "issues", issues: [summary(1)], more: false });
    useIssues.getState().show();
    await flush();
    useStore.setState({ repo: repo("other") });
    await flush();
    expect(list("other")?.loaded).toBe(true);
    expect(issues.mock.calls.map((c) => c[0].repo)).toEqual(["r", "other"]);
  });

  it("keeps a filter per list", async () => {
    useIssues.getState().setFilter({ label: "bug" });
    useIssues.getState().setFilter({ text: "crash" });
    expect(list().filter).toMatchObject({ state: "open", label: "bug", text: "crash" });
    useStore.setState({ repo: repo("other") });
    expect(list("other")).toBeUndefined();
  });
});

describe("auto-refresh", () => {
  beforeEach(async () => {
    issues.mockResolvedValue({ kind: "issues", issues: [summary(1)], more: false });
    useIssues.getState().show();
    await flush();
    issues.mockClear();
    issues.mockResolvedValue({ kind: "unchanged" });
  });

  const tick = async () => {
    vi.advanceTimersByTime(AUTO_REFRESH_MS);
    await flush();
  };

  it("checks every minute while shown and focused", async () => {
    await tick();
    await tick();
    expect(issues.mock.calls.map((c) => c[2])).toEqual(["timedCheck", "timedCheck"]);
  });

  it("stops when hidden, unfocused or turned off", async () => {
    useIssues.getState().hide();
    await tick();
    useIssues.getState().show();
    useIssues.getState().setFocused(false);
    await tick();
    expect(issues).not.toHaveBeenCalled();
    // Focus back on a list two minutes old: one check at once.
    useIssues.getState().setFocused(true);
    await flush();
    expect(issues).toHaveBeenCalledTimes(1);
    useStore.getState().updateSettings({ issuesAutoRefresh: false });
    await tick();
    expect(issues).toHaveBeenCalledTimes(1);
    useStore.getState().updateSettings({ issuesAutoRefresh: true });
    await tick();
    expect(issues).toHaveBeenCalledTimes(2);
  });

  it("checks at once on focus when the last answer is a minute old", async () => {
    useIssues.getState().setFocused(false);
    vi.advanceTimersByTime(AUTO_REFRESH_MS - 1);
    useIssues.getState().setFocused(true);
    expect(issues).not.toHaveBeenCalled();
    useIssues.getState().setFocused(false);
    vi.advanceTimersByTime(1);
    useIssues.getState().setFocused(true);
    await flush();
    expect(issues.mock.calls.map((c) => c[2])).toEqual(["timedCheck"]);
  });

  it("a held-back check keeps the list and says why", async () => {
    issues.mockRejectedValueOnce({ kind: "paused", resetsAt: null });
    await tick();
    expect(list()).toMatchObject({ loaded: true, error: { kind: "paused", resetsAt: null } });
    expect(list().issues).toHaveLength(1);
  });
});

describe("single issues", () => {
  it("loads once, again only when forced or when the list shows it updated", async () => {
    issue.mockResolvedValue(detail(5));
    await useIssues.getState().loadIssue(5);
    await useIssues.getState().loadIssue(5);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith({ repo: "r", cwd: "/src/r" }, null, 5);
    await useIssues.getState().loadIssue(5, true);
    expect(issue).toHaveBeenCalledTimes(2);

    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(5)], more: false });
    await useIssues.getState().refresh();
    expect(issue).toHaveBeenCalledTimes(2);
    issue.mockResolvedValue(detail(5, "2026-11-05T10:00:00Z"));
    issues.mockResolvedValueOnce({ kind: "issues", issues: [summary(5, "2026-11-05T10:00:00Z")], more: false });
    await useIssues.getState().refresh();
    await flush();
    expect(issue).toHaveBeenCalledTimes(3);
  });

  it("keeps an error per issue", async () => {
    issue.mockRejectedValueOnce({ kind: "notFound", account: null, signedIn: true });
    await useIssues.getState().loadIssue(8);
    expect(useIssues.getState().views[`${issueListKey("r", null)}\n8`]).toMatchObject({ detail: null, loading: false, error: { kind: "notFound" } });
  });

  it("keeps an issue only while its tab is open", async () => {
    issue.mockImplementation(async (_, __, n) => detail(n));
    useStore.setState({ tabs: [issueTab("r", 4), issueTab("r", 5)] });
    await useIssues.getState().loadIssue(4);
    await useIssues.getState().loadIssue(5);
    useStore.getState().closeTab(issueTab("r", 4).id);
    expect(Object.keys(useIssues.getState().views)).toEqual([`${issueListKey("r", null)}\n5`]);
  });
});
