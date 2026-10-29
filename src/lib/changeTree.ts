// Changed files as a folder tree (the Tree view of Changes and the commit pane):
// built from the flat list, with single-folder chains joined like VS Code does.
import { byName } from "./tree";

export interface FolderNode<T> {
  kind: "folder";
  /** One folder name, or several joined with "/" once compacted. */
  name: string;
  /** Repository-relative path of the (deepest) folder. */
  path: string;
  /** Files anywhere below. */
  count: number;
  children: TreeNode<T>[];
}

export interface FileNode<T> {
  kind: "file";
  name: string;
  path: string;
  item: T;
}

export type TreeNode<T> = FolderNode<T> | FileNode<T>;

/** Sorts each level folders first and counts the files below each folder. */
function finish<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  const dirs = nodes.filter((n) => n.kind === "folder").sort(byName);
  const files = nodes.filter((n) => n.kind === "file").sort(byName);
  for (const d of dirs) {
    d.children = finish(d.children);
    d.count = d.children.reduce((sum, c) => sum + (c.kind === "folder" ? c.count : 1), 0);
  }
  return [...dirs, ...files];
}

/** The top level of the tree of the given files, folders first. */
export function buildTree<T>(items: readonly T[], pathOf: (item: T) => string): TreeNode<T>[] {
  const root: FolderNode<T> = { kind: "folder", name: "", path: "", count: 0, children: [] };
  const folders = new Map<string, FolderNode<T>>([["", root]]);
  const folder = (path: string): FolderNode<T> => {
    let f = folders.get(path);
    if (!f) {
      const slash = path.lastIndexOf("/");
      f = { kind: "folder", name: path.slice(slash + 1), path, count: 0, children: [] };
      folder(slash < 0 ? "" : path.slice(0, slash)).children.push(f);
      folders.set(path, f);
    }
    return f;
  };
  for (const item of items) {
    const path = pathOf(item);
    const slash = path.lastIndexOf("/");
    folder(slash < 0 ? "" : path.slice(0, slash)).children.push({ kind: "file", name: path.slice(slash + 1), path, item });
  }
  return finish(root.children);
}

/** Joins each folder that holds nothing but one folder with that folder ("src/main/java"). */
export function compactFolders<T>(nodes: readonly TreeNode<T>[]): TreeNode<T>[] {
  return nodes.map((n) => {
    if (n.kind === "file") return n;
    let name = n.name;
    let cur = n;
    while (cur.children.length === 1 && cur.children[0].kind === "folder") {
      cur = cur.children[0];
      name = `${name}/${cur.name}`;
    }
    return { ...cur, name, children: compactFolders(cur.children) };
  });
}

/** A folder's row key; git paths never end in "/", so it cannot be a file's. */
export const folderKey = (path: string) => `${path}/`;

export interface TreeRow<T> {
  node: TreeNode<T>;
  /** The file's path, or `folderKey` of the folder's. */
  key: string;
  depth: number;
  /** The key of the folder row it is in; null at the top. */
  parent: string | null;
}

/** The rows a tree shows: every folder open unless its path is in `collapsed`. */
export function flattenTree<T>(nodes: readonly TreeNode<T>[], collapsed: ReadonlySet<string>): TreeRow<T>[] {
  const out: TreeRow<T>[] = [];
  const walk = (list: readonly TreeNode<T>[], depth: number, parent: string | null) => {
    for (const node of list) {
      const key = node.kind === "folder" ? folderKey(node.path) : node.path;
      out.push({ node, key, depth, parent });
      if (node.kind === "folder" && !collapsed.has(node.path)) walk(node.children, depth + 1, key);
    }
  };
  walk(nodes, 0, null);
  return out;
}
