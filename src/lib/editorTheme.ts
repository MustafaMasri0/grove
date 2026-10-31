// Monaco's colours, from the design tokens. Monaco cannot read CSS variables, so a theme is built
// from the tokens' resolved values whenever the app's theme changes; tokens.css stays the one source.

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A token's value: #rgb, #rrggbb, or rgb()/rgba() with commas or spaces. */
export function parseColour(text: string): Rgba {
  const t = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t)?.[1];
  if (hex) {
    const six = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return { r: parseInt(six.slice(0, 2), 16), g: parseInt(six.slice(2, 4), 16), b: parseInt(six.slice(4, 6), 16), a: 1 };
  }
  const n = /^rgba?\(/i.test(t) ? t.match(/[\d.]+%?/g)?.map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : Number(v))) : undefined;
  if (!n || n.length < 3) throw new Error(`Not a colour: ${text}`);
  return { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 };
}

const hexOf = ({ r, g, b, a }: Rgba) => {
  const two = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${two(r)}${two(g)}${two(b)}${a < 1 ? two(a * 255) : ""}`;
};

/** A translucent colour as it looks on `under`. */
const over = (c: Rgba, under: Rgba): Rgba => ({ r: c.r * c.a + under.r * (1 - c.a), g: c.g * c.a + under.g * (1 - c.a), b: c.b * c.a + under.b * (1 - c.a), a: 1 });

const luminance = ({ r, g, b }: Rgba) => {
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** The WCAG contrast of two opaque colours. */
export function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const CLEAR = "#00000000";

export interface EditorTheme {
  base: "vs" | "vs-dark";
  inherit: false;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

/** `token` reads one design token's value. */
export function editorTheme(token: (name: string) => string, dark: boolean): EditorTheme {
  const c = (name: string) => hexOf(parseColour(token(`--${name}`)));
  const sheet = parseColour(token("--sheet"));
  /** Opaque, as on the page: token rules take no alpha, and a sticky row must hide the code under it. */
  const solid = (name: string) => hexOf(over(parseColour(token(`--${name}`)), sheet));
  const ink = solid("ink");
  const keyword = solid("tok-key");
  const text = solid("tok-str");
  const quiet = solid("tok-com");
  const strong = solid("tok-fn");

  const syntax: [string, string][] = [
    ["comment", quiet],
    ["annotation", quiet],
    ["metatag", quiet],
    ["keyword", keyword],
    ["key", keyword],
    ["tag", keyword],
    ["constant", keyword],
    ["string.key.json", keyword],
    ["string", text],
    ["regexp", text],
    ["attribute.value", text],
    ["number", strong],
    ["type", strong],
    ["attribute.name", strong],
    ["variable.predefined", strong],
    ["delimiter", ink],
    ["variable", ink],
    ["identifier", ink],
    ["invalid", solid("err")],
  ];

  const colors: Record<string, string> = {
    "editor.background": c("sheet"),
    "editor.foreground": ink,
    foreground: ink,
    descriptionForeground: c("muted"),
    errorForeground: c("err"),
    focusBorder: c("focus"),
    "icon.foreground": c("icon"),
    "selection.background": c("focus-soft"),

    // The text
    "editorCursor.foreground": c("title"),
    "editor.selectionBackground": c("focus-soft"),
    "editor.inactiveSelectionBackground": c("fill"),
    "editor.selectionHighlightBackground": c("fill"),
    "editor.wordHighlightBackground": c("fill"),
    "editor.wordHighlightStrongBackground": c("fill"),
    "editor.wordHighlightTextBackground": c("fill"),
    "editor.lineHighlightBackground": c("wash"),
    "editor.lineHighlightBorder": CLEAR,
    "editor.rangeHighlightBackground": c("wash"),
    "editor.hoverHighlightBackground": c("wash"),
    "editor.findMatchBackground": c("warn-line"),
    "editor.findMatchHighlightBackground": c("warn-bg"),
    "editor.findRangeHighlightBackground": c("wash"),
    "editorBracketMatch.background": c("fill"),
    "editorBracketMatch.border": c("line-strong"),
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`editorBracketHighlight.foreground${n}`, ink])),
    "editorBracketHighlight.unexpectedBracket.foreground": c("err"),
    "editorIndentGuide.background1": c("line"),
    "editorIndentGuide.activeBackground1": c("line-strong"),
    "editorWhitespace.foreground": c("faint"),
    "editorRuler.foreground": c("line"),
    "editorLink.activeForeground": c("link"),
    "editorError.foreground": c("err"),
    "editorWarning.foreground": c("warn"),
    "editorInfo.foreground": c("changes"),

    // The gutter, which also carries the blame margin
    "editorGutter.background": c("sheet"),
    "editorLineNumber.foreground": c("muted"),
    "editorLineNumber.activeForeground": c("ink"),

    // Diffs
    "diffEditor.insertedLineBackground": c("diff-add"),
    "diffEditor.removedLineBackground": c("diff-del"),
    "diffEditor.insertedTextBackground": c("diff-add-word"),
    "diffEditor.removedTextBackground": c("diff-del-word"),
    "diffEditorGutter.insertedLineBackground": c("diff-add"),
    "diffEditorGutter.removedLineBackground": c("diff-del"),
    "diffEditorOverview.insertedForeground": c("diff-add-mark"),
    "diffEditorOverview.removedForeground": c("diff-del-mark"),
    "diffEditor.border": c("line"),
    "diffEditor.diagonalFill": c("hatch"),
    "diffEditor.unchangedRegionBackground": solid("fill"),
    "diffEditor.unchangedRegionForeground": c("muted"),
    "diffEditor.unchangedCodeBackground": CLEAR,
    "diffEditor.unchangedRegionShadow": CLEAR,
    "diffEditor.move.border": c("line-strong"),
    "diffEditor.moveActive.border": c("focus"),

    // Sticky scroll
    "editorStickyScroll.background": c("sheet"),
    "editorStickyScrollGutter.background": c("sheet"),
    "editorStickyScrollHover.background": solid("wash"),
    "editorStickyScroll.border": c("line-strong"),
    "editorStickyScroll.shadow": CLEAR,

    // Minimap
    "minimap.background": c("sheet"),
    "minimap.selectionHighlight": c("focus-soft"),
    "minimap.selectionOccurrenceHighlight": c("fill"),
    "minimap.findMatchHighlight": c("warn"),
    "minimap.errorHighlight": c("err"),
    "minimap.warningHighlight": c("warn"),
    "minimap.infoHighlight": c("changes"),
    "minimapSlider.background": c("wash"),
    "minimapSlider.hoverBackground": c("fill"),
    "minimapSlider.activeBackground": c("press"),

    // Overview ruler and scrollbars
    "editorOverviewRuler.background": c("sheet"),
    "editorOverviewRuler.border": c("line"),
    "editorOverviewRuler.findMatchForeground": c("warn"),
    "editorOverviewRuler.selectionHighlightForeground": c("faint"),
    "editorOverviewRuler.rangeHighlightForeground": c("faint"),
    "editorOverviewRuler.wordHighlightForeground": c("faint"),
    "editorOverviewRuler.wordHighlightStrongForeground": c("faint"),
    "editorOverviewRuler.wordHighlightTextForeground": c("faint"),
    "editorOverviewRuler.bracketMatchForeground": c("faint"),
    "editorOverviewRuler.errorForeground": c("err"),
    "editorOverviewRuler.warningForeground": c("warn"),
    "editorOverviewRuler.infoForeground": c("changes"),
    "scrollbar.shadow": CLEAR,
    "scrollbarSlider.background": c("line-strong"),
    "scrollbarSlider.hoverBackground": c("faint"),
    "scrollbarSlider.activeBackground": c("edge"),

    // Monaco's own widgets: find, go to line, its context menu, hovers
    "widget.shadow": CLEAR,
    "widget.border": c("line-strong"),
    "editorWidget.background": c("card"),
    "editorWidget.foreground": ink,
    "editorWidget.border": c("line-strong"),
    "editorWidget.resizeBorder": c("line-strong"),
    "editorHoverWidget.background": c("card"),
    "editorHoverWidget.foreground": ink,
    "editorHoverWidget.border": c("line-strong"),
    "input.background": c("well"),
    "input.foreground": ink,
    "input.border": c("line-strong"),
    "input.placeholderForeground": c("muted"),
    "inputOption.activeBackground": c("changes-bg"),
    "inputOption.activeForeground": c("changes"),
    "inputOption.activeBorder": CLEAR,
    "inputOption.hoverBackground": c("wash"),
    "toolbar.hoverBackground": c("wash"),
    "toolbar.activeBackground": c("press"),
    "menu.background": c("card"),
    "menu.foreground": ink,
    "menu.selectionBackground": c("fill"),
    "menu.selectionForeground": c("title"),
    "menu.separatorBackground": c("line-strong"),
    "menu.border": c("line-strong"),
    "quickInput.background": c("card"),
    "quickInput.foreground": ink,
    "quickInputTitle.background": c("card"),
    "pickerGroup.foreground": c("muted"),
    "pickerGroup.border": c("line"),
    "quickInputList.focusBackground": c("fill"),
    "quickInputList.focusForeground": c("title"),
    "list.hoverBackground": c("wash"),
    "list.activeSelectionBackground": c("fill"),
    "list.activeSelectionForeground": c("title"),
    "list.inactiveSelectionBackground": c("wash"),
    "list.focusBackground": c("fill"),
    "list.highlightForeground": c("link"),
    "textLink.foreground": c("link"),
    "textLink.activeForeground": c("link"),
    "sash.hoverBorder": c("line-strong"),
  };

  return {
    base: dark ? "vs-dark" : "vs",
    inherit: false,
    rules: [
      { token: "", foreground: ink.slice(1) },
      ...syntax.map(([t, colour]) => ({ token: t, foreground: colour.slice(1) })),
      { token: "emphasis", fontStyle: "italic" },
      { token: "strong", fontStyle: "bold" },
    ],
    colors,
  };
}
