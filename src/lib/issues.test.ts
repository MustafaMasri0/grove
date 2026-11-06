import { describe, expect, it } from "vitest";
import type { IssueSummary } from "../api";
import { assigneeChoices, DEFAULT_ISSUE_FILTER, filterIssues, issueNotice, issueProblem, issueViewProblem, limitResetsAt, labelChoices, labelColors, linkedIssue, loginInitials, splitIssueRefs, type IssueFilter } from "./issues";

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

  it("offers a way out where there is one", () => {
    expect(issueProblem({ kind: "notFound", account: "work-login", signedIn: true }, tracker, false)?.action).toEqual({ kind: "chooseAccount", label: "Choose account" });
    expect(issueProblem({ kind: "notFound", account: null, signedIn: true }, tracker, false)?.action?.kind).toBe("chooseAccount");
    // Without a login an account cannot help: the text says to sign in.
    expect(issueProblem({ kind: "notFound", account: null, signedIn: false }, tracker, false)?.action).toBeUndefined();
    expect(issueProblem({ kind: "singleSignOn", url: "https://github.com/orgs/example-org/sso" }, tracker, false)?.action).toEqual({ kind: "open", label: "Open on GitHub", url: "https://github.com/orgs/example-org/sso" });
    expect(issueProblem({ kind: "singleSignOn", url: null }, tracker, false)?.action).toBeUndefined();
  });
});

describe("limitResetsAt", () => {
  it("holds only until the reset", () => {
    expect(limitResetsAt({ kind: "rateLimited", resetsAt: 100 }, 99)).toBe(100);
    expect(limitResetsAt({ kind: "rateLimited", resetsAt: 100 }, 100)).toBeNull();
    expect(limitResetsAt({ kind: "paused", resetsAt: 100 }, 50)).toBeNull();
    expect(limitResetsAt(null, 50)).toBeNull();
  });
});

describe("issueNotice", () => {
  const tracker = { name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" };
  const list = (patch: Partial<Parameters<typeof issueNotice>[0]>) => ({ error: null, loaded: true, signedIn: true, tracker, ...patch });

  it("says nothing over a list read normally, or before one loaded", () => {
    expect(issueNotice(list({}), null, 0)).toBeNull();
    expect(issueNotice(list({ loaded: false, signedIn: false }), null, 0)).toBeNull();
    expect(issueNotice(list({ error: { kind: "paused", resetsAt: 100 } }), null, 0)).toBeNull();
  });

  it("warns of a rate limit until it resets, naming the account", () => {
    const limited = list({ error: { kind: "rateLimited", resetsAt: 100 } });
    expect(issueNotice(limited, "work-login", 50)).toMatchObject({ tone: "warn", title: "GitHub rate limit reached" });
    expect(issueNotice(limited, "work-login", 50)?.text).toMatch(/^for work-login\. Resets at .+\. Showing the issues already loaded\.$/);
    expect(issueNotice(limited, null, 50)?.text).toMatch(/^Resets at /);
    expect(issueNotice(limited, null, 100)).toBeNull();
  });

  it("says when the loaded issues may be out of date", () => {
    expect(issueNotice(list({ error: { kind: "network", message: "offline" } }), null, 0)).toEqual({ tone: "error", title: "Couldn't reach GitHub", text: "Showing the issues already loaded." });
    expect(issueNotice(list({ error: { kind: "unexpected", status: 502 } }), null, 0)?.text).toBe("Status 502. Showing the issues already loaded.");
  });

  it("says when public issues are read without a login", () => {
    expect(issueNotice(list({ signedIn: false }), null, 0)).toMatchObject({ tone: "neutral", text: expect.stringContaining("gh auth login") });
    // An account the GitHub CLI has no login for: the setting is what to fix.
    expect(issueNotice(list({ signedIn: false }), "work-login", 0)?.text).toMatch(/^No login found for account work-login, .*pick another account in Settings\.$/);
    // An error says more than the missing login.
    expect(issueNotice(list({ signedIn: false, error: { kind: "network", message: "x" } }), null, 0)?.tone).toBe("error");
  });
});

describe("labelColors", () => {
  it("derives both colours from the label's hex, and none without one", () => {
    expect(labelColors("#d73a4a")).toEqual({ color: "oklch(from #d73a4a var(--label-l) min(c, 0.1) h)", background: "oklch(from #d73a4a var(--label-l) min(c, 0.1) h / 0.16)" });
    expect(labelColors(null)).toBeUndefined();
  });
});

describe("issue references", () => {
  it("finds #numbers that stand alone", () => {
    expect(splitIssueRefs("See #131 and (#7), not a#12 or #x.")).toEqual(["See ", 131, " and (", 7, "), not a#12 or #x."]);
    expect(splitIssueRefs("#5")).toEqual([5]);
    expect(splitIssueRefs("nothing here")).toEqual(["nothing here"]);
  });

  it("reads links to the tracker's own issues", () => {
    const tracker = { name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" };
    expect(linkedIssue("https://github.com/example-org/example/issues/42", tracker)).toBe(42);
    expect(linkedIssue("https://github.com/example-org/example/issues/42#issuecomment-1", tracker)).toBe(42);
    expect(linkedIssue("https://github.com/example-org/other/issues/42", tracker)).toBeNull();
    expect(linkedIssue("https://github.com/example-org/example/issues/new", tracker)).toBeNull();
    expect(linkedIssue("https://github.com/example-org/example/issues/42", null)).toBeNull();
  });
});

describe("issueViewProblem", () => {
  it("names the issue when it is not found", () => {
    expect(issueViewProblem({ kind: "notFound", account: null, signedIn: true }, 9, null).title).toBe("Issue #9 wasn't found");
    expect(issueViewProblem({ kind: "paused", resetsAt: null }, 9, null).title).toBe("Issue #9 couldn't be loaded");
  });
});

describe("loginInitials", () => {
  it("takes the first and last word, or two letters of one", () => {
    expect(loginInitials("octo-cat")).toBe("OC");
    expect(loginInitials("example_user.name")).toBe("EN");
    expect(loginInitials("ada")).toBe("AD");
    expect(loginInitials("")).toBe("?");
  });
});
