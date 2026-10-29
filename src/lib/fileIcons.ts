// File and folder icons from Charmed Icons (MIT, Littensy), imported by
// scripts/import-charmed-icons.py. Names resolve the way VS Code resolves an
// icon theme: file name, then the longest extension, then the language.
// Each SVG is its own file, loaded by the webview only when it is shown.
import theme from "../assets/charmed/theme.json";

type Table = Record<string, string>;
const fileNames = theme.fileNames as Table;
const fileExtensions = theme.fileExtensions as Table;
const languageIds = theme.languageIds as Table;
const folderNames = theme.folderNames as Table;
const folderNamesExpanded = theme.folderNamesExpanded as Table;

const glob = (files: Record<string, string>): Table =>
  Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".svg".length), url]));
const darkUrls = glob(import.meta.glob<string>("../assets/charmed/dark/*.svg", { query: "?url", import: "default", eager: true }));
const lightUrls = glob(import.meta.glob<string>("../assets/charmed/light/*.svg", { query: "?url", import: "default", eager: true }));

/** The icon for a file: by its name, then its longest known extension, then its language. */
export function fileIconId(path: string, languageId?: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const byName = fileNames[name];
  if (byName) return byName;
  for (let i = name.indexOf("."); i >= 0; i = name.indexOf(".", i + 1)) {
    const hit = fileExtensions[name.slice(i + 1)];
    if (hit) return hit;
  }
  return (languageId && languageIds[languageId]) || theme.file;
}

export function folderIconId(name: string, open: boolean): string {
  const key = name.toLowerCase();
  return (open ? folderNamesExpanded[key] ?? theme.folderExpanded : folderNames[key] ?? theme.folder) as string;
}

/** The URL of an icon's picture in the dark or light variant. */
export function iconUrl(id: string, dark: boolean): string {
  return (dark ? darkUrls : lightUrls)[id] ?? (dark ? darkUrls : lightUrls)[theme.file];
}
