// The keyboard shortcuts, for the reference list on the Settings page.
// They are handled in App.tsx (app-wide), ListView.tsx (lists) and by Monaco.

export interface Shortcut {
  keys: string;
  action: string;
  where: "App" | "Lists" | "Editor" | "Tabs";
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: "Ctrl+P", action: "Quick open a file", where: "App" },
  { keys: "Ctrl+Shift+F", action: "Search in files", where: "App" },
  { keys: "Ctrl+1", action: "Show Changes", where: "App" },
  { keys: "Ctrl+2", action: "Show History", where: "App" },
  { keys: "Ctrl+3", action: "Show Explorer", where: "App" },
  { keys: "Ctrl+,", action: "Open Settings", where: "App" },
  { keys: "F5 / Ctrl+R", action: "Refresh", where: "App" },
  { keys: "Ctrl+= / Ctrl+-", action: "Zoom in / out", where: "App" },
  { keys: "Ctrl+0", action: "Reset zoom", where: "App" },
  { keys: "Ctrl+W", action: "Close the tab", where: "Tabs" },
  { keys: "Ctrl+Tab / Ctrl+Shift+Tab", action: "Next / previous tab", where: "Tabs" },
  { keys: "Double click", action: "Keep a preview tab open", where: "Tabs" },
  { keys: "Middle click", action: "Close a tab", where: "Tabs" },
  { keys: "Ctrl+F", action: "Find in the file", where: "Editor" },
  { keys: "Ctrl+G", action: "Go to line", where: "Editor" },
  { keys: "F7 / Shift+F7", action: "Next / previous change in a diff", where: "Editor" },
  { keys: "Ctrl+C", action: "Copy the selection", where: "Editor" },
  { keys: "Up / Down", action: "Move and preview", where: "Lists" },
  { keys: "Page Up / Page Down, Home / End", action: "Move by a page, to the first / last", where: "Lists" },
  { keys: "Enter", action: "Open and keep the tab", where: "Lists" },
  { keys: "Left / Right", action: "Collapse / expand a folder", where: "Lists" },
  { keys: "Right-click / Shift+F10 / Menu key", action: "Context menu (copy path, reveal, close tabs, …)", where: "Lists" },
];
