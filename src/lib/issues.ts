// The issues list's filters. They run on the loaded issues only: there is no search request.

import type { IssueError, IssueSummary, TrackerInfo } from "../api";

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

/** What the list pane says instead of the list. */
export interface IssueProblem {
  title: string;
  text: string;
}

const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Why there is no list to show: always for the errors that leave nothing to read, and for
 * any error while nothing is loaded. Null when the loaded issues can still be shown.
 * `tracker` is null when it could not be picked.
 */
export function issueProblem(e: IssueError, tracker: TrackerInfo | null, loaded: boolean): IssueProblem | null {
  const name = tracker?.name ?? "the tracker";
  const project = tracker?.project ?? "This repository";
  switch (e.kind) {
    case "noOrigin":
      return { title: "This repository has no origin remote", text: "Issues come from the GitHub repository at origin." };
    case "unsupportedHost":
      return { title: "Issues are available for github.com repositories", text: e.host ? `origin is on ${e.host}.` : "origin is a folder on this computer." };
    case "git":
      return { title: "Couldn't read origin", text: e.message };
    case "notFound":
      if (e.account) return { title: `${project} wasn't found with account ${e.account}`, text: "If it's private, pick an account that can see it." };
      if (!e.signedIn) return { title: `${project} wasn't found without a login`, text: "If it's private, run gh auth login, then refresh." };
      return { title: `${project} wasn't found`, text: "If it's private, the signed-in account can't see it." };
    case "singleSignOn":
      return { title: `${name} needs single sign-on approval`, text: "The organisation requires single sign-on, and this login isn't approved for it yet. Approve it, then refresh." };
    case "issuesDisabled":
      return { title: `Issues are turned off for ${project}`, text: `They are turned off on ${name}, which is common for forks. Grove reads issues from origin.` };
    case "unauthorized":
      return { title: `${name} didn't accept the login`, text: "Run gh auth login again, then refresh." };
  }
  if (loaded) return null;
  switch (e.kind) {
    case "rateLimited":
      return { title: `${name} rate limit reached`, text: `Resets at ${clock(e.resetsAt)}.` };
    case "paused":
      return null;
    case "network":
      return { title: `Couldn't reach ${name}`, text: e.message };
    case "unexpected":
      return { title: `${name} answered with an error`, text: `Status ${e.status}. Try again with Refresh.` };
  }
}

/** A label's badge colours from its hex: lightness fixed per theme (`--label-l`), saturation capped, so any colour reads. */
export function labelColors(hex: string | null): { color: string; background: string } | undefined {
  if (!hex) return undefined;
  const c = `oklch(from ${hex} var(--label-l) min(c, 0.1) h`;
  return { color: `${c})`, background: `${c} / 0.16)` };
}
