import { useEffect, useMemo, useState } from "react";
import type { WorktreeInfo, WorktreeSummary } from "../api";
import { changeCountTitle } from "../lib/changes";
import { isoToUnix, relativeTime, splitPath, STATUS_TITLE } from "../lib/format";
import { isActive, LISTED_FILES, sharedFiles, worktreeName, type ActivityEvent, type SharedFile } from "../lib/worktrees";
import { useStore } from "../store";
import { BaseSelect } from "./BaseSelect";
import { FileRow, StatusLetter } from "./FileRow";
import { BranchIcon, SyncIcon } from "./icons";

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/** The Worktrees overview: every worktree at a glance, what they both change, and what just happened. */
export function WorktreesPage() {
  const repo = useStore((s) => s.repo);
  const worktrees = useStore((s) => s.worktrees);
  const overview = useStore((s) => s.overview);
  const overviewError = useStore((s) => s.overviewError);
  const base = useStore((s) => s.base);
  const lastChange = useStore((s) => s.lastChange);
  const activity = useStore((s) => s.activity);
  const loadOverview = useStore((s) => s.loadOverview);
  const now = useNow(1000);
  const [loading, setLoading] = useState(false);

  const info = useMemo(() => new Map(worktrees.map((w) => [w.path, w])), [worktrees]);
  const name = (path: string) => worktreeName(info.get(path) ?? { path });
  const shared = useMemo(() => (overview ? sharedFiles(overview.overlaps, overview.worktrees) : []), [overview]);
  const [allShared, setAllShared] = useState(false);
  const active = (overview?.worktrees ?? []).filter((w) => isActive(lastChange[w.path], now)).length;

  if (!repo)
    return (
      <div className="ov-page">
        <div className="editor-empty">Add a repository to see its worktrees.</div>
      </div>
    );

  const refresh = async () => {
    setLoading(true);
    await loadOverview();
    setLoading(false);
  };

  return (
    <div className="ov-page">
      <div className="ov-head">
        <div>
          <h1>Worktrees</h1>
          <div className="muted">
            {repo.name} · {overview?.worktrees.length ?? "…"} worktrees
            {!base && <> · <span className="ov-warn-text">no base branch: pick one to compare with</span></>}
            {active > 0 && <> · <span className="ov-live-text">{active} active now</span></>}
            {shared.length > 0 && <> · <span className="ov-warn-text">{shared.length} shared file{shared.length === 1 ? "" : "s"}</span></>}
          </div>
        </div>
        <div className="ov-tools">
          <span title="The branch every worktree is compared with (ahead/behind, shared files); remembered for this repository">
            <BaseSelect />
          </span>
          <button className="ov-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh (F5)">
            <SyncIcon spin={loading} /> Refresh
          </button>
        </div>
      </div>
      <div className="ov-body">
        {overviewError && <div className="banner error">{overviewError}</div>}
        {!overview && !overviewError && <div className="muted ov-none">Loading…</div>}
        {overview && (
          <>
            <section className="ov-cards">
              {overview.worktrees.map((w) => (
                <WorktreeCard key={w.path} w={w} info={info.get(w.path)} lastChange={lastChange[w.path]} now={now} shared={shared.filter((f) => f.worktrees.some((x) => x.path === w.path))} name={name} />
              ))}
              {Object.entries(overview.errors).map(([path, error]) => (
                <div key={path} className="ov-card ov-card-error">
                  <div className="ov-card-title">{name(path)}</div>
                  <div className="error-text">{error}</div>
                </div>
              ))}
            </section>

            <section className="ov-section">
              <h2>Possible conflicts</h2>
              <p className="muted ov-hint">
                Files that more than one worktree changes; click a worktree to open its change to the file. Each worktree's change is not committed yet, unless it is marked{" "}
                <span className="ov-who-state">committed</span> (on its branch, since {base ?? "the base"}). Committed files count only when the
                versions differ and neither branch already contains the other.
              </p>
              {shared.length === 0 ? (
                <div className="muted ov-none">No two worktrees change the same file.</div>
              ) : (
                <>
                  <ul className="ov-shared-list">
                    {(allShared ? shared : shared.slice(0, SHOWN_FILES)).map((f) => (
                      <SharedFileRow key={f.path} f={f} name={name} />
                    ))}
                  </ul>
                  {shared.length > SHOWN_FILES && (
                    <button className="link ov-more" onClick={() => setAllShared(!allShared)}>
                      {allShared ? "Show fewer" : `Show all ${shared.length} files`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="ov-section">
              <h2>Activity</h2>
              {activity.length === 0 ? (
                <div className="muted ov-none">Nothing yet. Commits, branch switches and newly changed files in any worktree show up here while Grove is open.</div>
              ) : (
                <ul className="ov-feed">
                  {activity.map((e, i) => (
                    <FeedRow key={`${e.at}-${i}`} e={e} name={name} now={now} exists={overview.worktrees.some((w) => w.path === e.path)} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function WorktreeCard(props: {
  w: WorktreeSummary;
  info: WorktreeInfo | undefined;
  lastChange: number | undefined;
  now: number;
  /** The shared files this worktree is one of. */
  shared: SharedFile[];
  name: (path: string) => string;
}) {
  const { w, info, lastChange, now, shared, name } = props;
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const base = useStore((s) => s.base);
  const live = isActive(lastChange, now);
  const current = w.path === cwd && !viewBranch;
  const n = w.uncommitted.length;
  const others = [...new Set(shared.flatMap((f) => f.worktrees.map((x) => x.path)).filter((p) => p !== w.path))].map(name);

  return (
    <button className={`ov-card${current ? " current" : ""}`} onClick={() => void selectWorktree(w.path)} title={`Show ${info?.displayPath ?? w.path}`}>
      <div className="ov-card-title">
        {live && <span className="ov-dot live" title="Files changing now" />}
        <span className="ov-name">{name(w.path)}</span>
        {current && <span className="ov-chip">current</span>}
      </div>
      <div className="ov-branch">
        <BranchIcon /> {w.branch ?? (w.head ? `detached @ ${w.head.slice(0, 7)}` : "no commits")}
      </div>
      <div className="ov-stats">
        <span className={n ? "k-modified" : "muted"} title={changeCountTitle(n)}>
          {n ? `${n} uncommitted` : "clean"}
        </span>
        {base && w.branch !== base && (
          <span title={`${w.baseAhead} commits not on ${base}, ${w.baseBehind} commits on ${base} not here`}>
            vs {base} <b>↑{w.baseAhead}</b> <b>↓{w.baseBehind}</b>
          </span>
        )}
        {w.upstream ? (
          w.upstreamAhead || w.upstreamBehind ? (
            <span title={`Compared with ${w.upstream}`}>
              origin <b>↑{w.upstreamAhead}</b> <b>↓{w.upstreamBehind}</b>
            </span>
          ) : (
            <span className="muted" title={`Up to date with ${w.upstream}`}>
              in sync
            </span>
          )
        ) : (
          w.branch && <span className="muted">not published</span>
        )}
      </div>
      {w.lastCommit && (
        <div className="ov-commit" title={`${w.lastCommit.authorName} · ${w.lastCommit.sha}`}>
          <span className="ov-commit-subject">{w.lastCommit.subject}</span>
          <span className="muted"> · {relativeTime(isoToUnix(w.lastCommit.authorDate), now / 1000)}</span>
        </div>
      )}
      <div className="ov-foot">
        <span className={live ? "ov-live-text" : "muted"}>{lastChange ? `files changed ${relativeTime(lastChange / 1000, now / 1000)}` : "no activity yet"}</span>
        {shared.length > 0 && (
          <span className="ov-warn-text" title={`Also changed in ${others.join(", ")}`}>
            ⚠ {shared.length} shared file{shared.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
}

/** At first, the conflicts list shows this many files. */
const SHOWN_FILES = 12;

function SharedFileRow({ f, name }: { f: SharedFile; name: (path: string) => string }) {
  const file = splitPath(f.path).name;
  const open = useStore((s) => s.openWorktreeChange);
  return (
    <li className="ov-shared">
      <FileRow path={f.path} kind={f.kind} />
      <span className="ov-who">
        {f.worktrees.map((w) => (
          <button
            key={w.path}
            className="ov-who-chip"
            title={`Open ${name(w.path)}'s change to ${file} (${STATUS_TITLE[w.kind].toLowerCase()}, ${w.uncommitted ? "not committed yet" : "committed, not on the base yet"})`}
            onClick={() => void open(w.path, f.path)}
          >
            {name(w.path)}
            {!w.uncommitted && <span className="ov-who-state">committed</span>}
            {!f.kind && <StatusLetter kind={w.kind} />}
          </button>
        ))}
      </span>
    </li>
  );
}

const KIND_MARK: Record<ActivityEvent["kind"], string> = { commit: "●", moved: "↷", branch: "⑂", editing: "✎", added: "+", removed: "−" };

function FeedRow({ e, name, now, exists }: { e: ActivityEvent; name: (path: string) => string; now: number; exists: boolean }) {
  const openChange = useStore((s) => s.openWorktreeChange);
  const openCommit = useStore((s) => s.openWorktreeCommit);
  const [all, setAll] = useState(false);
  let text: React.ReactNode = e.text;
  if (exists && e.files) {
    const shown = all ? e.files : e.files.slice(0, LISTED_FILES);
    text = (
      <>
        changed{" "}
        {shown.map((f, i) => (
          <span key={f}>
            {i > 0 && ", "}
            <button className="link" title={`Open ${name(e.path)}'s change to ${f}`} onClick={() => void openChange(e.path, f)}>
              {splitPath(f).name}
            </button>
          </span>
        ))}
        {e.files.length > shown.length && (
          <>
            {" and "}
            <button className="link" onClick={() => setAll(true)}>
              {e.files.length - shown.length} more
            </button>
          </>
        )}
      </>
    );
  } else if (exists && e.sha) {
    const sha = e.sha;
    text = (
      <button className="link" title={`Show the commit in ${name(e.path)}'s History`} onClick={() => void openCommit(e.path, sha)}>
        {e.text}
      </button>
    );
  }
  return (
    <li className={`ov-event ev-${e.kind}`}>
      <span className="ov-event-mark">{KIND_MARK[e.kind]}</span>
      <span className="ov-event-who">{name(e.path)}</span>
      <span className="ov-event-text">{text}</span>
      <span className="muted ov-event-time">{relativeTime(e.at / 1000, now / 1000)}</span>
    </li>
  );
}
