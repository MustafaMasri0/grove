// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Overview, type RepoInfo } from "./api";
import { actionOf, useStore } from "./store";
import type { TabDraft } from "./tabs";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: {
    worktrees: vi.fn(async () => []),
    worktreesOverview: vi.fn(),
    watch: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    status: vi.fn(async () => ({ branch: {}, entries: [] })),
    branches: vi.fn(async () => []),
    resolveBase: vi.fn(async () => "main"),
    branchStatus: vi.fn(async () => ({})),
    log: vi.fn(async () => []),
    commit: vi.fn(),
    runAction: vi.fn(),
    settingsFile: vi.fn(async () => ({ path: "settings.json", text: null })),
  },
}));

const overview = (overlaps: Overview["overlaps"]): Overview => ({ worktrees: [], errors: {}, overlaps });
const answer = vi.mocked(api.worktreesOverview);
const askedForOverlaps = () => answer.mock.calls.map((c) => c[3]);

/** Lets the load the store just started finish. */
const settled = () => useStore.getState().loadOverview();

describe("the possibleConflicts setting", () => {
  beforeEach(() => {
    answer.mockReset();
    answer.mockResolvedValue(overview([]));
    const settings = { ...useStore.getInitialState().settings, possibleConflicts: true };
    useStore.setState({ repo: { id: "r", root: "/r" } as RepoInfo, settings, overview: null });
  });

  it("asks the backend for overlaps only while it is on", async () => {
    await useStore.getState().loadOverview();
    useStore.getState().updateSettings({ possibleConflicts: false });
    await settled();
    expect(askedForOverlaps().at(0)).toBe(true);
    expect(askedForOverlaps().slice(1).length).toBeGreaterThan(0);
    expect(askedForOverlaps().slice(1)).not.toContain(true);
  });

  it("forgets the overlaps at once when turned off", async () => {
    answer.mockResolvedValue(overview([{ a: "x", b: "y", files: ["f"] }]));
    await useStore.getState().loadOverview();
    answer.mockResolvedValue(overview([]));
    useStore.getState().updateSettings({ possibleConflicts: false });
    expect(useStore.getState().overview).toBeNull();
    await settled();
    expect(useStore.getState().overview?.overlaps).toEqual([]);
  });

  it("shows nothing of a load that was already running when it changed", async () => {
    let finishOld = (_: Overview) => {};
    let finishNew = (_: Overview) => {};
    answer.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    answer.mockReturnValueOnce(new Promise((resolve) => (finishNew = resolve)));
    const running = useStore.getState().loadOverview();
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));

    useStore.getState().updateSettings({ possibleConflicts: false });
    finishOld(overview([{ a: "x", b: "y", files: ["f"] }]));
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    expect(useStore.getState().overview).toBeNull();

    finishNew(overview([]));
    await running;
    expect(askedForOverlaps()).toEqual([true, false]);
    expect(useStore.getState().overview?.overlaps).toEqual([]);
  });

  it("leaves the overview alone when another setting changes", async () => {
    await useStore.getState().loadOverview();
    const before = useStore.getState().overview;
    useStore.getState().updateSettings({ showIgnored: true });
    expect(useStore.getState().overview).toBe(before);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});

const REPO = { id: "r", root: "/r", name: "r", kind: "local" } as RepoInfo;
const tab = (id: string): TabDraft => ({ kind: "file", id, title: id, description: "", path: id, source: { kind: "worktree", path: id } });
const titles = () => useStore.getState().tabs.map((t) => t.title);

