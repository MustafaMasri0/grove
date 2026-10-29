import { useMemo, useState, type ReactNode } from "react";
import type { WorktreeInfo, WorktreeSummary } from "../api";
import { changeCountTitle } from "../lib/changes";
import { isoToUnix, relativeTime, shortSha, splitPath } from "../lib/format";
import { useNow } from "../lib/useNow";
import { isActive, sharedFiles, worktreeName, type ActivityEvent, type SharedFile } from "../lib/worktrees";
import { useStore } from "../store";
import { BaseSelect } from "./BaseSelect";
import { FileRow } from "./FileRow";
import { FileTypeIcon } from "./FileTypeIcon";
import { Icon } from "./Icon";

/** At first, the conflicts list shows this many files. */
const SHOWN_FILES = 12;
/** At first, an Activity entry shows this many of its files. */
const SHOWN_EVENT_FILES = 3;

const KIND_MARK: Record<ActivityEvent["kind"], string> = { commit: "●", moved: "↷", branch: "⑂", editing: "✎", added: "+", removed: "−" };

type NameOf = (path: string) => string;

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

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
  const [allShared, setAllShared] = useState(false);

  const info = useMemo(() => new Map(worktrees.map((w) => [w.path, w])), [worktrees]);
  const shared = useMemo(() => (overview ? sharedFiles(overview.overlaps, overview.worktrees) : []), [overview]);
  const present = useMemo(() => new Set(overview?.worktrees.map((w) => w.path)), [overview]);
  const name: NameOf = (path) => worktreeName(info.get(path) ?? { path });
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
            {shared.length > 0 && <> · <span className="ov-warn-text">{plural(shared.length, "shared file")}</span></>}
          </div>
        </div>
        <div className="ov-tools">
          <span title="The branch every worktree is compared with (ahead/behind, shared files); remembered for this repository">
            <BaseSelect />
          </span>
          <button className="ov-refresh" onClick={() => void refresh()} disabled={loading} title="Refresh (F5)">
            <Icon name="sync" className={loading ? "spin" : undefined} /> Refresh
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
                <WorktreeCard
                  key={w.path}
                  w={w}
                  info={info.get(w.path)}
                  lastChange={lastChange[w.path]}
                  now={now}
                  shared={shared.filter((f) => f.worktrees.some((x) => x.path === w.path))}
                  name={name}
                />
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
                <div className="muted ov-none">Nothing yet. Commits, branch switches and file edits in any worktree show up here while Grove is open.</div>
              ) : (
                <ul className="ov-feed">
                  {activity.map((e, i) => (
                    <FeedRow key={`${e.at}-${i}`} e={e} name={name} now={now} exists={present.has(e.path)} />
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
  name: NameOf;
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
        <Icon name="git-branch" /> {w.branch ?? (w.head ? `detached @ ${shortSha(w.head)}` : "no commits")}
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
          <span className="muted"> · {relativeTime(isoToUnix(w.lastCommit.authorDate), now)}</span>
        </div>
      )}
      <div className="ov-foot">
        <span className={live ? "ov-live-text" : "muted"}>{lastChange ? `files changed ${relativeTime(lastChange, now)}` : "no activity yet"}</span>
        {shared.length > 0 && (
          <span className="ov-warn-text" title={`Also changed in ${others.join(", ")}`}>
            ⚠ {plural(shared.length, "shared file")}
          </span>
        )}
      </div>
    </button>
  );
}

function SharedFileRow({ f, name }: { f: SharedFile; name: NameOf }) {
  const { name: file, dir } = splitPath(f.path);
  const open = useStore((s) => s.openWorktreeChange);
  return (
    <li className="ov-shared">
      <span className="file-row" title={f.path}>
        <FileTypeIcon name={file} />
        <span className="file-name">{file}</span>
        <span className="file-dir">{dir}</span>
      </span>
      <span className="ov-who">
        {f.worktrees.map((w) => (
          <button
            key={w.path}
            className="ov-who-chip"
            title={`Open ${name(w.path)}'s change to ${file} (${w.uncommitted ? "not committed yet" : "committed, not on the base yet"})`}
            onClick={() => void open(w.path, f.path)}
          >
            {name(w.path)}
            {!w.uncommitted && <span className="ov-who-state">committed</span>}
          </button>
        ))}
      </span>
    </li>
  );
}

/** One Activity entry; its links open the worktree's commit or changes while the worktree still `exists`. */
function FeedRow({ e, name, now, exists }: { e: ActivityEvent; name: NameOf; now: number; exists: boolean }) {
  const openCommit = useStore((s) => s.openWorktreeCommit);
  let text: ReactNode;
  if (e.kind === "editing") text = `changed ${plural(e.files.length, "file")}`;
  else if (exists && (e.kind === "commit" || e.kind === "moved")) {
    const sha = e.sha;
    text = (
      <button className="link" title={`Show the commit in ${name(e.path)}'s History`} onClick={() => void openCommit(e.path, sha)}>
        {e.text}
      </button>
    );
  } else text = e.text;
  return (
    <li className={`ov-event ev-${e.kind}`}>
      <span className="ov-event-mark">{KIND_MARK[e.kind]}</span>
      <span className="ov-event-who">{name(e.path)}</span>
      <span className="ov-event-text">{text}</span>
      <span className="muted ov-event-time">{relativeTime(e.at, now)}</span>
      {e.kind === "editing" && <EventFiles e={e} name={name} exists={exists} />}
    </li>
  );
}

function EventFiles({ e, name, exists }: { e: Extract<ActivityEvent, { kind: "editing" }>; name: NameOf; exists: boolean }) {
  const openChange = useStore((s) => s.openWorktreeChange);
  const [all, setAll] = useState(false);
  const shown = all ? e.files : e.files.slice(0, SHOWN_EVENT_FILES);
  return (
    <ul className="ov-event-files">
      {shown.map((f) => (
        <li key={f.path}>
          {exists ? (
            <button className="ov-file-link" title={`Open ${name(e.path)}'s change to ${f.path}`} onClick={() => void openChange(e.path, f.path)}>
              <FileRow path={f.path} origPath={f.origPath} kind={f.kind} />
            </button>
          ) : (
            <FileRow path={f.path} origPath={f.origPath} kind={f.kind} />
          )}
        </li>
      ))}
      {e.files.length > shown.length && (
        <li>
          <button className="link ov-more" onClick={() => setAll(true)}>
            {e.files.length - shown.length} more
          </button>
        </li>
      )}
    </ul>
  );
}
