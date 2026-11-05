// What Ctrl+K searches: the commands, the worktrees, and with a query what every worktree has changed.
import type { ChangedFile, WorktreeSummary } from "../api";
import type { RailRow } from "./rail";
import type { SectionId } from "./settingsSchema";

/** Ctrl+K searches everything; Ctrl+P is Quick Open, the files of the current worktree. */
export type PaletteScope = "all" | "files";

export const PALETTE_LIMIT = 40;

/** `go`: a page of the work view or the overview; `settings`: a section of Settings (null: the first). */
export type PaletteCommand = { label: string; icon: "home" | "issues" | "gear" | "list-flat"; keys?: readonly string[] } & ({ go: "overview" | "issues" } | { settings: SectionId | null });

const COMMANDS: readonly PaletteCommand[] = [
  { label: "Go to Overview", icon: "home", keys: ["Ctrl", "Shift", "O"], go: "overview" },
  { label: "Go to Issues", icon: "issues", keys: ["Ctrl", "I"], go: "issues" },
  { label: "Open Settings", icon: "gear", keys: ["Ctrl", ","], settings: null },
  { label: "Show keyboard shortcuts", icon: "list-flat", settings: "shortcuts" },
];

export type PaletteItem =
  | { kind: "command"; section: "Commands"; command: PaletteCommand }
  | { kind: "worktree"; section: "Worktrees"; row: RailRow }
  | { kind: "change"; section: "Files in every worktree"; row: RailRow; file: ChangedFile };

/** In section order, cut to PALETTE_LIMIT. Worktrees that cannot be opened are left out. */
export function paletteItems(query: string, rows: readonly RailRow[], summaries: readonly WorktreeSummary[]): PaletteItem[] {
  const q = query.toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const open = rows.filter((r) => !r.off);
  const items: PaletteItem[] = [
    ...COMMANDS.filter((c) => matches(c.label)).map((command) => ({ kind: "command" as const, section: "Commands" as const, command })),
    ...open.filter((r) => matches(`${r.name} ${r.branch}`)).map((row) => ({ kind: "worktree" as const, section: "Worktrees" as const, row })),
  ];
  if (q)
    for (const row of open)
      for (const file of summaries.find((s) => s.path === row.worktree.path)?.uncommitted ?? [])
        if (matches(file.path)) items.push({ kind: "change", section: "Files in every worktree", row, file });
  return items.slice(0, PALETTE_LIMIT);
}
