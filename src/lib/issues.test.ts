import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../api";
import { assigneeChoices, DEFAULT_ISSUE_FILTER, filterIssues, labelChoices, type IssueFilter } from "./issues";

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
