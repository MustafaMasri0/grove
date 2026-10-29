// The Explorer keeps one flat, sorted path list per worktree and computes a
// folder's children only when that folder is expanded.

export interface TreeEntry {
  name: string;
  /** Repository-relative path without a trailing slash. */
  path: string;
  isDir: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortPaths(paths: readonly string[]): string[] {
  return [...paths].sort(cmp);
}

function lowerBound(sorted: readonly string[], x: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) || cmp(a.name, b.name);

/**
 * Direct children of `dir` ("" for the root) in a sorted path list. Entries
 * ending in "/" (ignored folders from git) count as folders.
 */
export function childrenOf(sorted: readonly string[], dir: string): TreeEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const dirs: TreeEntry[] = [];
  const files: TreeEntry[] = [];
  let i = lowerBound(sorted, prefix);
  while (i < sorted.length && sorted[i].startsWith(prefix)) {
    const rest = sorted[i].slice(prefix.length);
    const slash = rest.indexOf("/");
    if (rest === "") {
      i++;
    } else if (slash >= 0) {
      const name = rest.slice(0, slash);
      dirs.push({ name, path: prefix + name, isDir: true });
      // Skip everything under this folder: "0" is the character after "/".
      i = lowerBound(sorted, `${prefix}${name}0`);
    } else {
      files.push({ name: rest, path: prefix + rest, isDir: false });
      i++;
    }
  }
  return [...dirs.sort(byName), ...files.sort(byName)];
}

/** Every ancestor folder of the given paths, for colouring folders in the Explorer. */
export function dirsWithChanges(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    let i = p.lastIndexOf("/");
    while (i > 0) {
      const d = p.slice(0, i);
      if (out.has(d)) break;
      out.add(d);
      i = d.lastIndexOf("/");
    }
  }
  return out;
}

/** Whether a sorted path list holds exactly this path. */
export function containsPath(sorted: readonly string[], path: string): boolean {
  return sorted[lowerBound(sorted, path)] === path;
}

/** The folders to expand to show a path, outermost first. */
export function ancestorFolders(path: string): string[] {
  const out: string[] = [];
  for (let i = path.indexOf("/"); i > 0; i = path.indexOf("/", i + 1)) out.push(path.slice(0, i));
  return out;
}
