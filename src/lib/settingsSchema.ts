// What the Settings page offers: each setting's label, description and control,
// grouped in sections, and the search that filters them.
import { RANGES, type SettingPath } from "./settings";

export type SectionId = "appearance" | "editor" | "diff" | "markdown" | "explorer" | "history" | "repositories" | "shortcuts";

export const SECTIONS: readonly { id: SectionId; title: string }[] = [
  { id: "appearance", title: "Appearance" },
  { id: "editor", title: "Editor" },
  { id: "diff", title: "Diff" },
  { id: "markdown", title: "Markdown" },
  { id: "explorer", title: "Explorer and lists" },
  { id: "history", title: "History" },
  { id: "repositories", title: "Repositories" },
  { id: "shortcuts", title: "Keyboard shortcuts" },
];

export type Option = { value: string | number | boolean; label: string };

export type Control =
  | { kind: "toggle" }
  | { kind: "select"; options: readonly Option[] }
  | { kind: "number"; min: number; max: number; step: number; unit?: string }
  | { kind: "text"; placeholder?: string };

export interface SettingDef {
  path: SettingPath;
  section: SectionId;
  label: string;
  description: string;
  control: Control;
  /** More words the search should find it by. */
  keywords?: string;
}

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const num = (path: SettingPath, step = 1, unit?: string): Control => {
  const [min, max] = RANGES[path]!;
  return { kind: "number", min, max, step, unit };
};

