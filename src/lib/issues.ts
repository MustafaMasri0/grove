// The issues list's filters. They run on the loaded issues only: there is no search request.

import type { IssueSummary } from "../api";

export interface IssueFilter {
  state: "open" | "closed";
  /** Every word must be in the title, or be the issue's number (with or without `#`). */
  text: string;
  /** A label name, or null for any. */
  label: string | null;
  /** An assignee's name, or null for anyone. */
  assignee: string | null;
}

export const DEFAULT_ISSUE_FILTER: IssueFilter = { state: "open", text: "", label: null, assignee: null };

function matchesText(issue: IssueSummary, words: string[]): boolean {
  const title = issue.title.toLowerCase();
  const number = String(issue.number);
  return words.every((w) => title.includes(w) || w.replace(/^#/, "") === number);
}

export function filterIssues(issues: readonly IssueSummary[], f: IssueFilter): IssueSummary[] {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  return issues.filter(
    (i) =>
      i.state === f.state &&
      (f.label === null || i.labels.some((l) => l.name === f.label)) &&
      (f.assignee === null || i.assignees.some((p) => p.name === f.assignee)) &&
      matchesText(i, words),
  );
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** The labels of the loaded issues, for the label filter; by name. */
export function labelChoices(issues: readonly IssueSummary[]): string[] {
  return [...new Set(issues.flatMap((i) => i.labels.map((l) => l.name)))].sort(byName);
}

/** The assignees of the loaded issues, for the assignee filter; by name. */
export function assigneeChoices(issues: readonly IssueSummary[]): string[] {
  return [...new Set(issues.flatMap((i) => i.assignees.map((p) => p.name)))].sort(byName);
}
