import { useEffect, useMemo, useState } from "react";
import type { WorktreeInfo, WorktreeSummary } from "../api";
import { changeCountTitle } from "../lib/changes";
import { isoToUnix, relativeTime } from "../lib/format";
import { isActive, overlapsByWorktree, worktreeName, type ActivityEvent } from "../lib/worktrees";
import { useStore } from "../store";
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
  const overlaps = useMemo(() => overlapsByWorktree(overview?.overlaps ?? []), [overview]);
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

  const conflicts = overview?.overlaps.length ?? 0;
  return (
    <div className="ov-page">
      <div className="ov-head">
        <div>
          <h1>Worktrees</h1>
          <div className="muted">
            {repo.name} · {base ? <>compared with <b>{base}</b></> : "no base branch"} · {overview?.worktrees.length ?? "…"} worktrees
            {active > 0 && <> · <span className="ov-live-text">{active} active now</span></>}
            {conflicts > 0 && <> · <span className="ov-warn-text">{conflicts} possible conflict{conflicts === 1 ? "" : "s"}</span></>}
          </div>
        </div>
        <button className="ov-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh (F5)">
          <SyncIcon spin={loading} /> Refresh
        </button>
      </div>
      <div className="ov-body">
        {overviewError && <div className="banner error">{overviewError}</div>}
        {!overview && !overviewError && <div className="muted ov-none">Loading…</div>}
        {overview && (
          <>
            <section className="ov-cards">
              {overview.worktrees.map((w) => (
                <WorktreeCard key={w.path} w={w} info={info.get(w.path)} lastChange={lastChange[w.path]} now={now} overlaps={overlaps.get(w.path) ?? []} name={name} />
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
                Files that two worktrees both change, committed since {base ?? "the base"} or not committed yet. Committed files count only when the two
                versions differ and neither branch already contains the other.
              </p>
              {overview.overlaps.length === 0 ? (
                <div className="muted ov-none">No two worktrees change the same file.</div>
              ) : (
                overview.overlaps.map((o) => <OverlapRow key={`${o.a}|${o.b}`} a={o.a} b={o.b} files={o.files} name={name} summaries={overview.worktrees} />)
              )}
            </section>

            <section className="ov-section">
              <h2>Activity</h2>
              {activity.length === 0 ? (
                <div className="muted ov-none">Nothing yet. Commits, branch switches and newly changed files in any worktree show up here while Grove is open.</div>
              ) : (
                <ul className="ov-feed">
                  {activity.map((e, i) => (
                    <FeedRow key={`${e.at}-${i}`} e={e} name={name} now={now} />
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
  overlaps: { other: string; files: string[] }[];
  name: (path: string) => string;
}) {
  const { w, info, lastChange, now, overlaps, name } = props;
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const base = useStore((s) => s.base);
  const live = isActive(lastChange, now);
  const current = w.path === cwd && !viewBranch;
  const n = w.uncommitted.length;
  const shared = overlaps.reduce((sum, o) => sum + o.files.length, 0);

  return (
    <button className={`ov-card${current ? " current" : ""}`} onClick={() => void selectWorktree(w.path)} title={`Show ${info?.displayPath ?? w.path}`}>
      <div className="ov-card-title">
        <span className={`ov-dot${live ? " live" : ""}`} title={live ? "Files changing now" : lastChange ? "Quiet" : "No file changes seen this session"} />
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
        {shared > 0 && (
          <span className="ov-warn-text" title={overlaps.map((o) => `${o.files.length} with ${name(o.other)}`).join("\n")}>
            ⚠ {shared} shared file{shared === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
}

function OverlapRow(props: { a: string; b: string; files: string[]; name: (path: string) => string; summaries: WorktreeSummary[] }) {
  const { a, b, files, name, summaries } = props;
  const [open, setOpen] = useState(files.length <= 5);
  const dirty = (path: string) => new Set(summaries.find((w) => w.path === path)?.uncommitted.flatMap((f) => [f.path, f.origPath ?? ""]) ?? []);
  const [da, db] = [dirty(a), dirty(b)];
  const how = (d: Set<string>, f: string) => (d.has(f) ? <span className="k-modified">uncommitted</span> : <span className="muted">committed</span>);
  return (
    <div className="ov-overlap">
      <button className="ov-overlap-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ov-chevron">{open ? "▾" : "▸"}</span>
        <b>{name(a)}</b> ↔ <b>{name(b)}</b>
        <span className="muted">
          · {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <ul className="ov-overlap-files">
          {files.map((f) => (
            <li key={f}>
              <span className="ov-file">{f}</span>
              <span className="ov-sides">
                {name(a)}: {how(da, f)} · {name(b)}: {how(db, f)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_MARK: Record<ActivityEvent["kind"], string> = { commit: "●", moved: "↷", branch: "⑂", editing: "✎", added: "+", removed: "−" };

function FeedRow({ e, name, now }: { e: ActivityEvent; name: (path: string) => string; now: number }) {
  return (
    <li className={`ov-event ev-${e.kind}`}>
      <span className="ov-event-mark">{KIND_MARK[e.kind]}</span>
      <span className="ov-event-who">{name(e.path)}</span>
      <span className="ov-event-text">{e.text}</span>
      <span className="muted ov-event-time">{relativeTime(e.at / 1000, now / 1000)}</span>
    </li>
  );
}
