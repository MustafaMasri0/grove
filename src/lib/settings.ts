// The settings shape, its defaults, and how a saved settings.json is read back.
// The backend stores the JSON as given; everything about its meaning lives here.

export type Theme = "system" | "dark" | "light";
export type ChangesMode = "uncommitted" | "base";
export type WordWrap = "off" | "on";
export type RenderWhitespace = "none" | "boundary" | "selection" | "trailing" | "all";
export type LineNumbers = "on" | "off" | "relative";
export type ImageDiff = "sideBySide" | "swipe" | "onion";
export type ChangesView = "list" | "tree";

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  /** 0 lets Monaco pick a height from the font size. */
  lineHeight: number;
  fontLigatures: boolean;
  wordWrap: WordWrap;
  /** File views only; diffs show their overview ruler instead. */
  minimap: boolean;
  renderWhitespace: RenderWhitespace;
  stickyScroll: boolean;
  /** How wide a tab character is drawn. */
  tabSize: number;
  lineNumbers: LineNumbers;
}

export interface Settings {
  repos: string[];
  lastRepo: string | null;
  /** repo id → last selected worktree path. */
  lastWorktree: Record<string, string>;
  /** repo id → chosen base branch for "Branch vs base". */
  base: Record<string, string>;
  diff: { sideBySide: boolean; collapseUnchanged: boolean; ignoreWhitespace: boolean; inlineWhenNarrow: boolean };
  theme: Theme;
  zoom: number;
  uiFontSize: number;
  leftWidth: number;
  railWidth: number;
  railCollapsed: boolean;
  changesMode: ChangesMode;
  /** Changed files (Changes and the commit pane) as a flat list or a folder tree. */
  changesView: ChangesView;
  showIgnored: boolean;
  /** Explorer selects the active tab's file, expanding its folders. */
  explorerAutoReveal: boolean;
  /** Markdown, HTML and SVG files open rendered rather than as source. */
  mdPreview: boolean;
  /** How a changed image's before and after are compared. */
  imageDiff: ImageDiff;
  /** Repositories whose HTML previews may run the page's own scripts. */
  runScripts: string[];
  commitPaneWidth: number;
  editor: EditorSettings;
  /** File lists show the folder next to each file name. */
  showFolderPath: boolean;
  historyPageSize: number;
  /** The Worktrees overview works out which files more than one worktree changes. */
  possibleConflicts: boolean;
}

export const defaultSettings: Settings = {
  repos: [],
  lastRepo: null,
  lastWorktree: {},
  base: {},
  diff: { sideBySide: true, collapseUnchanged: false, ignoreWhitespace: false, inlineWhenNarrow: false },
  theme: "system",
  zoom: 1,
  uiFontSize: 13,
  leftWidth: 340,
  railWidth: 264,
  railCollapsed: false,
  changesMode: "uncommitted",
  changesView: "list",
  showIgnored: false,
  explorerAutoReveal: true,
  mdPreview: true,
  imageDiff: "sideBySide",
  runScripts: [],
  commitPaneWidth: 340,
  editor: {
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
  },
  showFolderPath: true,
  historyPageSize: 100,
  possibleConflicts: true,
};

type Leaf = string | number | boolean | null;
type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf ? `${P}${K}` : T[K] extends unknown[] | Record<string, string> ? never : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A single preference, as "theme" or "editor.fontSize". */
export type SettingPath = Paths<Settings>;

/** Allowed choices for the settings that are one of a few strings. */
export const CHOICES: Partial<Record<SettingPath, readonly string[]>> = {
  theme: ["system", "dark", "light"],
  changesMode: ["uncommitted", "base"],
  changesView: ["list", "tree"],
  imageDiff: ["sideBySide", "swipe", "onion"],
  "editor.wordWrap": ["off", "on"],
  "editor.renderWhitespace": ["none", "boundary", "selection", "trailing", "all"],
  "editor.lineNumbers": ["on", "off", "relative"],
};