describe("worktrees", () => {
  beforeEach(() => {
    vi.mocked(api.worktreesOverview).mockResolvedValue(overview([]));
    vi.mocked(api.log).mockReset().mockResolvedValue([]);
    vi.mocked(api.runAction).mockReset();
    useStore.setState({ ...useStore.getInitialState(), repo: REPO, cwd: "/a" }, true);
  });

  it("each keeps its tabs, pane and viewed branch", async () => {
    const s = useStore.getState();
    s.openTab(tab("one"), true);
    s.setLeftTab("explorer");
    await s.selectBranch({ name: "other", fullRef: "refs/heads/other", kind: "remote" } as never);
    await s.selectWorktree("/b");
    expect(useStore.getState()).toMatchObject({ tabs: [], activeTab: null, leftTab: "changes", viewBranch: null });

    useStore.getState().openTab(tab("two"), true);
    await useStore.getState().selectWorktree("/a");
    expect(titles()).toEqual(["one"]);
    expect(useStore.getState()).toMatchObject({ activeTab: "one", leftTab: "explorer", viewBranch: { name: "other" } });

    await useStore.getState().selectWorktree("/b");
    expect(titles()).toEqual(["two"]);
  });

  it("share settings.json, which stays active when it was", async () => {
    useStore.getState().openTab(tab("one"), true);
    await useStore.getState().openSettingsFile();
    await useStore.getState().selectWorktree("/b");
    expect(useStore.getState().activeTab).toBe("app:settings.json");
    expect(titles()).toEqual(["settings.json"]);
    await useStore.getState().selectWorktree("/a");
    expect(titles()).toEqual(["one", "settings.json"]);
  });

  it("put a worktree's tabs back where they were among the tabs that stayed", async () => {
    await useStore.getState().openSettingsFile();
    useStore.getState().openTab(tab("one"), true);
    useStore.getState().activateTab("app:settings.json");
    useStore.getState().openTab(tab("two"), true);
    expect(titles()).toEqual(["settings.json", "two", "one"]);
    await useStore.getState().selectWorktree("/b");
    expect(titles()).toEqual(["settings.json"]);
    await useStore.getState().selectWorktree("/a");
    expect(titles()).toEqual(["settings.json", "two", "one"]);
    expect(useStore.getState().activeTab).toBe("two");
  });

  it("dropping a viewed branch needs no other worktree", async () => {
    await useStore.getState().selectBranch({ name: "other", fullRef: "refs/remotes/other", kind: "remote" } as never);
    await useStore.getState().selectWorktree("/a");
    expect(useStore.getState().viewBranch).toBeNull();
  });

  it("ignore a late answer for the worktree they left", async () => {
    let finish = (_: never[]) => {};
    vi.mocked(api.log).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const loading = useStore.getState().loadMoreCommits();
    await useStore.getState().selectWorktree("/b");
    finish([{ sha: "late" }] as never);
    await loading;
    expect(useStore.getState().commits).toEqual([]);
  });

  it("run their pushes apart, and a refusal lasts until a push succeeds", async () => {
    const ran = vi.mocked(api.runAction);
    ran.mockResolvedValueOnce({ ok: false, rejected: true, text: "! main [rejected]" });
    await useStore.getState().runAction("push");
    expect(actionOf(useStore.getState())).toMatchObject({ rejected: true, error: "! main [rejected]" });

    await useStore.getState().selectWorktree("/b");
    expect(actionOf(useStore.getState())).toMatchObject({ rejected: false, error: null });
    await useStore.getState().selectWorktree("/a");

    useStore.getState().clearActionError();
    ran.mockResolvedValueOnce({ ok: true, rejected: false, text: "" });
    await useStore.getState().runAction("fetch");
    ran.mockResolvedValueOnce({ ok: false, rejected: false, text: "fatal: no network" });
    await useStore.getState().runAction("push");
    expect(actionOf(useStore.getState())).toMatchObject({ rejected: true, error: "fatal: no network" });

    ran.mockResolvedValueOnce({ ok: true, rejected: false, text: "" });
    await useStore.getState().runAction("push");
    expect(actionOf(useStore.getState())).toMatchObject({ rejected: false, error: null, running: false });
  });

  it("a failed push that was never refused is no rejection", async () => {
    vi.mocked(api.runAction).mockResolvedValueOnce({ ok: false, rejected: false, text: "fatal: no network" });
    await useStore.getState().runAction("push");
    expect(actionOf(useStore.getState())).toMatchObject({ rejected: false, error: "fatal: no network" });
  });
});

