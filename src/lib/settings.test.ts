import { describe, expect, it } from "vitest";
import { defaultSettings, getSetting, isDefault, normalizeSettings, resetAll, withSetting, type SettingPath } from "./settings";

// What settings.json looked like before the Settings page existed.
const v1 = {
  repos: ["D:\\src\\a", "\\\\wsl.localhost\\Ubuntu\\home\\me\\b"],
  lastRepo: "D:\\src\\a",
  lastWorktree: { "D:\\src\\a": "D:/src/a-wt" },
  base: { "D:\\src\\a": "develop" },
  diff: { sideBySide: false, collapseUnchanged: true, ignoreWhitespace: false },
  theme: "light",
  zoom: 1.25,
  leftWidth: 400,
  changesMode: "base",
  showIgnored: true,
  mdPreview: false,
  commitPaneWidth: 300,
};

describe("normalizeSettings", () => {
  it("remembers whether changed files show as a list or a tree, falling back to a list", () => {
    expect(defaultSettings.changesView).toBe("list");
    expect(normalizeSettings({ changesView: "tree" }).changesView).toBe("tree");
    expect(normalizeSettings({ changesView: "grid" }).changesView).toBe("list");
  });

  it("reveals the active file in Explorer unless turned off", () => {
    expect(defaultSettings.explorerAutoReveal).toBe(true);
    expect(normalizeSettings({ explorerAutoReveal: false }).explorerAutoReveal).toBe(false);
    expect(normalizeSettings({ explorerAutoReveal: "no" }).explorerAutoReveal).toBe(true);
  });

  it("remembers how image diffs are compared, falling back to side by side", () => {
    expect(defaultSettings.imageDiff).toBe("sideBySide");
    expect(normalizeSettings({ imageDiff: "swipe" }).imageDiff).toBe("swipe");
    expect(normalizeSettings({ imageDiff: "onion" }).imageDiff).toBe("onion");
    expect(normalizeSettings({ imageDiff: "flip" }).imageDiff).toBe("sideBySide");
  });

  it("returns the defaults for a missing or unreadable file", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
    expect(normalizeSettings(undefined)).toEqual(defaultSettings);
    expect(normalizeSettings("garbage")).toEqual(defaultSettings);
    expect(normalizeSettings([1, 2])).toEqual(defaultSettings);
  });

  it("keeps every value of an older file and fills new keys with their defaults", () => {
    const s = normalizeSettings(v1);
    expect(s).toMatchObject(v1);
    expect(s.editor).toEqual(defaultSettings.editor);
    expect(s.uiFontSize).toBe(defaultSettings.uiFontSize);
    expect(s.historyPageSize).toBe(100);
    expect(s.showFolderPath).toBe(true);
    expect(s.diff.inlineWhenNarrow).toBe(false);
  });

  it("defaults keep today's behaviour", () => {
    expect(defaultSettings.editor).toEqual({
      fontFamily: "Consolas",
      fontSize: 13,
      lineHeight: 0,
      fontLigatures: false,
      wordWrap: "off",
      minimap: true,
      renderWhitespace: "selection",
      stickyScroll: true,
      tabSize: 4,
      lineNumbers: "on",
    });
    expect(defaultSettings.diff).toEqual({ sideBySide: true, collapseUnchanged: false, ignoreWhitespace: false, inlineWhenNarrow: false });
    expect(defaultSettings.uiFontSize).toBe(13);
  });

  it("merges partial nested objects key by key", () => {
    const s = normalizeSettings({ diff: { ignoreWhitespace: true }, editor: { fontSize: 15 } });
    expect(s.diff).toEqual({ ...defaultSettings.diff, ignoreWhitespace: true });
    expect(s.editor).toEqual({ ...defaultSettings.editor, fontSize: 15 });
  });

  it("replaces values of the wrong type with the default", () => {
    const s = normalizeSettings({ zoom: "big", showIgnored: 1, repos: "D:\\x", lastRepo: 5, diff: "yes", editor: { minimap: "no" } });
    expect(s.zoom).toBe(1);
    expect(s.showIgnored).toBe(false);
    expect(s.repos).toEqual([]);
    expect(s.lastRepo).toBeNull();
    expect(s.diff).toEqual(defaultSettings.diff);
    expect(s.editor.minimap).toBe(true);
  });

  it("rejects unknown choices", () => {
    const s = normalizeSettings({ theme: "solarized", changesMode: "all", editor: { wordWrap: "maybe", lineNumbers: "interval" } });
    expect(s.theme).toBe("system");
    expect(s.changesMode).toBe("uncommitted");
    expect(s.editor.wordWrap).toBe("off");
    expect(s.editor.lineNumbers).toBe("on");
  });

  it("clamps numbers into their range and drops NaN", () => {
    const s = normalizeSettings({ zoom: 9, uiFontSize: 2, historyPageSize: 5, editor: { fontSize: 200, tabSize: 0, lineHeight: Number.NaN } });
    expect(s.zoom).toBe(2);
    expect(s.uiFontSize).toBe(10);
    expect(s.historyPageSize).toBe(20);
    expect(s.editor.fontSize).toBe(32);
    expect(s.editor.tabSize).toBe(1);
    expect(s.editor.lineHeight).toBe(0);
  });

  it("rounds whole-number settings", () => {
    expect(normalizeSettings({ historyPageSize: 150.7, editor: { tabSize: 2.2 } })).toMatchObject({ historyPageSize: 151, editor: { tabSize: 2 } });
  });

  it("keeps only string entries in lists and per-repo maps", () => {
    const s = normalizeSettings({ repos: ["a", 3, null, "b"], base: { a: "main", b: 7 }, lastWorktree: [] });
    expect(s.repos).toEqual(["a", "b"]);
    expect(s.base).toEqual({ a: "main" });
    expect(s.lastWorktree).toEqual({});
  });

  it("falls back to the default font for an empty font family", () => {
    expect(normalizeSettings({ editor: { fontFamily: "   " } }).editor.fontFamily).toBe("Consolas");
  });

  it("drops keys it does not know", () => {
    expect(normalizeSettings({ ...v1, oldThing: 1 })).not.toHaveProperty("oldThing");
  });
});

