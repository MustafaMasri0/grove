// UI icons from VS Code Codicons (CC BY 4.0, Microsoft). Each SVG is inlined so it follows `currentColor`.
import type { CSSProperties } from "react";
import add from "@vscode/codicons/src/icons/add.svg?raw";
import arrowDown from "@vscode/codicons/src/icons/arrow-down.svg?raw";
import check from "@vscode/codicons/src/icons/check.svg?raw";
import close from "@vscode/codicons/src/icons/close.svg?raw";
import diff from "@vscode/codicons/src/icons/diff.svg?raw";
import edit from "@vscode/codicons/src/icons/edit.svg?raw";
import file from "@vscode/codicons/src/icons/file.svg?raw";
import fileMedia from "@vscode/codicons/src/icons/file-media.svg?raw";
import folder from "@vscode/codicons/src/icons/folder.svg?raw";
import gitCommit from "@vscode/codicons/src/icons/git-commit.svg?raw";
import history from "@vscode/codicons/src/icons/history.svg?raw";
import home from "@vscode/codicons/src/icons/home.svg?raw";
import layoutSidebarLeft from "@vscode/codicons/src/icons/layout-sidebar-left.svg?raw";
import link from "@vscode/codicons/src/icons/link.svg?raw";
import question from "@vscode/codicons/src/icons/question.svg?raw";
import remove from "@vscode/codicons/src/icons/remove.svg?raw";
import search from "@vscode/codicons/src/icons/search.svg?raw";
import warning from "@vscode/codicons/src/icons/warning.svg?raw";
import arrowUp from "@vscode/codicons/src/icons/arrow-up.svg?raw";
import chevronDown from "@vscode/codicons/src/icons/chevron-down.svg?raw";
import chevronRight from "@vscode/codicons/src/icons/chevron-right.svg?raw";
import cloudUpload from "@vscode/codicons/src/icons/cloud-upload.svg?raw";
import gear from "@vscode/codicons/src/icons/gear.svg?raw";
import gitBranch from "@vscode/codicons/src/icons/git-branch.svg?raw";
import listFlat from "@vscode/codicons/src/icons/list-flat.svg?raw";
import listTree from "@vscode/codicons/src/icons/list-tree.svg?raw";
import sync from "@vscode/codicons/src/icons/sync.svg?raw";
import worktree from "@vscode/codicons/src/icons/worktree.svg?raw";

const icons = {
  add,
  "arrow-down": arrowDown,
  check,
  close,
  diff,
  edit,
  file,
  "file-media": fileMedia,
  folder,
  "git-commit": gitCommit,
  history,
  home,
  "layout-sidebar-left": layoutSidebarLeft,
  link,
  question,
  remove,
  search,
  warning,
  "arrow-up": arrowUp,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "cloud-upload": cloudUpload,
  gear,
  "git-branch": gitBranch,
  "list-flat": listFlat,
  "list-tree": listTree,
  sync,
  worktree,
};

export type IconName = keyof typeof icons;

/** The icon's SVG, for markup that is not React's. */
export const iconMarkup = (name: IconName) => icons[name];

/** `size` applies inside the design system, whose CSS reads --ic; elsewhere an icon keeps the SVG's own size. */
export function Icon({ name, className, size }: { name: IconName; className?: string; size?: number }) {
  const style = size ? ({ "--ic": `${size}px` } as CSSProperties) : undefined;
  return <span className={className ? `icon ${className}` : "icon"} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
