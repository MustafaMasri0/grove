import { useEffect, useMemo, useState } from "react";
import { api, type ChangeKind } from "../api";
import { fileItems, folderItems } from "../lib/contextMenus";
import { ancestorFolders, childrenOf, containsPath, dirsWithChanges, type TreeEntry } from "../lib/tree";
import { useAt, useStore } from "../store";
import { fileTab, revealPathOf } from "../tabs";
import { currentWhere, menuEnv } from "./ContextMenu";
import { FileTypeIcon, FolderTypeIcon } from "./FileTypeIcon";
import { Icon } from "./Icon";
import { ListView } from "./ListView";

interface Node extends TreeEntry {
  depth: number;
  ignored: boolean;
}

export function ExplorerPanel() {
  const fileList = useStore((s) => s.fileList);
  const fileListKey = useStore((s) => s.fileListKey);
  const status = useStore((s) => s.status);
  const viewBranch = useStore((s) => s.viewBranch);
  const showIgnored = useStore((s) => s.settings.showIgnored);
  const updateSettings = useStore((s) => s.updateSettings);
  const loadFileList = useStore((s) => s.loadFileList);
  const openTab = useStore((s) => s.openTab);
  const cwd = useStore((s) => s.cwd);
  const at = useAt();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ignoredChildren, setIgnoredChildren] = useState<Record<string, TreeEntry[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);
  /** A file to reveal once the file list has it. */
  const [pending, setPending] = useState<string | null>(null);

  // A different worktree or branch starts collapsed.
  const scope = `${cwd}|${viewBranch?.fullRef}`;
  useEffect(() => {
    setExpanded(new Set());
    setSelected(null);
  }, [scope]);
  useEffect(() => setIgnoredChildren({}), [fileListKey]);

  // Follow the editor: the active tab's file, when it becomes active and when Explorer opens.
  const autoReveal = useStore((s) => s.settings.explorerAutoReveal);
  const activeTab = useStore((s) => s.activeTab);
  const activePath = useStore((s) => revealPathOf(s.tabs.find((t) => t.id === s.activeTab), s.cwd));
  useEffect(() => {
    if (autoReveal && activePath) setPending(activePath);
  }, [autoReveal, activeTab, activePath]);
  const request = useStore((s) => s.explorerReveal);
  useEffect(() => {
    if (!request) return;
    setPending(request.path);
    useStore.setState({ explorerReveal: null });
  }, [request]);
  useEffect(() => {
    if (!pending || !fileList) return;
    setPending(null);
    // Deleted files and files of other revisions are not listed; nothing to show.
    if (!containsPath(fileList.files, pending)) return;
    setExpanded((e) => new Set([...e, ...ancestorFolders(pending)]));
    setSelected(pending);
    setReveal((n) => n + 1);
  }, [pending, fileList]);

  const all = useMemo(() => {
    if (!fileList) return [];
    if (!fileList.ignored.length) return fileList.files;
    return [...fileList.files, ...fileList.ignored].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [fileList]);
  const ignoredSet = useMemo(() => new Set((fileList?.ignored ?? []).map((p) => p.replace(/\/$/, ""))), [fileList]);

  const kinds = useMemo(() => {
    const m = new Map<string, ChangeKind>();
    if (!viewBranch) for (const e of status?.entries ?? []) m.set(e.path, e.kind);
    return m;
  }, [status, viewBranch]);
  const changedDirs = useMemo(() => dirsWithChanges([...kinds.keys()].filter((p) => kinds.get(p) !== "deleted")), [kinds]);
  const conflictDirs = useMemo(() => dirsWithChanges([...kinds].filter(([, k]) => k === "conflicted").map(([p]) => p)), [kinds]);

  const rows = useMemo(() => {
    const out: Node[] = [];
    const walk = (dir: string, depth: number, ignored: boolean) => {
      const kids = ignored ? ignoredChildren[dir] ?? [] : childrenOf(all, dir);
      for (const k of kids) {
        const ign = ignored || ignoredSet.has(k.path);
        out.push({ ...k, depth, ignored: ign });
        if (k.isDir && expanded.has(k.path)) walk(k.path, depth + 1, ign);
      }
    };
    walk("", 0, false);
    return out;
  }, [all, expanded, ignoredChildren, ignoredSet]);

  const toggle = async (n: Node, open?: boolean) => {
    const next = new Set(expanded);
    const willOpen = open ?? !next.has(n.path);
    if (willOpen) next.add(n.path);
    else next.delete(n.path);
    setExpanded(next);
    if (willOpen && n.ignored && !ignoredChildren[n.path] && at) {
      try {
        const entries = await api.listDir(at, n.path);
        const kids = entries
          .map((e) => ({ name: e.name, path: `${n.path}/${e.name}`, isDir: e.isDir }))
          .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
        setIgnoredChildren((m) => ({ ...m, [n.path]: kids }));
      } catch {
        setIgnoredChildren((m) => ({ ...m, [n.path]: [] }));
      }
    }
  };

  // Arrow keys only move; clicks and Enter open files and toggle folders.
  const onSelect = (n: Node, pin: boolean, via: "click" | "key") => {
    setSelected(n.path);
    if (via === "key" && !pin) return;
    if (n.isDir) {
      // A double-click arrives after the click that already toggled.
      if (!(pin && via === "click")) void toggle(n);
      return;
    }
    if (cwd) openTab(fileTab(cwd, n.path, viewBranch?.fullRef ?? null), pin);
  };

  const classFor = (n: Node) => {
    if (n.ignored) return "k-ignored";
    if (n.isDir) return conflictDirs.has(n.path) ? "k-conflicted" : changedDirs.has(n.path) ? "k-modified" : "";
    const k = kinds.get(n.path);
    return k ? `k-${k}` : "";
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <span className="muted ellipsis">{viewBranch ? `Files at the tip of ${viewBranch.name}` : `${fileList?.files.length ?? "…"} files`}</span>
        {!viewBranch && (
          <label className="check" title="Show files git ignores (node_modules, build output, …)">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => {
                updateSettings({ showIgnored: e.target.checked });
                void loadFileList();
              }}
            />
            Ignored files
          </label>
        )}
      </div>
      <ListView<Node>
        label="Files"
        className="tree"
        items={rows}
        getKey={(n) => n.path}
        selectedKey={selected}
        reveal={reveal}
        onSelect={onSelect}
        menu={(n) => {
          const where = currentWhere();
          if (!where || !cwd) return null;
          // A view-only branch's files are not in the worktree folder.
          const onDisk = !viewBranch;
          if (n.isDir) return folderItems(menuEnv, where, { path: n.path, onDisk, collapseAll: () => setExpanded(new Set()) });
          return fileItems(menuEnv, where, { path: n.path, open: () => openTab(fileTab(cwd, n.path, viewBranch?.fullRef ?? null), true), history: () => void useStore.getState().openFileHistory(n.path), onDisk });
        }}
        onHorizontal={(n, d) => {
          if (n.isDir) void toggle(n, d === 1);
          else if (d === -1) {
            const parent = n.path.slice(0, n.path.lastIndexOf("/"));
            if (parent) setSelected(parent);
          }
        }}
        render={(n) => {
          const cls = classFor(n);
          return (
            <span className={`tree-row ${cls}`} style={{ paddingLeft: 6 + n.depth * 14 }} title={n.path}>
              <span className="tree-chevron">{n.isDir ? <Icon name={expanded.has(n.path) ? "chevron-down" : "chevron-right"} /> : null}</span>
              <span className="tree-icon">{n.isDir ? <FolderTypeIcon name={n.name} open={expanded.has(n.path)} /> : <FileTypeIcon name={n.name} />}</span>
              <span className={`tree-name ${cls}`}>{n.name}</span>
            </span>
          );
        }}
        empty={fileList ? "No files." : "Loading…"}
      />
    </div>
  );
}
