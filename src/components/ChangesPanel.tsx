import { useMemo, useState } from "react";
import type { ChangeKind } from "../api";
import { uncommittedCount } from "../lib/changes";
import { fileItems } from "../lib/contextMenus";
import { shortSha } from "../lib/format";
import { useStore } from "../store";
import { fileTab, revisionTab, uncommittedTab } from "../tabs";
import { ChangedFilesView, ChangesViewToggle } from "./ChangedFilesView";
import { BaseSelect } from "./BaseSelect";
import { currentWhere, menuEnv } from "../menuEnv";
import { Field, Tray } from "../ui";

interface Row {
  path: string;
  origPath: string | null;
  kind: ChangeKind;
  open: (pin: boolean) => void;
  /** The plain file (worktree, or the tip of the shown branch); null when deleted. */
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
  const baseDiff = useStore((s) => s.baseDiff);
  const baseError = useStore((s) => s.baseError);
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
    return tab?.kind === "diff" ? tab.path : null;
  }, [activeTab]);

  const empty =
    mode === "uncommitted" ? (
      viewBranch ? (
        <>
          <b>{viewBranch.name}</b> is not checked out in any worktree, so it has no uncommitted changes. Its files are in Explorer and its commits in History.
        </>
      ) : statusError ? (
        <span className="err-text">{statusError}</span>
      ) : status ? (
        "No uncommitted changes in this worktree."
      ) : (
        "Loading…"
      )
    ) : baseError ? (
      <span className="err-text">{baseError}</span>
    ) : baseDiff ? (
      `${branchLabel} has no changes since it split from ${base}.`
    ) : (
      "Loading…"
    );

  return (
    <div className="pane-body">
      <div className="pane-seg">
        <Tray
          role="tablist"
          small
          label="Changes"
          value={mode}
          items={[
            ["uncommitted", `Uncommitted${status && !viewBranch ? ` (${uncommittedCount(status)})` : ""}`],
            ["base", "Branch vs base"],
          ]}
          onChange={setMode}
        />
        {mode === "base" && (
          <span className="base-in" data-tip={`Base${baseDiff ? ` · ${baseDiff.files.length} files · since ${shortSha(baseDiff.mergeBase)}` : ""}`}>
            <BaseSelect />
          </span>
        )}
      </div>
      <div className="filter-row">
        <Field quiet placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ChangesViewToggle />
      </div>
      <ChangedFilesView
        label="Changed files"
        items={visible}
        selectedPath={selectedKey}
        open={(r, pin) => r.open(pin)}
        menu={(r) => {
          const where = currentWhere();
          return (
            where &&
            fileItems(menuEnv, where, {
              path: r.path,
              open: () => r.open(true),
              openFile: r.openFile,
              history: () => void useStore.getState().openFileHistory(r.path),
              revealInExplorer: r.kind === "deleted" ? null : () => useStore.getState().revealInExplorer(r.path),
              onDisk: r.onDisk,
            })
          );
        }}
        onDisk={!viewBranch}
        empty={filter && rows.length ? "No files match the filter." : empty}
      />
    </div>
  );
}