describe("setting paths", () => {
  it("reads top-level and nested values", () => {
    expect(getSetting(defaultSettings, "theme")).toBe("system");
    expect(getSetting(defaultSettings, "editor.fontSize")).toBe(13);
    expect(getSetting(defaultSettings, "diff.sideBySide")).toBe(true);
  });

  it("builds a patch that keeps sibling values", () => {
    const s = normalizeSettings({ editor: { fontSize: 16, minimap: false } });
    expect(withSetting(s, "editor.fontSize", 18)).toEqual({ editor: { ...s.editor, fontSize: 18 } });
    expect(withSetting(s, "theme", "dark")).toEqual({ theme: "dark" });
  });

  it("tells changed settings from defaults", () => {
    const s = normalizeSettings({ editor: { fontSize: 16 }, theme: "dark" });
    expect(isDefault(s, "editor.fontSize")).toBe(false);
    expect(isDefault(s, "editor.minimap")).toBe(true);
    expect(isDefault(s, "theme")).toBe(false);
  });

  it("resets all the given settings and leaves the rest alone", () => {
    const s = normalizeSettings({ ...v1, editor: { fontSize: 16 } });
    const paths: SettingPath[] = ["theme", "editor.fontSize", "diff.sideBySide"];
    const next = { ...s, ...resetAll(s, paths) };
    expect(next.theme).toBe("system");
    expect(next.editor.fontSize).toBe(13);
    expect(next.diff).toEqual({ ...s.diff, sideBySide: true });
    expect(next.repos).toEqual(v1.repos);
    expect(next.zoom).toBe(1.25);
  });
});
