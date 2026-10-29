import { describe, expect, it } from "vitest";
import { commitFileTab, tabsToClose } from "./tabs";

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
    expect(t.spec).toEqual({
      type: "diff",
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
    expect(t.spec).toMatchObject({ left: { kind: "empty" }, leftLabel: "empty", rightLabel: "c3c3c3c" });
  });
});
