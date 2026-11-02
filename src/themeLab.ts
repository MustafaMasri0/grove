// Throwaway: compares dark palettes on the running app. Dev builds only, never merged.
// Each palette overrides the design tokens inline on <html>, so everything that reads them follows, the editors too.
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { applyEditorTheme } from "./monaco";

type Surfaces = { shell: string; sheet: string; card: string; well: string };
type Text = { title: string; ink: string; muted: string; icon: string; faint: string };
type Status = { live: string; changes: string; warn: string; err: string; add: string; del: string };
type Syntax = { key: string; str: string; com: string; fn: string; type: string; num: string; macro: string; prop: string; punct: string };
type Palette = { name: string; note: string; surfaces?: Surfaces; text?: Text; line?: number; status?: Status; syntax?: Syntax };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(", ")}, ${a})`;

/** Calmer than the current status colours: the same hues, less saturated and a little darker. */
const softStatus: Status = { live: "#5fbf8f", changes: "#8fb0e8", warn: "#dcb468", err: "#e68d84", add: "#70c79b", del: "#ea9a91" };
const softSyntax: Syntax = { key: "#bba8e8", str: "#a9cc8e", com: "#8d939c", fn: "#8ab3e8", type: "#74c4ba", num: "#dfb283", macro: "#dca3c6", prop: "#b9c4d6", punct: "#a2a6ad" };
const warmStatus: Status = { live: "#7fbf8a", changes: "#92b0d8", warn: "#e0b060", err: "#e38a76", add: "#8cc795", del: "#e89a86" };
const warmSyntax: Syntax = { key: "#c8a8d8", str: "#b5c98a", com: "#94897c", fn: "#92b4d4", type: "#88c0a8", num: "#e0ae78", macro: "#dca0a8", prop: "#c8bca8", punct: "#aaa196" };

export const PALETTES: Palette[] = [
  { name: "Carbon", note: "Current theme, for comparison" },
  {
    name: "Graphite",
    note: "Neutral grey, one step lighter, softer text",
    surfaces: { shell: "#141517", sheet: "#1a1b1e", card: "#24262a", well: "#2a2c31" },
    text: { title: "#f3f4f6", ink: "#dfe1e5", muted: "#a6a9b0", icon: "#92959d", faint: "#7a7e86" },
    line: 0.11,
    status: softStatus,
    syntax: softSyntax,
  },
  {
    name: "Dim",
    note: "Mid grey, the lowest glare of the set",
    surfaces: { shell: "#24262b", sheet: "#2b2d33", card: "#363941", well: "#3e414a" },
    text: { title: "#ffffff", ink: "#e2e4e9", muted: "#b4b8c1", icon: "#a3a7b1", faint: "#8d919c" },
    line: 0.12,
    status: softStatus,
    syntax: { ...softSyntax, com: "#989ea8" },
  },
  {
    name: "Stone",
    note: "Warm grey, paper-coloured text",
    surfaces: { shell: "#171513", sheet: "#1e1b18", card: "#292522", well: "#302c28" },
    text: { title: "#f5f0e8", ink: "#e3ddd3", muted: "#aca499", icon: "#978f85", faint: "#807970" },
    line: 0.11,
    status: warmStatus,
    syntax: warmSyntax,
  },
  {
    name: "Slate",
    note: "Cool blue-grey surfaces, neutral accents",
    surfaces: { shell: "#12161c", sheet: "#181d24", card: "#222933", well: "#29313c" },
    text: { title: "#f0f4f9", ink: "#d8dfe8", muted: "#9ca8b8", icon: "#8894a5", faint: "#748092" },
    line: 0.11,
    status: softStatus,
    syntax: softSyntax,
  },
  {
    name: "Moss",
    note: "Grey with a trace of green, for the name",
    surfaces: { shell: "#121714", sheet: "#181e1a", card: "#222a25", well: "#29322c" },
    text: { title: "#f1f6f1", ink: "#dbe3dc", muted: "#9faba2", icon: "#8b978e", faint: "#768279" },
    line: 0.11,
    status: softStatus,
    syntax: softSyntax,
  },
];

function tokens({ surfaces: s, text: t, line = 0.1, status: c, syntax: k }: Palette): Record<string, string> {
  if (!s || !t || !c || !k) return {};
  const white = "rgba(255, 255, 255,";
  return {
    "--shell": s.shell, "--sheet": s.sheet, "--card": s.card, "--raised": s.card, "--well": s.well,
    "--title": t.title, "--ink": t.ink, "--muted": t.muted, "--icon": t.icon, "--faint": t.faint,
    "--line": `${white} ${line})`, "--line-strong": `${white} ${line + 0.08})`,
    "--solid": t.title, "--solid-hover": t.ink, "--on-solid": s.shell, "--on-status": s.shell,
    "--focus": c.changes, "--focus-soft": alpha(c.changes, 0.28), "--link": c.changes,
    "--live": c.live, "--live-bg": alpha(c.live, 0.16),
    "--changes": c.changes, "--changes-bg": alpha(c.changes, 0.16),
    "--warn": c.warn, "--warn-bg": alpha(c.warn, 0.15), "--warn-line": alpha(c.warn, 0.26),
    "--err": c.err, "--err-bg": alpha(c.err, 0.15), "--err-line": alpha(c.err, 0.26),
    "--add": c.add, "--del": c.del,
    "--diff-add": alpha(c.add, 0.12), "--diff-add-word": alpha(c.add, 0.24), "--diff-add-mark": alpha(c.add, 0.75),
    "--diff-del": alpha(c.del, 0.12), "--diff-del-word": alpha(c.del, 0.24), "--diff-del-mark": alpha(c.del, 0.75),
    "--tok-key": k.key, "--tok-str": k.str, "--tok-com": k.com, "--tok-fn": k.fn, "--tok-type": k.type,
    "--tok-num": k.num, "--tok-macro": k.macro, "--tok-prop": k.prop, "--tok-punct": k.punct,
  };
}

// Contrast of a token against a background, as WCAG defines it; a translucent token is laid over the background first.
const parse = (c: string) => {
  if (c.startsWith("#")) return [...rgb(c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c), 1];
  return c.match(/[\d.]+/g)!.map(Number);
};
const luminance = (v: number[]) => {
  const [r, g, b] = v.map((x) => (x / 255 <= 0.04045 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function ratio(fg: string, bg: string) {
  const [r, g, b, a = 1] = parse(fg);
  const back = parse(bg);
  const over = [r, g, b].map((x, i) => x * a + back[i] * (1 - a));
  const [hi, lo] = [luminance(over), luminance(back)].sort((x, y) => y - x);
  return ((hi + 0.05) / (lo + 0.05)).toFixed(1);
}

const KEY = "grove-theme-lab";
const root = document.documentElement;
let current = 0;
let applied: string[] = [];

function apply(index: number) {
  current = index;
  try {
    localStorage.setItem(KEY, String(index));
  } catch {}
  applied.forEach((name) => root.style.removeProperty(name));
  const palette = PALETTES[index];
  const next = root.dataset.theme === "light" ? {} : tokens(palette);
  Object.entries(next).forEach(([name, value]) => root.style.setProperty(name, value));
  applied = Object.keys(next);
  applyEditorTheme(root.dataset.theme !== "light");
  const css = getComputedStyle(root);
  const read = (name: string) => css.getPropertyValue(name).trim();
  void getCurrentWebviewWindow().setBackgroundColor(read("--shell")).catch(() => {});
  render(palette, read);
}

const panel = document.createElement("div");
panel.setAttribute("style", "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-radius:10px;background:#000;color:#fff;font:12px 'Segoe UI',sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.25),0 10px 30px rgba(0,0,0,.6);max-width:calc(100vw - 32px)");

function render(palette: Palette, read: (name: string) => string) {
  const sheet = read("--sheet");
  const buttons = PALETTES.map((p, i) => `<button data-i="${i}" title="Alt+${i + 1}" style="all:unset;cursor:pointer;padding:4px 10px;border-radius:6px;${i === current ? "background:#fff;color:#000;" : "color:#ccc;"}">${i + 1} ${p.name}</button>`).join("");
  const facts = [["Text", "--ink"], ["Muted", "--muted"], ["Faint", "--faint"], ["Comment", "--tok-com"]].map(([label, name]) => `${label} ${ratio(read(name), sheet)}`).join(" · ");
  panel.innerHTML = `<div style="display:flex;gap:2px">${buttons}</div><div style="color:#aaa;padding:0 10px">${palette.note} — contrast on page: ${facts}</div>`;
}

panel.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
  if (button) apply(Number(button.dataset.i));
});
window.addEventListener(
  "keydown",
  (e) => {
    const index = Number(e.key) - 1;
    if (!e.altKey || !(index in PALETTES)) return;
    e.preventDefault();
    e.stopPropagation();
    apply(index);
  },
  true,
);
// The app sets data-theme and rebuilds the editor theme itself; apply again once it has.
new MutationObserver(() => apply(current)).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

document.body.append(panel);
let saved = 0;
try {
  saved = Number(localStorage.getItem(KEY)) || 0;
} catch {}
current = saved in PALETTES ? saved : 0;
const wanted = new URLSearchParams(location.search).get("lab");
if (wanted !== null) current = Number(wanted);
apply(current);
