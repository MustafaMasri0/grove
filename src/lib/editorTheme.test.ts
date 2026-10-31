import { describe, expect, it } from "vitest";
import css from "../ui/tokens.css?raw";
import { contrast, editorTheme, parseColour } from "./editorTheme";

const block = (selector: string) => css.slice(css.indexOf(selector)).split("}")[0];
const tokensOf = (selector: string) => {
  const found = new Map([...block(selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  return (name: string) => {
    const v = found.get(name);
    if (!v) throw new Error(`${selector} has no ${name}`);
    return v;
  };
};
const themes = [
  { name: "dark", read: tokensOf(':root[data-theme="dark"] .ui-root'), dark: true },
  { name: "light", read: tokensOf(':root[data-theme="light"] .ui-root'), dark: false },
];
const hex = (v: string) => parseColour(`#${v.slice(0, 6)}`);

describe("parseColour", () => {
  it("reads every form the tokens use", () => {
    expect(parseColour("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour("#0c0d0e")).toEqual({ r: 12, g: 13, b: 14, a: 1 });
    expect(parseColour("rgba(62, 194, 122, 0.12)")).toEqual({ r: 62, g: 194, b: 122, a: 0.12 });
    expect(parseColour("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });
  it("refuses anything else", () => expect(() => parseColour("var(--x)")).toThrow());
});

describe.each(themes)("the $name editor theme", ({ read, dark }) => {
  const theme = editorTheme(read, dark);
  const sheet = parseColour(read("--sheet"));

  it("comes from the tokens alone: nothing inherited from vs or vs-dark", () => {
    expect(theme.inherit).toBe(false);
    expect(theme.base).toBe(dark ? "vs-dark" : "vs");
  });
  it("sits exactly on the panes' surface", () => {
    for (const k of ["editor.background", "editorGutter.background", "minimap.background", "editorOverviewRuler.background", "editorStickyScroll.background", "editorStickyScrollGutter.background"]) expect(theme.colors[k]).toBe(read("--sheet"));
  });
  it("gives Monaco only colours it can parse", () => {
    for (const [k, v] of Object.entries(theme.colors)) expect(v, k).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    for (const r of theme.rules) if (r.foreground) expect(r.foreground, r.token).toMatch(/^[0-9a-f]{6}$/);
  });
  it("keeps code readable", () => {
    for (const r of theme.rules) if (r.foreground) expect(contrast(hex(r.foreground), sheet), r.token || "text").toBeGreaterThanOrEqual(4.5);
  });
  it("covers the surfaces that vs and vs-dark would otherwise show", () => {
    for (const k of ["diffEditor.insertedLineBackground", "diffEditor.removedLineBackground", "diffEditor.diagonalFill", "editorLineNumber.foreground", "editorStickyScroll.border", "minimapSlider.background", "diffEditorOverview.insertedForeground", "editorWidget.background", "menu.background"]) expect(theme.colors[k], k).toBeTruthy();
  });
});
