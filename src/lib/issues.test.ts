import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../api";
import { assigneeChoices, DEFAULT_ISSUE_FILTER, filterIssues, issueProblem, labelChoices, labelColors, type IssueFilter } from "./issues";

const issue = (number: number, title: string, extra: Partial<IssueSummary> = {}): IssueSummary => ({
  number,
  title,
  state: "open",
  labels: [],
  author: null,
  assignees: [],
  commentCount: 0,
  updatedAt: "2026-11-01T10:00:00Z",
  ...extra,
});

const person = (name: string) => ({ name, avatarUrl: null });
const label = (name: string) => ({ name, color: null });

const issues = [
  issue(12, "Crash when opening an empty folder", { labels: [label("bug")], assignees: [person("octo-cat")] }),
  issue(9, "Document the settings file", { state: "closed", labels: [label("docs")] }),
  issue(7, "Folder icons look blurry", { labels: [label("bug"), label("UI")], assignees: [person("example-user")] }),
];

const numbers = (f: Partial<IssueFilter>) => filterIssues(issues, { ...DEFAULT_ISSUE_FILTER, ...f }).map((i) => i.number);

describe("filterIssues", () => {
  it("shows open issues by default, and closed ones on request", () => {
    expect(numbers({})).toEqual([12, 7]);
    expect(numbers({ state: "closed" })).toEqual([9]);
  });

  it("needs every word in the title, in any case", () => {
    expect(numbers({ text: "FOLDER" })).toEqual([12, 7]);
    expect(numbers({ text: "folder  crash" })).toEqual([12]);
    expect(numbers({ text: "folder nothing" })).toEqual([]);
  });

  it("finds an issue by its number, with or without #", () => {
    expect(numbers({ text: "#7" })).toEqual([7]);
    expect(numbers({ text: "12" })).toEqual([12]);
    expect(numbers({ text: "1" })).toEqual([]);
  });

  it("filters by label and by assignee", () => {
    expect(numbers({ label: "bug" })).toEqual([12, 7]);
    expect(numbers({ label: "bug", assignee: "example-user" })).toEqual([7]);
    expect(numbers({ label: "docs" })).toEqual([]);
    expect(numbers({ label: "docs", state: "closed" })).toEqual([9]);
  });
});

describe("filter choices", () => {
  it("lists each label and assignee of the loaded issues once, by name", () => {
    expect(labelChoices(issues)).toEqual(["bug", "docs", "UI"]);
    expect(assigneeChoices(issues)).toEqual(["example-user", "octo-cat"]);
    expect(labelChoices([])).toEqual([]);
  });
});

describe("issueProblem", () => {
  const tracker = { name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" };

  it("always blocks the list for errors that leave nothing to read", () => {
    expect(issueProblem({ kind: "issuesDisabled" }, tracker, true)?.title).toBe("Issues are turned off for example-org/example");
    expect(issueProblem({ kind: "notFound", account: "work-login", signedIn: true }, tracker, true)?.title).toBe("example-org/example wasn't found with account work-login");
    expect(issueProblem({ kind: "notFound", account: null, signedIn: false }, tracker, false)?.text).toContain("gh auth login");
    expect(issueProblem({ kind: "unsupportedHost", host: "gitlab.example" }, null, false)?.text).toBe("origin is on gitlab.example.");
    expect(issueProblem({ kind: "unsupportedHost", host: "" }, null, false)?.text).toBe("origin is a folder on this computer.");
  });

  it("keeps loaded issues on screen through limits and network trouble", () => {
    for (const e of [{ kind: "rateLimited", resetsAt: 1 }, { kind: "network", message: "offline" }, { kind: "paused", resetsAt: null }] as const) {
      expect(issueProblem(e, tracker, true)).toBeNull();
    }
    expect(issueProblem({ kind: "network", message: "offline" }, tracker, false)).toEqual({ title: "Couldn't reach GitHub", text: "offline" });
    // A held-back check before anything loaded is not a problem: the user's own load follows.
    expect(issueProblem({ kind: "paused", resetsAt: null }, tracker, false)).toBeNull();
  });
});

describe("labelColors", () => {
  it("derives both colours from the label's hex, and none without one", () => {
    expect(labelColors("#d73a4a")).toEqual({ color: "oklch(from #d73a4a var(--label-l) min(c, 0.1) h)", background: "oklch(from #d73a4a var(--label-l) min(c, 0.1) h / 0.16)" });
    expect(labelColors(null)).toBeUndefined();
  });
});
