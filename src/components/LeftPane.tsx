import { changeCountTitle, uncommittedCount } from "../lib/changes";
import { commitInList } from "../lib/shell";
import { useStore, type LeftTab } from "../store";
import { ChangesPanel } from "./ChangesPanel";
import { CommitPane } from "./CommitPane";
import { ExplorerPanel } from "./ExplorerPanel";
import { HistoryPanel } from "./HistoryPanel";
import { SearchPanel } from "./SearchPanel";

const TABS: { id: LeftTab; label: string; key: string }[] = [
  { id: "changes", label: "Changes", key: "Ctrl+1" },
  { id: "history", label: "History", key: "Ctrl+2" },
  { id: "explorer", label: "Explorer", key: "Ctrl+3" },
  { id: "search", label: "Search", key: "Ctrl+Shift+F" },
];

export function LeftPane() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const focusSearch = useStore((s) => s.focusSearch);
  // Only a worktree has uncommitted changes; a branch shown read-only does not.
  const changes = useStore((s) => (s.viewBranch ? null : uncommittedCount(s.status)));
  // Too narrow for a column of its own: the commit's files take the list's place.
  const commitHere = useStore((s) => s.leftTab === "history" && s.selectedCommit !== null && commitInList(s.appWidth));
  return (
    <aside className="left">
      <nav className="left-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "on" : ""}
            title={`${t.label} (${t.key})`}
            onClick={() => (t.id === "search" ? focusSearch() : setTab(t.id))}
          >
            <span className="tab-label">{t.label}</span>
            {t.id === "changes" && !!changes && (
              <span className="pill tab-count" title={changeCountTitle(changes)}>
                {changes}
              </span>
            )}
          </button>
        ))}
      </nav>
      {tab === "changes" && <ChangesPanel />}
      {tab === "history" && (commitHere ? <CommitPane /> : <HistoryPanel />)}
      {tab === "explorer" && <ExplorerPanel />}
      {tab === "search" && <SearchPanel />}
    </aside>
  );
}
