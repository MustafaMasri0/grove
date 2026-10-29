import { useEffect, useMemo, useState } from "react";
import type { ChangedFile } from "../api";
import { commitItems, fileItems } from "../lib/contextMenus";
import { shortSha } from "../lib/format";
import { useStore } from "../store";
import { commitFileTab, fileTab } from "../tabs";
import { currentWhere, menuAtPointer, menuEnv } from "./ContextMenu";
import { Avatar } from "./Avatar";
import { ChangedFilesView, ChangesViewToggle } from "./ChangedFilesView";

// The filter resets when a different commit is selected.
function useFilter(): [string, (v: string) => void] {
  const sha = useStore((s) => s.selectedCommit?.detail.sha);
  const [filter, setFilter] = useState("");
  useEffect(() => setFilter(""), [sha]);
  return [filter, setFilter];
}

/** The middle column in History: the selected commit's files on top, its details below. */
export function CommitPane() {
  const selected = useStore((s) => s.selectedCommit);
  const openTab = useStore((s) => s.openTab);
  const activeTab = useStore((s) => s.activeTab);
  const close = () => useStore.setState({ selectedCommit: null });
  const [filter, setFilter] = useFilter();

  const selectedFile = useMemo(() => {
    const tab = useStore.getState().tabs.find((t) => t.id === activeTab);
    return tab?.spec.type === "diff" ? tab.spec.path : null;
  }, [activeTab]);

  if (!selected) return null;
  const { detail, parent } = selected;
  const files = filter ? selected.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())) : selected.files;

  const openFile = (f: ChangedFile, pin: boolean) => openTab(commitFileTab(f, detail, parent), pin);

  return (
    <section className="commit-pane">
      <div className="pane-head">
        <span className="pane-title ellipsis" title={detail.message}>
          {selected.files.length} changed file{selected.files.length === 1 ? "" : "s"}
        </span>
        <span className="pane-actions">
          <ChangesViewToggle />
          <button className="icon-button" title="Close" onClick={close}>
            ×
          </button>
        </span>
      </div>
      <input className="filter" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ChangedFilesView<ChangedFile>
        label="Files in commit"
        items={files}
        selectedPath={selectedFile}
        open={openFile}
        onDisk={!useStore.getState().viewBranch}
        menu={(f) => {
          const where = currentWhere();
          const { cwd, viewBranch } = useStore.getState();
          if (!where || !cwd) return null;
          return fileItems(menuEnv, where, {
            path: f.path,
            open: () => openFile(f, true),
            openFile: f.kind === "deleted" ? null : () => openTab(fileTab(cwd, f.path, viewBranch?.fullRef ?? null), true),
            // Walked from this commit, so a file renamed or deleted later still has its history.
            history: () => void useStore.getState().openFileHistory(f.path, detail.sha),
            revealInExplorer: f.kind === "deleted" ? null : () => useStore.getState().revealInExplorer(f.path),
            onDisk: !viewBranch && f.kind !== "deleted",
          });
        }}
        empty={filter ? "No files match the filter." : "No file changes."}
      />
      <div
        className="commit-head"
        onContextMenu={(e) => {
          // The same options as the commit's row in History.
          const { githubRepo } = useStore.getState();
          menuAtPointer(e, commitItems(menuEnv, { sha: detail.sha, subject: detail.message.split("\n")[0], message: () => detail.message, github: githubRepo }));
        }}
      >
        <div className="commit-author">
          <Avatar name={detail.authorName} email={detail.authorEmail} size={32} sha={detail.sha} />
          <div>
            <div>
              {detail.authorName} <span className="muted">&lt;{detail.authorEmail}&gt;</span>
            </div>
            <div className="muted">{new Date(detail.authorDate).toLocaleString()}</div>
          </div>
        </div>
        <pre className="commit-message">{detail.message}</pre>
        <div className="commit-info">
          {detail.committerName !== detail.authorName && <div className="muted">Committed by {detail.committerName}</div>}
          <div className="muted">
            <span className="mono selectable">{detail.sha}</span>
          </div>
          <div className="muted">
            {detail.parents.length === 0 ? "Root commit" : detail.parents.length > 1 ? `Merge of ${detail.parents.map(shortSha).join(", ")}; files compared with the first parent` : `Parent ${shortSha(detail.parents[0])}`}
          </div>
        </div>
      </div>
    </section>
  );
}
