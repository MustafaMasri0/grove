import { useEffect, useState, type ReactNode } from "react";
import { api, type CommitSummary, type FileHistoryEntry } from "../api";
import { commitItems } from "../lib/contextMenus";
import { isoToUnix, relativeTime, splitPath } from "../lib/format";
import type { MenuItem } from "../lib/menu";
import { SEARCH_LIMIT, useStore, type FileHistory } from "../store";
import { commitFileTab } from "../tabs";
import { Button, Field, StatusLetter } from "../ui";
import { Avatar } from "./Avatar";
import { menuEnv } from "../menuEnv";
import { ListView, useCommitRowHeight, type ListRow } from "./ListView";

/** The commit list (or one file's commits); the selected commit opens in the commit pane next to it. */
export function HistoryPanel() {
  const fileHistory = useStore((s) => s.fileHistory);
  return <div className="pane-body history">{fileHistory ? <FileHistoryList fh={fileHistory} /> : <CommitList />}</div>;
}

function commitMenu(c: CommitSummary): MenuItem[] | null {
  const { repo, cwd, selectedCommit, githubRepo } = useStore.getState();
  if (!repo || !cwd) return null;
  // The full message is only loaded for the selected commit; others are asked for when copied.
  const message = () =>
    selectedCommit?.detail.sha === c.sha ? selectedCommit.detail.message : api.commit({ repo: repo.id, cwd }, c.sha).then((x) => x.detail.message);
  return commitItems(menuEnv, { sha: c.sha, subject: c.subject, message, github: githubRepo });
}

function commitRow(c: CommitSummary, trail?: ReactNode): ListRow {
  return {
    className: "commit",
    title: `${c.subject}\n${c.authorName} · ${c.authorDate}`,
    lead: <Avatar name={c.authorName} email={c.authorEmail} size={18} sha={c.sha} />,
    main: (
      <span className="cm">
        <span className="s ell">{c.subject}</span>
        <span className="m ell">
          {c.authorName} · {relativeTime(isoToUnix(c.authorDate))}
        </span>
      </span>
    ),
    trail,
  };
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
  const rowHeight = useCommitRowHeight();

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
  if (q) empty = current?.error ? <span className="err-text">{current.error}</span> : current ? "No commits match." : "Searching…";
  else empty = error ? <span className="err-text">{error}</span> : done ? "No commits." : "Loading…";

  return (
    <>
      <div className="filter-row">
        <Field
          search
          className="history-search"
          placeholder="Search history: message, author or SHA"
          label="Search history"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && text) {
              e.preventDefault();
              setText("");
            }
          }}
        />
      </div>
      {current && current.commits.length > 0 && (
        <div className="muted pane-note">
          {current.truncated ? `First ${SEARCH_LIMIT} matching commits` : `${current.commits.length} matching commit${current.commits.length === 1 ? "" : "s"}`}
        </div>
      )}
      <ListView<CommitSummary>
        label="Commits"
        className="commits"
        items={items}
        rowHeight={rowHeight}
        getKey={(c) => c.sha}
        selectedKey={selected?.detail.sha ?? null}
        onSelect={(c) => void selectCommit(c.sha)}
        menu={commitMenu}
        onEndReached={() => {
          if (!q && !done) void loadMore();
        }}
        render={(c) => commitRow(c)}
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
  const rowHeight = useCommitRowHeight();
  const tabOf = (e: FileHistoryEntry) => commitFileTab(e.file, e.commit, e.parent);
  const selected = fh.entries.find((e) => tabOf(e).id === activeTab)?.commit.sha ?? null;

  return (
    <>
      <div className="panel-toolbar file-history-head" title={fh.path}>
        <span className="ell">
          History of <strong>{name}</strong>
          {dir && <span className="muted"> · {dir}</span>}
        </span>
        <Button kind="ghost" size="sm" icon="close" label="Back to all commits" tip="Back to all commits" onClick={close} />
      </div>
      <ListView<FileHistoryEntry>
        label={`History of ${fh.path}`}
        className="commits"
        items={fh.entries}
        rowHeight={rowHeight}
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
        render={(e) =>
          commitRow(
            e.commit,
            <span title={e.file.origPath && e.file.origPath !== e.file.path ? `${e.file.origPath} → ${e.file.path}` : e.file.path}>
              <StatusLetter kind={e.file.kind} />
            </span>,
          )
        }
        empty={fh.error ? <span className="err-text">{fh.error}</span> : fh.done ? "No commits changed this file." : "Loading…"}
      />
    </>
  );
}
