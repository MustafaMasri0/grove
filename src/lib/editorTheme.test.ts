import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { Rollup } from "vite";
import { describe, expect, it } from "vitest";
import css from "../ui/tokens.css?raw";
import { contrast, editorTheme, parseColour } from "./editorTheme";
import { SYNTAX_ROLES } from "./grammars";

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
  { name: "dark", read: tokensOf(':root[data-theme="dark"]'), dark: true },
  { name: "light", read: tokensOf(':root[data-theme="light"]'), dark: false },
];
const hex = (v: string) => parseColour(`#${v.slice(0, 6)}`);

describe("parseColour", () => {
  it("reads every form the tokens use", () => {
    expect(parseColour("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour("#0c0d0e")).toEqual({ r: 12, g: 13, b: 14, a: 1 });
    expect(parseColour("rgba(62, 194, 122, 0.12)")).toEqual({ r: 62, g: 194, b: 122, a: 0.12 });
    expect(parseColour("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });
  it("reads the short forms the build's minifier rewrites them to", () => {
    expect(parseColour("#ffffffe6")).toEqual({ r: 255, g: 255, b: 255, a: 230 / 255 });
    expect(parseColour("#0006")).toEqual({ r: 0, g: 0, b: 0, a: 0x66 / 255 });
  });
  it("refuses anything else", () => expect(() => parseColour("var(--x)")).toThrow());
});

describe("the tokens as the release build ships them", { timeout: 60_000 }, async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const input = fileURLToPath(new URL("../ui/tokens.css", import.meta.url));
  const { output } = (await build({ root, mode: "production", logLevel: "silent", build: { write: false, rollupOptions: { input } } })) as Rollup.RollupOutput;
  const shipped = output.map((o) => (o.type === "asset" && o.fileName.endsWith(".css") ? String(o.source) : "")).join("");
  const shippedTokens = (selector: string) => {
    const blocks = shipped.split("}").filter((b) => b.split("{")[0].split(",").includes(selector));
    const found = new Map(blocks.flatMap((b) => [...b.matchAll(/(--[\w-]+):([^;]+)/g)].map((m) => [m[1], m[2]] as const)));
    return (name: string) => found.get(name) ?? "";
  };

  it.each([
    { selector: ":root[data-theme=dark]", read: tokensOf(':root[data-theme="dark"]'), dark: true },
    { selector: ":root[data-theme=light]", read: tokensOf(':root[data-theme="light"]'), dark: false },
  ])("build the same theme on $selector as the source", ({ selector, read, dark }) => {
    const [built, source] = [editorTheme(shippedTokens(selector), dark), editorTheme(read, dark)];
    // Hex keeps alpha in 8 bits, so a colour blended over the sheet can land a step or two away.
    const expectClose = (a: string, b: string, what: string) => {
      const [x, y] = [parseColour(`#${a.replace("#", "")}`), parseColour(`#${b.replace("#", "")}`)];
      for (const k of ["r", "g", "b"] as const) expect(Math.abs(x[k] - y[k]), `${what}: ${a} is not ${b}`).toBeLessThanOrEqual(2);
      expect(Math.abs(x.a - y.a), `${what}: ${a} is not ${b}`).toBeLessThanOrEqual(2 / 255);
    };
    expect(Object.keys(built.colors)).toEqual(Object.keys(source.colors));
    for (const k of Object.keys(source.colors)) expectClose(built.colors[k], source.colors[k], k);
    expect(built.rules.map((r) => r.token)).toEqual(source.rules.map((r) => r.token));
    source.rules.forEach((r, i) => r.foreground && expectClose(built.rules[i].foreground!, r.foreground, r.token || "text"));
  });
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
  it("colours every role the grammars give, each apart from the plain text", () => {
    const plain = theme.rules.find((r) => r.token === "")!.foreground;
    for (const role of SYNTAX_ROLES) {
      const rule = theme.rules.findLast((r) => r.token === role);
      expect(rule?.foreground, role).toBeTruthy();
      expect(rule?.foreground, role).not.toBe(plain);
    }
    expect(new Set(SYNTAX_ROLES.map((role) => theme.rules.find((r) => r.token === role)!.foreground)).size).toBe(SYNTAX_ROLES.length);
  });
  it("sets comments in italics", () => expect(theme.rules.findLast((r) => r.token === "comment")?.fontStyle).toBe("italic"));
  it("covers the surfaces that vs and vs-dark would otherwise show", () => {
    for (const k of ["diffEditor.insertedLineBackground", "diffEditor.removedLineBackground", "diffEditor.diagonalFill", "editorLineNumber.foreground", "editorStickyScroll.border", "minimapSlider.background", "diffEditorOverview.insertedForeground", "editorWidget.background", "menu.background"]) expect(theme.colors[k], k).toBeTruthy();
  });
});
