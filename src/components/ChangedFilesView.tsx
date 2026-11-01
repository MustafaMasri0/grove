import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChangeKind } from "../api";
import { buildTree, compactFolders, flattenTree, type TreeNode, type TreeRow } from "../lib/changeTree";
import { folderItems } from "../lib/contextMenus";
import type { MenuItem } from "../lib/menu";
import { useStore } from "../store";
import { currentWhere, menuEnv } from "../menuEnv";
import { Count, Toggle, TreeChevron } from "../ui";
import { fileRow } from "./FileRow";
import { FolderTypeIcon } from "./FileTypeIcon";
import { ListView, useListRowHeight } from "./ListView";

interface ChangedItem {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
}

interface Props<T extends ChangedItem> {
  label: string;
  /** Already filtered. */
  items: readonly T[];
  /** The file of the active diff tab. */
  selectedPath: string | null;
  open: (item: T, pin: boolean) => void;
  menu: (item: T) => MenuItem[] | null;
  /** Whether the folders are in the worktree folder, so File Explorer can show them. */
  onDisk: boolean;
  empty: ReactNode;
}

/** Switches changed files between the flat list and the folder tree (saved in settings). */
export function ChangesViewToggle() {
  const view = useStore((s) => s.settings.changesView);
  const update = useStore((s) => s.updateSettings);
  const tree = view === "tree";
  const label = tree ? "View as list" : "View as tree";
  return <Toggle size="sm" icon={tree ? "list-flat" : "list-tree"} label={label} tip={label} on={tree} onClick={() => update({ changesView: tree ? "list" : "tree" })} />;
}

/** Changed files as a flat list or a folder tree, following the Changes view setting. */
export function ChangedFilesView<T extends ChangedItem>(p: Props<T>) {
  const view = useStore((s) => s.settings.changesView);
  const showDir = useStore((s) => s.settings.showFolderPath);
  const rowHeight = useListRowHeight();
  if (view === "tree") return <ChangedFilesTree {...p} />;
  return (
    <ListView<T>
      label={p.label}
      items={p.items}
      rowHeight={rowHeight}
      getKey={(f) => f.path}
      selectedKey={p.selectedPath}
      render={(f) => fileRow({ ...f, showDir })}
      onSelect={(f, pin) => p.open(f, pin)}
      menu={p.menu}
      empty={p.empty}
    />
  );
}

function folderPaths<T>(nodes: readonly TreeNode<T>[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === "folder") {
      out.push(n.path);
      folderPaths(n.children, out);
    }
  }
  return out;
}

function ChangedFilesTree<T extends ChangedItem>(p: Props<T>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** A folder row selected with the keyboard or a click; files are selected by their tab. */
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => setFolder(null), [p.selectedPath]);

  const tree = useMemo(() => compactFolders(buildTree(p.items, (f) => f.path)), [p.items]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const rowHeight = useListRowHeight();

  const toggle = (path: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (open ?? next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Like Explorer: arrow keys move (and preview files), clicks and Enter toggle folders.
  const onSelect = (r: TreeRow<T>, pin: boolean, via: "click" | "key") => {
    const n = r.node;
    if (n.kind === "file") {
      setFolder(null);
      p.open(n.item, pin);
      return;
    }
    setFolder(r.key);
    if (via === "key" && !pin) return;
    // A double-click arrives after the click that already toggled.
    if (!(pin && via === "click")) toggle(n.path);
  };

  const onHorizontal = (r: TreeRow<T>, dir: -1 | 1) => {
    const n = r.node;
    const isOpen = n.kind === "folder" && !collapsed.has(n.path);
    if (n.kind === "folder" && dir === 1) {
      if (!isOpen) toggle(n.path, true);
      else {
        const child = rows[rows.indexOf(r) + 1];
        if (child?.parent === r.key) onSelect(child, false, "key");
      }
    } else if (dir === -1) {
      if (isOpen) toggle(n.path, false);
      else if (r.parent) setFolder(r.parent);
    }
  };

  return (
    <ListView<TreeRow<T>>
      label={p.label}
      className="tree"
      items={rows}
      rowHeight={rowHeight}
      getKey={(r) => r.key}
      selectedKey={folder ?? p.selectedPath}
      onSelect={onSelect}
      onHorizontal={onHorizontal}
      menu={(r) => {
        const n = r.node;
        if (n.kind === "file") return p.menu(n.item);
        const where = currentWhere();
        return where && folderItems(menuEnv, where, { path: n.path, onDisk: p.onDisk, collapseAll: () => setCollapsed(new Set(folderPaths(tree))) });
      }}
      render={(r) => {
        const n = r.node;
        if (n.kind === "file") return { ...fileRow({ path: n.path, origPath: n.item.origPath, kind: n.item.kind, inTree: true }), indent: r.depth };
        const open = !collapsed.has(n.path);
        return {
          indent: r.depth,
          title: n.path,
          lead: (
            <>
              <TreeChevron folder open={open} />
              <FolderTypeIcon name={n.path.slice(n.path.lastIndexOf("/") + 1)} open={open} />
            </>
          ),
          main: <span className="fname">{n.name}</span>,
          trail: <Count n={n.count} title={`${n.count} changed file${n.count === 1 ? "" : "s"}`} />,
        };
      }}
      empty={p.empty}
    />
  );
}
