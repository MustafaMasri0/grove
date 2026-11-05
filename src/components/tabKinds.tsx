// How each kind of tab presents itself in the tab row and its menu.
import type { ReactNode } from "react";
import { displayPath, joinPath } from "../lib/hostPaths";
import { useStore } from "../store";
import type { DiffTab, FileTab, SettingsTab, Tab, TabKind } from "../tabs";
import { FileTypeIcon } from "./FileTypeIcon";

interface TabKindView<T extends Tab> {
  /** Shown before the title. */
  lead(t: T): ReactNode;
  /** A short sign after the icon, such as ± for a diff. */
  mark?: string;
  tip(t: T): string;
  /** The file Copy path copies, as the user's system shows it; null when the tab shows no file. */
  path(t: T): string | null;
  /** The file and revision "View file history" walks from; null when the tab has no file history. */
  history(t: T): { path: string; rev: string | null } | null;
}

/** A worktree's file as a Windows path, or as it is when the repository is unknown. */
function worktreePath(t: FileTab | DiffTab): string {
  const info = useStore.getState().repos[t.repo];
  return info && "kind" in info ? displayPath(info, joinPath(t.cwd, t.path)) : t.path;
}

const file: TabKindView<FileTab> = {
  lead: (t) => <FileTypeIcon name={t.title} />,
  tip: (t) => `${t.path}\n${t.description}`,
  path: worktreePath,
  history: (t) => ({ path: t.path, rev: t.source.kind === "rev" ? t.source.rev : null }),
};

const diff: TabKindView<DiffTab> = {
  lead: (t) => <FileTypeIcon name={t.title} />,
  mark: "±",
  tip: (t) => `${t.path}\n${t.description}`,
  path: worktreePath,
  // The newer side's revision; for a deleted file, the last revision that had it.
  history: (t) => ({ path: t.path, rev: t.right.kind === "rev" ? t.right.rev : t.left.kind === "rev" && t.right.kind === "empty" ? t.left.rev : null }),
};

const settings: TabKindView<SettingsTab> = {
  lead: (t) => <FileTypeIcon name={t.title} />,
  tip: (t) => `${t.path}\n${t.description}`,
  path: (t) => t.path,
  history: () => null,
};

const kinds: { [K in TabKind]: TabKindView<Extract<Tab, { kind: K }>> } = { file, diff, settings };

export function kindOf<T extends Tab>(t: T): TabKindView<T> {
  return kinds[t.kind] as unknown as TabKindView<T>;
}
