// UI icons from VS Code Codicons (CC BY 4.0, Microsoft). Each SVG is inlined so it follows `currentColor`.
import arrowUp from "@vscode/codicons/src/icons/arrow-up.svg?raw";
import chevronDown from "@vscode/codicons/src/icons/chevron-down.svg?raw";
import chevronRight from "@vscode/codicons/src/icons/chevron-right.svg?raw";
import cloudUpload from "@vscode/codicons/src/icons/cloud-upload.svg?raw";
import extensions from "@vscode/codicons/src/icons/extensions.svg?raw";
import gear from "@vscode/codicons/src/icons/gear.svg?raw";
import gitBranch from "@vscode/codicons/src/icons/git-branch.svg?raw";
import listFlat from "@vscode/codicons/src/icons/list-flat.svg?raw";
import listTree from "@vscode/codicons/src/icons/list-tree.svg?raw";
import rootFolder from "@vscode/codicons/src/icons/root-folder.svg?raw";
import sync from "@vscode/codicons/src/icons/sync.svg?raw";
import worktree from "@vscode/codicons/src/icons/worktree.svg?raw";

const icons = {
  "arrow-up": arrowUp,
  "chevron-down": chevronDown,
  "chevron-right": chevronRight,
  "cloud-upload": cloudUpload,
  extensions,
  gear,
  "git-branch": gitBranch,
  "list-flat": listFlat,
  "list-tree": listTree,
  "root-folder": rootFolder,
  sync,
  worktree,
};

export type IconName = keyof typeof icons;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <span className={className ? `icon ${className}` : "icon"} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] }} />;
}
