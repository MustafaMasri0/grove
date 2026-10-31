import type { ChangeKind } from "../api";

/** Joins the class names that are set. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export const STATUS_LETTER: Record<ChangeKind, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", ignored: "I", conflicted: "!" };
export const STATUS_TITLE: Record<ChangeKind, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  copied: "Copied",
  untracked: "Untracked",
  ignored: "Ignored",
  conflicted: "Conflicted",
};

/** A path split for display: the folder with its trailing slash, and the file name. */
export function splitDisplayPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/") + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
}

/** Where the tray thumb sits for a selected button: the insets from the tray's left and right edges. */
export function thumbInsets(trayWidth: number, buttonLeft: number, buttonWidth: number): { left: number; right: number } {
  return { left: buttonLeft, right: trayWidth - buttonLeft - buttonWidth };
}
