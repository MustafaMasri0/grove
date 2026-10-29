import { useMemo, useState } from "react";
import type { ChangeKind } from "../api";
import { uncommittedCount } from "../lib/changes";
import { fileItems } from "../lib/contextMenus";
import { shortSha } from "../lib/format";
import { useStore } from "../store";
import { fileTab, revisionTab, uncommittedTab } from "../tabs";
import { currentWhere, menuEnv } from "./ContextMenu";
import { FileRow } from "./FileRow";
import { ListView } from "./ListView";

interface Row {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  open: (pin: boolean) => void;
  /** The plain file (worktree, or the tip of the viewed branch); null when deleted. */
  openFile: (() => void) | null;
  onDisk: boolean;
}

export function ChangesPanel() {
  const mode = useStore((s) => s.settings.changesMode);
  const setMode = useStore((s) => s.setChangesMode);
  const status = useStore((s) => s.status);
  const statusError = useStore((s) => s.statusError);
  const viewBranch = useStore((s) => s.viewBranch);
  const cwd = useStore((s) => s.cwd);
  const base = useStore((s) => s.base);
  const setBase = useStore((s) => s.setBase);
  const baseDiff = useStore((s) => s.baseDiff);
  const baseError = useStore((s) => s.baseError);
  const branches = useStore((s) => s.branches);
  const openTab = useStore((s) => s.openTab);
  const activeTab = useStore((s) => s.activeTab);
  const worktrees = useStore((s) => s.worktrees);
  const [filter, setFilter] = useState("");

  const branchLabel = viewBranch?.name ?? worktrees.find((w) => w.path === cwd)?.branch ?? "HEAD";
  const rev = viewBranch?.fullRef ?? "HEAD";

  const rows: Row[] = useMemo(() => {
    if (!cwd) return [];
    if (mode === "uncommitted") {
      return (status?.entries ?? [])
        .filter((e) => e.kind !== "ignored")
        .map((e) => ({
          path: e.path,
          origPath: e.origPath,
          kind: e.kind,
          open: (pin: boolean) => openTab(uncommittedTab(cwd, e), pin),
          openFile: e.kind === "deleted" ? null : () => openTab(fileTab(cwd, e.path, null), true),
          onDisk: e.kind !== "deleted",
        }));
    }
    if (!baseDiff || !base) return [];
    return baseDiff.files.map((f) => ({
      path: f.path,
      origPath: f.origPath,
      kind: f.kind,
      open: (pin: boolean) => openTab(revisionTab(f, baseDiff.mergeBase, rev, `${base} (${shortSha(baseDiff.mergeBase)})`, branchLabel), pin),
      openFile: f.kind === "deleted" ? null : () => openTab(fileTab(cwd, f.path, viewBranch?.fullRef ?? null), true),
      onDisk: !viewBranch && f.kind !== "deleted",
    }));
  }, [mode, status, baseDiff, cwd, openTab, base, rev, branchLabel, viewBranch]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
    return [...list].sort((a, b) => (a.path < b.path ? -1 : 1));
  }, [rows, filter]);

  const selectedKey = useMemo(() => {
    const tab = useStore.getState().tabs.find((t) => t.id === activeTab);
    return tab?.spec.type === "diff" ? tab.spec.path : null;
  }, [activeTab]);

  const empty =
    mode === "uncommitted" ? (
      viewBranch ? (
        <>
          <b>{viewBranch.name}</b> is not checked out in any worktree, so it has no uncommitted changes. Its files are in Explorer and its commits in History.
        </>
      ) : statusError ? (
        <span className="error-text">{statusError}</span>
      ) : status ? (
        "No uncommitted changes in this worktree."
      ) : (
        "Loading…"
      )
    ) : baseError ? (
      <span className="error-text">{baseError}</span>
    ) : baseDiff ? (
      `${branchLabel} has no changes since it split from ${base}.`
    ) : (
      "Loading…"
    );

  const baseChoices = branches.filter((b) => b.fullRef !== viewBranch?.fullRef);

  return (
    <div className="panel">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === "uncommitted"} className={mode === "uncommitted" ? "on" : ""} onClick={() => setMode("uncommitted")}>
          Uncommitted{status && !viewBranch ? ` (${uncommittedCount(status)})` : ""}
        </button>
        <button role="tab" aria-selected={mode === "base"} className={mode === "base" ? "on" : ""} onClick={() => setMode("base")}>
          Branch vs base
        </button>
      </div>
      {mode === "base" && (
        <div className="base-row">
          <label>
            Base
            <select value={base ?? ""} onChange={(e) => setBase(e.target.value)}>
              {!base && <option value="">—</option>}
              {base && !baseChoices.some((b) => b.name === base) && <option value={base}>{base}</option>}
              {baseChoices.map((b) => (
                <option key={b.fullRef} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {baseDiff && <span className="muted">{baseDiff.files.length} files · since {shortSha(baseDiff.mergeBase)}</span>}
        </div>
      )}
      <input className="filter" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ListView
        label="Changed files"
        items={visible}
        getKey={(r) => r.path}
        selectedKey={selectedKey}
        render={(r) => <FileRow path={r.path} origPath={r.origPath} kind={r.kind} />}
        onSelect={(r, pin) => r.open(pin)}
        menu={(r) => {
          const where = currentWhere();
          return where && fileItems(menuEnv, where, { path: r.path, open: () => r.open(true), openFile: r.openFile, history: () => void useStore.getState().openFileHistory(r.path), onDisk: r.onDisk });
        }}
        empty={filter && rows.length ? "No files match the filter." : empty}
      />
    </div>
  );
}
