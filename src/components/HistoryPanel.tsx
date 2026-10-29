import { useEffect, useState, type ReactNode } from "react";
import { api, type CommitSummary, type FileHistoryEntry } from "../api";
import { commitItems } from "../lib/contextMenus";
import { isoToUnix, relativeTime, splitPath, STATUS_LETTER } from "../lib/format";
import type { MenuItem } from "../lib/menu";
import { SEARCH_LIMIT, useStore, type FileHistory } from "../store";
import { commitFileTab } from "../tabs";
import { Avatar } from "./Avatar";
import { menuEnv } from "./ContextMenu";
import { ListView } from "./ListView";

/** The commit list (or one file's commits); the selected commit opens in the commit pane next to it. */
export function HistoryPanel() {
  const fileHistory = useStore((s) => s.fileHistory);
  return <div className="panel history">{fileHistory ? <FileHistoryList fh={fileHistory} /> : <CommitList />}</div>;
}

function commitMenu(c: CommitSummary): MenuItem[] | null {
  const { repo, cwd, selectedCommit, githubRepo } = useStore.getState();
  if (!repo || !cwd) return null;
  // The full message is only loaded for the selected commit; others are asked for when copied.
  const message = () =>
    selectedCommit?.detail.sha === c.sha ? selectedCommit.detail.message : api.commit({ repo: repo.id, cwd }, c.sha).then((x) => x.detail.message);
  return commitItems(menuEnv, { sha: c.sha, subject: c.subject, message, github: githubRepo });
}

function CommitRow({ c, extra }: { c: CommitSummary; extra?: ReactNode }) {
  return (
    <span className="commit-row" title={`${c.subject}\n${c.authorName} · ${c.authorDate}`}>
      <Avatar name={c.authorName} email={c.authorEmail} size={18} sha={c.sha} />
      <span className="commit-subject">{c.subject}</span>
      {extra}
      <span className="commit-meta">
        {c.authorName} · {relativeTime(isoToUnix(c.authorDate))}
      </span>
    </span>
  );
}

function CommitList() {
  const commits = useStore((s) => s.commits);
  const done = useStore((s) => s.commitsDone);
  const error = useStore((s) => s.commitsError);
  const selected = useStore((s) => s.selectedCommit);
  const selectCommit = useStore((s) => s.selectCommit);
  const loadMore = useStore((s) => s.loadMoreCommits);
  const matches = useStore((s) => s.historyMatches);
  const [text, setText] = useState(() => useStore.getState().historyQuery);

  // Searched a moment after typing stops.
  useEffect(() => {
    const t = window.setTimeout(() => void useStore.getState().searchHistory(text), text.trim() ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [text]);

  const q = text.trim();
  const current = q && matches?.query === q ? matches : null;
  // While a new search runs, the previous matches stay.
  const items = q ? matches?.commits ?? [] : commits;
  let empty: ReactNode;
  if (q) empty = current?.error ? <span className="error-text">{current.error}</span> : current ? "No commits match." : "Searching…";
  else empty = error ? <span className="error-text">{error}</span> : done ? "No commits." : "Loading…";

  return (
    <>
      <input
        className="filter history-search"
        placeholder="Search history: message, author or SHA"
        aria-label="Search history"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
          }
        }}
      />
      {current && current.commits.length > 0 && (
        <div className="search-summary muted">
          {current.truncated ? `First ${SEARCH_LIMIT} matching commits` : `${current.commits.length} matching commit${current.commits.length === 1 ? "" : "s"}`}
        </div>
      )}
      <ListView<CommitSummary>
        label="Commits"
        className="commits"
        items={items}
        getKey={(c) => c.sha}
        selectedKey={selected?.detail.sha ?? null}
        onSelect={(c) => void selectCommit(c.sha)}
        menu={commitMenu}
        onEndReached={() => {
          if (!q && !done) void loadMore();
        }}
        render={(c) => <CommitRow c={c} />}
        empty={empty}
      />
    </>
  );
}

function FileHistoryList({ fh }: { fh: FileHistory }) {
  const openTab = useStore((s) => s.openTab);
  const activeTab = useStore((s) => s.activeTab);
  const close = useStore((s) => s.closeFileHistory);
  const loadMore = useStore((s) => s.loadMoreFileHistory);
  const { name, dir } = splitPath(fh.path);
  const tabOf = (e: FileHistoryEntry) => commitFileTab(e.file, e.commit, e.parent);
  const selected = fh.entries.find((e) => tabOf(e).id === activeTab)?.commit.sha ?? null;

  return (
    <>
      <div className="panel-toolbar file-history-head" title={fh.path}>
        <span className="ellipsis">
          History of <strong>{name}</strong>
          {dir && <span className="muted"> · {dir}</span>}
        </span>
        <button className="icon-button" title="Back to all commits" onClick={close}>
          ×
        </button>
      </div>
      <ListView<FileHistoryEntry>
        label={`History of ${fh.path}`}
        className="commits"
        items={fh.entries}
        getKey={(e) => e.commit.sha}
        selectedKey={selected}
        onSelect={(e, pin) => openTab(tabOf(e), pin)}
        menu={(e) => {
          const items = commitMenu(e.commit);
          return items && [{ label: "Show commit", run: () => void useStore.getState().selectCommit(e.commit.sha) }, { separator: true }, ...items];
        }}
        onEndReached={() => {
          if (!fh.done) void loadMore();
        }}
        render={(e) => (
          <CommitRow
            c={e.commit}
            extra={
              <span
                className={`status-letter k-${e.file.kind}`}
                title={e.file.origPath && e.file.origPath !== e.file.path ? `${e.file.origPath} → ${e.file.path}` : e.file.path}
              >
                {STATUS_LETTER[e.file.kind]}
              </span>
            }
          />
        )}
        empty={fh.error ? <span className="error-text">{fh.error}</span> : fh.done ? "No commits changed this file." : "Loading…"}
      />
    </>
  );
}