export const SETTINGS: readonly SettingDef[] = [
  {
    path: "theme",
    section: "appearance",
    label: "Theme",
    description: "Colours of the whole window.",
    keywords: "dark light colour color mode windows",
    control: {
      kind: "select",
      options: [
        { value: "system", label: "Follow Windows" },
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ],
    },
  },
  {
    path: "zoom",
    section: "appearance",
    label: "Zoom",
    description: "Scales everything in the window (Ctrl+= and Ctrl+- step through the same values).",
    keywords: "scale size",
    control: { kind: "select", options: ZOOM_STEPS.map((z) => ({ value: z, label: `${Math.round(z * 100)}%` })) },
  },
  {
    path: "uiFontSize",
    section: "appearance",
    label: "UI font size",
    description: "Text size of the panes, lists and menus, in pixels.",
    keywords: "text interface",
    control: num("uiFontSize", 1, "px"),
  },

  {
    path: "editor.fontFamily",
    section: "editor",
    label: "Font family",
    description: "Font of the file and diff views, as a CSS font list.",
    keywords: "typeface monospace consolas cascadia",
    control: { kind: "text", placeholder: "Consolas" },
  },
  { path: "editor.fontSize", section: "editor", label: "Font size", description: "Text size of the file and diff views, in pixels.", control: num("editor.fontSize", 1, "px") },
  {
    path: "editor.lineHeight",
    section: "editor",
    label: "Line height",
    description: "Height of each line in pixels; 0 picks it automatically.",
    keywords: "spacing",
    control: num("editor.lineHeight", 1, "px"),
  },
  {
    path: "editor.fontLigatures",
    section: "editor",
    label: "Font ligatures",
    description: "Joins character pairs like => and != when the font has them.",
    control: { kind: "toggle" },
  },
  {
    path: "editor.wordWrap",
    section: "editor",
    label: "Word wrap",
    description: "Wraps long lines at the edge of the view.",
    keywords: "wrapping lines",
    control: {
      kind: "select",
      options: [
        { value: "off", label: "Off" },
        { value: "on", label: "Wrap at the view width" },
      ],
    },
  },
  { path: "editor.minimap", section: "editor", label: "Minimap", description: "Shows an overview of the file at the right edge of file views.", control: { kind: "toggle" } },
  {
    path: "editor.renderWhitespace",
    section: "editor",
    label: "Render whitespace",
    description: "Draws spaces and tabs as faint dots and arrows.",
    keywords: "spaces tabs invisible",
    control: {
      kind: "select",
      options: [
        { value: "none", label: "Never" },
        { value: "boundary", label: "Except single spaces between words" },
        { value: "selection", label: "In the selection" },
        { value: "trailing", label: "Trailing only" },
        { value: "all", label: "Always" },
      ],
    },
  },
  {
    path: "editor.stickyScroll",
    section: "editor",
    label: "Sticky scroll",
    description: "Keeps the enclosing functions and blocks pinned at the top while scrolling.",
    control: { kind: "toggle" },
  },
  {
    path: "editor.tabSize",
    section: "editor",
    label: "Tab size",
    description: "How many columns a tab character takes up on screen. Files are never changed.",
    keywords: "indent indentation width",
    control: num("editor.tabSize"),
  },
  {
    path: "editor.lineNumbers",
    section: "editor",
    label: "Line numbers",
    description: "Numbers in the gutter at the left of each line.",
    keywords: "gutter",
    control: {
      kind: "select",
      options: [
        { value: "on", label: "On" },
        { value: "relative", label: "Relative to the cursor" },
        { value: "off", label: "Off" },
      ],
    },
  },

  {
    path: "diff.sideBySide",
    section: "diff",
    label: "Default layout",
    description: "How diffs are shown; the diff toolbar switches it too.",
    keywords: "inline side by side split",
    control: {
      kind: "select",
      options: [
        { value: true, label: "Side by side" },
        { value: false, label: "Inline" },
      ],
    },
  },
  {
    path: "diff.collapseUnchanged",
    section: "diff",
    label: "Collapse unchanged regions",
    description: "Folds long stretches without changes, keeping three lines of context.",
    keywords: "hide fold",
    control: { kind: "toggle" },
  },
  {
    path: "diff.ignoreWhitespace",
    section: "diff",
    label: "Ignore whitespace",
    description: "Leaves out changes that only add or remove leading or trailing whitespace.",
    keywords: "trim spaces",
    control: { kind: "toggle" },
  },
  {
    path: "diff.inlineWhenNarrow",
    section: "diff",
    label: "Inline when narrow",
    description: "Switches a side-by-side diff to inline while the view is too narrow for two columns.",
    keywords: "small width window",
    control: { kind: "toggle" },
  },

  {
    path: "imageDiff",
    section: "diff",
    label: "Compare images",
    description: "How a changed image shows its before and after; the image toolbar switches it too.",
    keywords: "picture png swipe onion skin side by side",
    control: {
      kind: "select",
      options: [
        { value: "sideBySide", label: "Side by side" },
        { value: "swipe", label: "Swipe" },
        { value: "onion", label: "Onion skin" },
      ],
    },
  },

  {
    path: "mdPreview",
    section: "markdown",
    label: "Open Markdown, HTML and SVG files",
    description: "Whether .md, .html and .svg files open rendered or as source; the file toolbar switches it too.",
    keywords: "preview readme html web page svg",
    control: {
      kind: "select",
      options: [
        { value: true, label: "Rendered" },
        { value: false, label: "As source" },
      ],
    },
  },

  {
    path: "showIgnored",
    section: "explorer",
    label: "Show ignored files",
    description: "Lists files matched by .gitignore in Explorer, dimmed.",
    keywords: "gitignore hidden",
    control: { kind: "toggle" },
  },
  {
    path: "explorerAutoReveal",
    section: "explorer",
    label: "Explorer: Reveal the active file",
    description: "When a tab becomes active, Explorer expands the file's folders, selects it and scrolls to it.",
    keywords: "auto reveal follow editor select sync",
    control: { kind: "toggle" },
  },
  {
    path: "changesView",
    section: "explorer",
    label: "Changed files",
    description: "Whether Changes and the commit pane list changed files flat or in their folders; the toggle next to the filter switches it too.",
    keywords: "tree list view folders",
    control: {
      kind: "select",
      options: [
        { value: "list", label: "As a list" },
        { value: "tree", label: "As a tree" },
      ],
    },
  },
  {
    path: "showFolderPath",
    section: "explorer",
    label: "Show folder next to file names",
    description: "Lists of changed files and search results show each file's folder after its name.",
    keywords: "directory path",
    control: { kind: "toggle" },
  },

  {
    path: "historyPageSize",
    section: "history",
    label: "Commits per page",
    description: "How many commits History loads at a time; more load when you scroll to the end.",
    keywords: "log limit",
    control: num("historyPageSize", 10),
  },
];

/** True when every word of the query appears in one of the texts (case-insensitive). */
export function matchesQuery(query: string, ...texts: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.title;

export function filterSettings(defs: readonly SettingDef[], query: string): SettingDef[] {
  return defs.filter((d) => matchesQuery(query, d.label, d.description, sectionTitle(d.section), d.path, d.keywords ?? ""));
}

export function groupBySection(defs: readonly SettingDef[]) {
  return SECTIONS.map((section) => ({ section, settings: defs.filter((d) => d.section === section.id) })).filter((g) => g.settings.length > 0);
}