/** [min, max, whole numbers only] for numeric settings. */
export const RANGES: Partial<Record<SettingPath, readonly [number, number, boolean]>> = {
  zoom: [0.5, 2, false],
  uiFontSize: [10, 18, true],
  leftWidth: [160, 4000, true],
  railWidth: [220, 420, true],
  commitPaneWidth: [160, 4000, true],
  historyPageSize: [20, 1000, true],
  "editor.fontSize": [8, 32, true],
  "editor.lineHeight": [0, 60, true],
  "editor.tabSize": [1, 8, true],
};

/** Keys whose value is a free-form map of repo id → string. */
const STRING_MAPS = new Set(["lastWorktree", "base"]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function leaf(path: string, def: Leaf, v: unknown): Leaf {
  if (def === null) return typeof v === "string" ? v : null;
  if (typeof v !== typeof def) return def;
  const choices = CHOICES[path as SettingPath];
  if (choices && !choices.includes(v as string)) return def;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return def;
    const range = RANGES[path as SettingPath];
    if (range) {
      const [min, max, whole] = range;
      return Math.min(max, Math.max(min, whole ? Math.round(v) : v));
    }
  }
  if (typeof v === "string" && typeof def === "string" && path === "editor.fontFamily" && !v.trim()) return def;
  return v as Leaf;
}

function merge(defaults: Record<string, unknown>, saved: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(defaults)) {
    const v = saved[k];
    const path = prefix + k;
    if (Array.isArray(def)) out[k] = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [...def];
    else if (STRING_MAPS.has(path)) out[k] = isObject(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) : {};
    else if (isObject(def)) out[k] = merge(def, isObject(v) ? v : {}, `${path}.`);
    else out[k] = v === undefined ? def : leaf(path, def as Leaf, v);
  }
  return out;
}

/**
 * Reads whatever settings.json held: files from older versions miss keys, hand
 * edits may hold wrong types. Every key falls back to its default on its own.
 */
export function normalizeSettings(raw: unknown): Settings {
  return merge(defaultSettings as unknown as Record<string, unknown>, isObject(raw) ? raw : {}, "") as unknown as Settings;
}

export function getSetting(s: Settings, path: SettingPath): Leaf {
  const [a, b] = path.split(".");
  const top = (s as unknown as Record<string, unknown>)[a];
  return (b === undefined ? top : (top as Record<string, unknown>)[b]) as Leaf;
}

/** The `updateSettings` patch that sets one setting. */
export function withSetting(s: Settings, path: SettingPath, value: Leaf): Partial<Settings> {
  const [a, b] = path.split(".");
  if (b === undefined) return { [a]: value } as Partial<Settings>;
  const group = (s as unknown as Record<string, Record<string, unknown>>)[a];
  return { [a]: { ...group, [b]: value } } as Partial<Settings>;
}

export function isDefault(s: Settings, path: SettingPath): boolean {
  return getSetting(s, path) === getSetting(defaultSettings, path);
}

/** One patch that puts all the given settings back to their defaults. */
export function resetAll(s: Settings, paths: readonly SettingPath[]): Partial<Settings> {
  let cur = s;
  let patch: Partial<Settings> = {};
  for (const p of paths) {
    const step = withSetting(cur, p, getSetting(defaultSettings, p));
    cur = { ...cur, ...step };
    patch = { ...patch, ...step };
  }
  return patch;
}

/** Whether HTML previews of a repository run the page's scripts. */
export const scriptsAllowed = (s: Settings, repo: string) => s.runScripts.includes(repo);

/** The `updateSettings` patch that turns scripts in a repository's HTML previews on or off. */
export function withRunScripts(s: Settings, repo: string, on: boolean): Pick<Settings, "runScripts"> {
  const rest = s.runScripts.filter((r) => r !== repo);
  return { runScripts: on ? [...rest, repo] : rest };
}
