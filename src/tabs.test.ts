import { describe, expect, it } from "vitest";
import { commitFileTab, docKey, fileTab, isAppTab, isDocumentTab, isWorktreeFile, issueTab, parkTabs, revealPathOf, settingsTab, tabsToClose, uncommittedTab, unparkTabs, type Tab, type TabDraft } from "./tabs";

const tabs = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("tabsToClose", () => {
  it("closes the tab itself", () => {
    expect(tabsToClose(tabs, "b", "this")).toEqual(["b"]);
  });

  it("closes every other tab", () => {
    expect(tabsToClose(tabs, "b", "others")).toEqual(["a", "c", "d"]);
  });

  it("closes the tabs after it", () => {
    expect(tabsToClose(tabs, "b", "right")).toEqual(["c", "d"]);
    expect(tabsToClose(tabs, "d", "right")).toEqual([]);
  });

  it("closes all tabs", () => {
    expect(tabsToClose(tabs, "b", "all")).toEqual(["a", "b", "c", "d"]);
  });

  it("closes nothing for an unknown tab, except Close all", () => {
    expect(tabsToClose(tabs, "x", "others")).toEqual([]);
    expect(tabsToClose(tabs, "x", "right")).toEqual([]);
  });
});

describe("commitFileTab", () => {
  const sha = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
  const parent = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

  it("diffs the file at the commit against its old name in the parent", () => {
    const t = commitFileTab({ path: "s/b c.txt", origPath: "a.txt", kind: "renamed" }, { sha, parents: [parent] }, parent);
    expect(t).toMatchObject({
      kind: "diff",
      path: "s/b c.txt",
      origPath: "a.txt",
      left: { kind: "rev", rev: parent, path: "a.txt" },
      right: { kind: "rev", rev: sha, path: "s/b c.txt" },
      leftLabel: "b2b2b2b",
      rightLabel: "c3c3c3c",
    });
    expect(t.title).toBe("b c.txt");
    expect(t.id).toBe(`rev:${parent}..${sha}:s/b c.txt`);
  });

  it("labels the left side of a root commit as empty", () => {
    const t = commitFileTab({ path: "a.txt", origPath: null, kind: "added" }, { sha, parents: [] }, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    expect(t).toMatchObject({ left: { kind: "empty" }, leftLabel: "empty", rightLabel: "c3c3c3c" });
  });
});

describe("revealPathOf", () => {
  const cwd = "/home/user/src/example";
  const tab = (t: TabDraft, at = cwd): Tab => ({ ...t, isPreview: false, repo: "/home/user/src/example", cwd: at });

  it("is the file of a file tab, from the worktree or a revision", () => {
    expect(revealPathOf(tab(fileTab(cwd, "src/a.ts", null)), cwd)).toBe("src/a.ts");
    expect(revealPathOf(tab(fileTab(cwd, "src/a.ts", "refs/heads/main")), cwd)).toBe("src/a.ts");
  });

  it("is the file of a diff tab", () => {
    const t = uncommittedTab(cwd, { path: "lib/b.ts", origPath: "old/b.ts", kind: "renamed", staged: "R", unstaged: "." });
    expect(revealPathOf(tab(t), cwd)).toBe("lib/b.ts");
  });

  it("is nothing for Settings, for no tab and for a tab of another worktree", () => {
    expect(revealPathOf(settingsTab("C:\\x\\settings.json"), cwd)).toBeNull();
    expect(revealPathOf(null, cwd)).toBeNull();
    expect(revealPathOf(tab(fileTab(cwd, "a.ts", null), "/home/user/src/example-wt"), cwd)).toBeNull();
  });
});

describe("parking a worktree's tabs", () => {
  const cwd = "/home/user/src/example";
  const own = (path: string): Tab => ({ ...fileTab(cwd, path, null), isPreview: false, repo: cwd, cwd });
  const settings = settingsTab("C:\\x\\settings.json");
  const titles = (tabs: readonly Tab[]) => tabs.map((t) => t.title);

  it("keeps the tabs of other kinds and parks the worktree's own with their places", () => {
    const { staying, parked } = parkTabs([own("a.ts"), settings, own("b.ts")]);
    expect(titles(staying)).toEqual(["settings.json"]);
    expect(parked.map((p) => [p.tab.title, p.index])).toEqual([
      ["a.ts", 0],
      ["b.ts", 2],
    ]);
  });

  it("puts them back where they were", () => {
    const row = [own("a.ts"), settings, own("b.ts")];
    const { staying, parked } = parkTabs(row);
    expect(titles(unparkTabs(staying, parked))).toEqual(titles(row));
  });

  it("puts them at the end when the tabs that stayed were closed meanwhile", () => {
    const { parked } = parkTabs([own("a.ts"), settings, own("b.ts")]);
    expect(titles(unparkTabs([], parked))).toEqual(["a.ts", "b.ts"]);
  });
});

describe("issue tabs", () => {
  const issue = issueTab("/src/example", 12, "Crash on start");

  it("are named by number and title, or by number alone", () => {
    expect(issue).toMatchObject({ kind: "issue", id: "issue:12", title: "#12 Crash on start", number: 12 });
    expect(issueTab("/src/example", 7).title).toBe("#7");
  });

  it("stay where they are while worktrees change, and close with the repository", () => {
    const file: Tab = { ...fileTab("/wt", "a.ts", null), isPreview: false, repo: "/src/example", cwd: "/wt" };
    const { staying, parked } = parkTabs([file, issue]);
    expect(staying).toEqual([issue]);
    expect(parked.map((p) => p.tab)).toEqual([file]);
    expect(isAppTab(issue)).toBe(false);
  });

  it("are not shown by the document view", () => {
    expect(isDocumentTab(issue)).toBe(false);
    expect(isDocumentTab(settingsTab("settings.json"))).toBe(true);
  });
});

describe("documents", () => {
  const at = (cwd: string, rev: string | null): Tab => ({ ...fileTab(cwd, ".env", rev), isPreview: false, repo: "/src/example", cwd });

  it("are told apart by worktree, even for tabs with the same id", () => {
    const branchTip = (cwd: string) => at(cwd, "refs/heads/main");
    expect(branchTip("/a").id).toBe(branchTip("/b").id);
    expect(docKey(branchTip("/a"))).not.toBe(docKey(branchTip("/b")));
    expect(docKey(settingsTab("settings.json"))).toBe(docKey(settingsTab("settings.json")));
  });

  it("can be edited only as the worktree's own file", () => {
    expect(isWorktreeFile(at("/a", null))).toBe(true);
    expect(isWorktreeFile(at("/a", "HEAD"))).toBe(false);
    const diff: Tab = { ...uncommittedTab("/a", { path: ".env", origPath: null, kind: "modified", staged: ".", unstaged: "M" }), isPreview: false, repo: "/src/example", cwd: "/a" };
    expect(isWorktreeFile(diff)).toBe(false);
    expect(isWorktreeFile(settingsTab("settings.json"))).toBe(false);
  });
});
