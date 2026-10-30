import { describe, expect, it } from "vitest";
import { CHOICES, RANGES, defaultSettings, getSetting } from "./settings";
import { SECTIONS, SETTINGS, filterSettings, groupBySection, matchesQuery } from "./settingsSchema";
import { SHORTCUTS } from "./shortcuts";

const paths = (q: string) => filterSettings(SETTINGS, q).map((d) => d.path);

describe("matchesQuery", () => {
  it("matches everything for an empty or blank query", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("   ", "anything")).toBe(true);
  });

  it("ignores case and needs every word somewhere in the texts", () => {
    expect(matchesQuery("FONT size", "Font size", "Editor")).toBe(true);
    expect(matchesQuery("font editor", "Font size", "Editor")).toBe(true);
    expect(matchesQuery("font colour", "Font size", "Editor")).toBe(false);
  });
});

describe("filterSettings", () => {
  it("returns every setting for an empty query", () => {
    expect(filterSettings(SETTINGS, "")).toEqual(SETTINGS);
  });

  it("finds settings by label", () => {
    expect(paths("minimap")).toEqual(["editor.minimap"]);
    expect(paths("ligatures")).toEqual(["editor.fontLigatures"]);
  });

  it("finds settings by words in their description", () => {
    expect(paths("rendered")).toContain("mdPreview");
  });

  it("finds settings by section title", () => {
    const diff = paths("diff");
    expect(diff).toEqual(expect.arrayContaining(["diff.sideBySide", "diff.collapseUnchanged", "diff.ignoreWhitespace", "diff.inlineWhenNarrow"]));
  });

  it("finds settings by their settings.json key", () => {
    expect(paths("editor.tabSize")).toEqual(["editor.tabSize"]);
    expect(paths("historyPageSize")).toEqual(["historyPageSize"]);
  });

  it("finds settings by extra keywords", () => {
    expect(paths("dark")).toContain("theme");
    expect(paths("overlap")).toEqual(["possibleConflicts"]);
  });

  it("returns nothing when no setting matches", () => {
    expect(paths("xyzzy")).toEqual([]);
  });
});

describe("groupBySection", () => {
  it("keeps the section order and leaves out empty sections", () => {
    const groups = groupBySection(filterSettings(SETTINGS, "font"));
    expect(groups.map((g) => g.section.id)).toEqual(["appearance", "editor"]);
    expect(groups[1].settings.map((d) => d.path)).toEqual(["editor.fontFamily", "editor.fontSize", "editor.fontLigatures"]);
  });
});

describe("the settings catalogue", () => {
  it("lists each setting once, under a known section", () => {
    expect(new Set(SETTINGS.map((d) => d.path)).size).toBe(SETTINGS.length);
    const ids = new Set(SECTIONS.map((s) => s.id));
    for (const d of SETTINGS) expect(ids.has(d.section)).toBe(true);
  });

  it("offers the default value of every select among its options", () => {
    for (const d of SETTINGS) {
      if (d.control.kind === "select") expect(d.control.options.map((o) => o.value)).toContain(getSetting(defaultSettings, d.path));
    }
  });

  it("offers only valid choices", () => {
    for (const d of SETTINGS) {
      const choices = CHOICES[d.path];
      if (d.control.kind === "select" && choices) for (const o of d.control.options) expect(choices).toContain(o.value);
    }
  });

  it("gives number inputs the same range the loader clamps to", () => {
    for (const d of SETTINGS) {
      if (d.control.kind === "number") expect([d.control.min, d.control.max]).toEqual(RANGES[d.path]?.slice(0, 2));
    }
  });

  it("uses a control that fits the setting's type", () => {
    for (const d of SETTINGS) {
      const v = getSetting(defaultSettings, d.path);
      if (d.control.kind === "toggle") expect(typeof v).toBe("boolean");
      if (d.control.kind === "number") expect(typeof v).toBe("number");
      if (d.control.kind === "text") expect(typeof v).toBe("string");
    }
  });

  it("lists the Settings shortcut", () => {
    expect(SHORTCUTS.some((s) => s.keys === "Ctrl+," && /settings/i.test(s.action))).toBe(true);
  });
});
