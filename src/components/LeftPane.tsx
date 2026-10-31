import { changeCountTitle, uncommittedCount } from "../lib/changes";
import { commitInList } from "../lib/shell";
import { useStore, type LeftTab } from "../store";
import { Count, IconTabs, type IconTabItem } from "../ui";
import { ChangesPanel } from "./ChangesPanel";
import { CommitPane } from "./CommitPane";
import { ExplorerPanel } from "./ExplorerPanel";
import { HistoryPanel } from "./HistoryPanel";
import { SearchPanel } from "./SearchPanel";
import "../panes.css";

export function LeftPane() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const focusSearch = useStore((s) => s.focusSearch);
  // Only a worktree has uncommitted changes; a branch shown read-only does not.
  const changes = useStore((s) => (s.viewBranch ? null : uncommittedCount(s.status)));
  // Too narrow for a column of its own: the commit's files take the list's place.
  const commitHere = useStore((s) => s.leftTab === "history" && s.selectedCommit !== null && commitInList(s.appWidth));
  // The Changes pane says the count itself; the tab carries it for the other panes.
  const count = tab !== "changes" && !!changes ? <Count n={changes} title={changeCountTitle(changes)} /> : undefined;
  const tabs: readonly IconTabItem<LeftTab>[] = [
    ["changes", "Changes", "diff", "Changes (Ctrl+1)", count],
    ["history", "History", "history", "History (Ctrl+2)"],
    ["explorer", "Explorer", "folder", "Explorer (Ctrl+3)"],
    ["search", "Search", "search", "Search (Ctrl+Shift+F)"],
  ];
  return (
    <aside className="ui-root left">
      <nav className="ptabs">
        <IconTabs label="Worktree panes" value={tab} items={tabs} onChange={(t) => (t === "search" ? focusSearch() : setTab(t))} />
      </nav>
      {tab === "changes" && <ChangesPanel />}
      {tab === "history" && (commitHere ? <CommitPane /> : <HistoryPanel />)}
      {tab === "explorer" && <ExplorerPanel />}
      {tab === "search" && <SearchPanel />}
    </aside>
  );
}
