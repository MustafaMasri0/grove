// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type IssueSummary, type RepoInfo } from "../api";
import { issueListKey, useIssues } from "../issuesStore";
import { useStore } from "../store";
import { IssuesPane } from "./IssuesPane";

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: {
    saveSettings: vi.fn(async () => {}),
    issueTracker: vi.fn(async () => ({ name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" })),
    issues: vi.fn(),
    issue: vi.fn(),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = (number: number): IssueSummary => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  labels: [],
  author: null,
  assignees: [],
  commentCount: 0,
  updatedAt: "2026-11-01T10:00:00Z",
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.mocked(api.issues).mockResolvedValue({ kind: "issues", issues: [summary(2), summary(1)], more: false });
  useStore.setState({ repo: { id: "r", root: "/r" } as RepoInfo, cwd: "/r", tabs: [], activeTab: null, issuesFocus: false });
  useIssues.setState(useIssues.getInitialState());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = async () => {
  await act(async () => root.render(<IssuesPane />));
  await vi.waitFor(() => expect(useIssues.getState().lists[issueListKey("r", null)]?.loaded).toBe(true));
  await act(async () => {});
};

describe("IssuesPane", () => {
  it("takes the keyboard when asked before the issues arrived (Ctrl+I on a first load)", async () => {
    useStore.getState().showIssues(true);
    await render();
    expect(document.activeElement?.classList.contains("lbox")).toBe(true);
    expect(useStore.getState().issuesFocus).toBe(false);
  });

  it("leaves the keyboard alone when opened by a click", async () => {
    useStore.getState().showIssues();
    await render();
    expect(document.activeElement?.classList.contains("lbox")).toBe(false);
  });

  it("opens the chosen issue as a tab, and marks its row", async () => {
    await render();
    act(() => useStore.getState().openIssue(1, "Issue 1", true));
    expect(useStore.getState().tabs.map((t) => t.title)).toEqual(["#1 Issue 1"]);
    expect(host.querySelector(".row.on")?.textContent).toContain("Issue 1");
  });
});