describe("what fills the window", () => {
  beforeEach(() => useStore.setState({ ...useStore.getInitialState(), repo: REPO, cwd: "/a" }, true));

  it("starts on the overview and goes to work when a file or worktree opens", async () => {
    expect(useStore.getState().view).toBe("overview");
    useStore.getState().openTab(tab("one"), true);
    expect(useStore.getState().view).toBe("work");
    useStore.getState().setView("overview");
    await useStore.getState().selectWorktree("/a");
    expect(useStore.getState().view).toBe("work");
  });

  it("settings close when something else is opened", async () => {
    useStore.getState().openSettings();
    useStore.getState().setView("overview");
    expect(useStore.getState().settingsOpen).toBe(false);
    useStore.getState().openSettings();
    await useStore.getState().openSettingsFile();
    expect(useStore.getState()).toMatchObject({ settingsOpen: false, view: "work", activeTab: "app:settings.json" });
  });

  it("settings.json opens with no repository", async () => {
    useStore.setState({ repo: null, cwd: null });
    await useStore.getState().openSettingsFile();
    expect(titles()).toEqual(["settings.json"]);
    expect(useStore.getState().view).toBe("work");
  });

  it("closing settings.json with no repository goes back to the welcome page", async () => {
    useStore.setState({ repo: null, cwd: null });
    await useStore.getState().openSettingsFile();
    useStore.getState().closeTab("app:settings.json");
    expect(useStore.getState()).toMatchObject({ view: "overview", activeTab: null });
  });

  it("closing the last tab of a repository stays on its work view", async () => {
    useStore.setState({ repo: { id: "r" } as RepoInfo, cwd: "/a" });
    await useStore.getState().openSettingsFile();
    useStore.getState().closeTabs(["app:settings.json"]);
    expect(useStore.getState().view).toBe("work");
  });

  it("settings open at a section, unfiltered", () => {
    useStore.setState({ settingsQuery: "minimap" });
    useStore.getState().openSettings();
    expect(useStore.getState()).toMatchObject({ settingsOpen: true, settingsSection: "appearance", settingsQuery: "minimap" });
    useStore.getState().openSettings("shortcuts");
    expect(useStore.getState()).toMatchObject({ settingsSection: "shortcuts", settingsQuery: "" });
  });

  it("Quick Open needs a repository; the palette does not", () => {
    useStore.setState({ repo: null, palette: null });
    useStore.getState().setPalette("files");
    expect(useStore.getState().palette).toBeNull();
    useStore.getState().setPalette("all");
    expect(useStore.getState().palette).toBe("all");
    useStore.getState().setPalette(null);
    useStore.setState({ repo: { id: "r" } as RepoInfo });
    useStore.getState().setPalette("files");
    expect(useStore.getState().palette).toBe("files");
    useStore.getState().setPalette(null);
  });
});

describe("list drawer", () => {
  const tab: TabDraft = { kind: "file", id: "a", title: "a.ts", description: "", path: "a.ts", source: { kind: "worktree", path: "a.ts" } };

  beforeEach(() => {
    useStore.setState({ repo: { id: "r" } as RepoInfo, cwd: "/w", tabs: [], activeTab: null, appWidth: 1440, listOpen: true });
  });

  it("tucks away on crossing into a narrow band and comes back on leaving it", () => {
    useStore.getState().setAppWidth(1000);
    expect(useStore.getState().listOpen).toBe(false);
    useStore.getState().toggleList();
    useStore.getState().setAppWidth(900);
    expect(useStore.getState().listOpen).toBe(true); // Same band: left as it was.
    useStore.getState().toggleList();
    useStore.getState().setAppWidth(1200);
    expect(useStore.getState().listOpen).toBe(true);
  });

  it("closes when a file opens, only on narrow windows", () => {
    useStore.getState().openTab(tab, false);
    expect(useStore.getState().listOpen).toBe(true);
    useStore.setState({ appWidth: 1000, tabs: [] });
    useStore.getState().openTab(tab, false);
    expect(useStore.getState().listOpen).toBe(false);
  });

  it("opens for a pane", () => {
    useStore.setState({ appWidth: 1000, listOpen: false });
    useStore.getState().setLeftTab("changes");
    expect(useStore.getState().listOpen).toBe(true);
    useStore.setState({ listOpen: false });
    useStore.getState().focusSearch();
    expect(useStore.getState().listOpen).toBe(true);
  });

  it("removing the open repository goes back to the overview", () => {
    useStore.setState({ view: "work" });
    useStore.getState().removeRepo("r");
    expect(useStore.getState()).toMatchObject({ view: "overview", repo: null, overview: null });
  });
});

describe("the issues list pane", () => {
  beforeEach(() => {
    useStore.setState({ repo: { id: "r", root: "/r" } as RepoInfo, cwd: "/r", view: "overview", listPane: "worktree", leftTab: "history", settingsOpen: true });
  });

  it("opens from anywhere, on the work view", () => {
    useStore.getState().showIssues();
    expect(useStore.getState()).toMatchObject({ view: "work", listPane: "issues", settingsOpen: false, listOpen: true });
  });

  it("needs a repository", () => {
    useStore.setState({ repo: null });
    useStore.getState().showIssues();
    expect(useStore.getState().listPane).toBe("worktree");
  });

  it("gives way to the worktree panes, even the one that was already chosen", async () => {
    useStore.getState().showIssues();
    useStore.getState().setLeftTab("changes");
    expect(useStore.getState().listPane).toBe("worktree");

    useStore.getState().showIssues();
    await useStore.getState().showCommit("abc1234");
    expect(useStore.getState()).toMatchObject({ listPane: "worktree", leftTab: "history" });

    useStore.getState().showIssues();
    useStore.getState().focusSearch();
    expect(useStore.getState().listPane).toBe("worktree");
  });

  it("returns to the worktree panes when the shown worktree is picked again", async () => {
    useStore.getState().showIssues();
    await useStore.getState().selectWorktree("/r");
    expect(useStore.getState().listPane).toBe("worktree");
  });
});
