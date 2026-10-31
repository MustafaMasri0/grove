import { useMemo, useState, type FocusEvent, type ReactNode } from "react";
import { changeCountTitle } from "../lib/changes";
import { isoToUnix, relativeTime, shortSha, shortTime, splitPath } from "../lib/format";
import { STATE_MARK } from "../lib/rail";
import { useNow } from "../lib/useNow";
import { heldOrder, nextSort, ORIGIN_TEXT, overviewRows, sharedFiles, sortRows, STATE_LABEL, worktreeName, type ActivityEvent, type OverviewColumn, type OverviewRow, type SharedFile } from "../lib/worktrees";
import { useStore } from "../store";
import { Badge, Banner, Button, Checkbox, Chip, Count, Delta, Empty, EmptyLine, HelpTip, LoadingLine, PathLabel, Row, SortHeader, StateTag, StatusLetter, TableRow, WarnTriangle } from "../ui";
import { BaseSelect } from "./BaseSelect";
import { FileTypeIcon } from "./FileTypeIcon";
import { Icon, type IconName } from "./Icon";
import { railIcons, WELCOME } from "./Rail";
import "../overview.css";

/** At first, the conflicts list shows this many files. */
const SHOWN_FILES = 12;
/** At first, an Activity entry shows this many of its files. */
const SHOWN_EVENT_FILES = 3;

const KIND_ICON: Record<ActivityEvent["kind"], IconName> = { commit: "git-commit", moved: "sync", branch: "git-branch", editing: "edit", added: "add", removed: "remove" };

const NO_VALUE = <span className="muted">–</span>;

type NameOf = (path: string) => string;

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** The order to show: `sorted`, except that while `held` rows stay where they are. A new `sort` always applies at once. */
function useHeldOrder(sorted: readonly string[], held: boolean, sort: string): readonly string[] {
  const [shown, setShown] = useState({ order: sorted, sort });
  const order = held && shown.sort === sort ? heldOrder(shown.order, sorted) : sorted;
  if (shown.sort !== sort || order.join("\n") !== shown.order.join("\n")) setShown({ order, sort });
  return order;
}

/** The Worktrees overview: every worktree at a glance, what they both change, and what just happened. */
export function WorktreesPage() {
  const repo = useStore((s) => s.repo);
  const icons = useStore(railIcons);
  if (repo) return <Overview />;
  return (
    <div className="ov-page ui-root">
      <div className="page-band" data-tauri-drag-region="deep" />
      <Empty {...(icons ? WELCOME : { text: "Add a repository to see its worktrees." })} />
    </div>
  );
}

function Overview() {
  const worktrees = useStore((s) => s.worktrees);
  const overview = useStore((s) => s.overview);
  const overviewError = useStore((s) => s.overviewError);
  const base = useStore((s) => s.base);
  const lastChange = useStore((s) => s.lastChange);
  const actions = useStore((s) => s.actions);
  const activity = useStore((s) => s.activity);
  const possibleConflicts = useStore((s) => s.settings.possibleConflicts);
  const now = useNow(1000);

  const info = useMemo(() => new Map(worktrees.map((w) => [w.path, w])), [worktrees]);
  const name: NameOf = useMemo(() => (path) => worktreeName(info.get(path) ?? { path }), [info]);
  const shared = useMemo(() => (overview ? sharedFiles(overview.overlaps, overview.worktrees) : []), [overview]);
  const present = useMemo(() => new Set(overview?.worktrees.map((w) => w.path)), [overview]);
  const rows = useMemo(() => overviewRows({ summaries: overview?.worktrees ?? [], shared, lastChange, actions, nameOf: name }, now), [overview, shared, lastChange, actions, name, now]);
  const changing = rows.filter((r) => r.state === "changing").length;

  return (
    <div className="ov-page ui-root">
      <Head rows={overview ? rows : null} shared={shared.length} />
      {!base && (
        <div className="ov-note">
          <span className="ov-warn-text">no base branch: pick one to compare with</span>
        </div>
      )}
      <div className="ov">
        {overviewError && <Banner tone="error" text={overviewError} />}
        {!overview && !overviewError && <LoadingLine />}
        {overview && (
          <>
            <WorktreeTable rows={rows} errors={overview.errors} name={name} now={now} displayPath={(p) => info.get(p)?.displayPath ?? p} />
            <div className={possibleConflicts ? "ov-split" : "ov-split solo"}>
              {possibleConflicts && <PossibleConflicts shared={shared} name={name} />}
              <Activity activity={activity} name={name} now={now} present={present} live={changing > 0} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** `rows` is null until the overview has loaded. Coloured badges hide at zero. */
function Head({ rows, shared }: { rows: OverviewRow[] | null; shared: number }) {
  const possibleConflicts = useStore((s) => s.settings.possibleConflicts);
  const updateSettings = useStore((s) => s.updateSettings);
  const loadOverview = useStore((s) => s.loadOverview);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    await loadOverview();
    setLoading(false);
  };
  const inState = (state: OverviewRow["state"]) => rows?.filter((r) => r.state === state).length ?? 0;
  const changing = inState("changing");
  const rejected = inState("rejected");
  const changed = rows?.filter((r) => r.summary.changedFiles > 0).length ?? 0;

  return (
    <div className="ov-head" data-tauri-drag-region="deep">
      <h1>Overview</h1>
      {rows && (
        <div className="sum">
          <Badge className="b-all">{plural(rows.length, "worktree")}</Badge>
          {changing > 0 && <Badge tone="live" tip="Files changing now">{changing} active</Badge>}
          {changed > 0 && <Badge tone="changes">{changed} with changes</Badge>}
          {shared > 0 && (
            <Badge tone="warn" className="b-warn">
              <WarnTriangle />
              {shared} <span className="opt-long">possible </span>
              {shared === 1 ? "conflict" : "conflicts"}
            </Badge>
          )}
          {rejected > 0 && (
            <Badge tone="error" className="b-err">
              {rejected} <span className="opt-long">push </span>rejected
            </Badge>
          )}
        </div>
      )}
      <div className="ov-tools">
        <Checkbox text="Possible conflicts" tip="Look for files more than one worktree changes. When off, Grove runs none of the git commands this takes." checked={possibleConflicts} onChange={(e) => updateSettings({ possibleConflicts: e.target.checked })} />
        <span className="ov-base" data-tip="The branch every worktree is compared with (ahead/behind, shared files); remembered for this repository">
          <BaseSelect />
        </span>
        <Button className="ov-refresh" icon="sync" text="Refresh" tip="Refresh (F5)" disabled={loading && "Refresh (F5)"} loading={loading} onClick={() => void refresh()} />
      </div>
    </div>
  );
}

function WorktreeTable({ rows, errors, name, now, displayPath }: { rows: OverviewRow[]; errors: Record<string, string>; name: NameOf; now: number; displayPath: NameOf }) {
  const base = useStore((s) => s.base);
  const sort = useStore((s) => s.overviewSort);
  const setSort = useStore((s) => s.setOverviewSort);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const lastChange = useStore((s) => s.lastChange);
  const possibleConflicts = useStore((s) => s.settings.possibleConflicts);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const sorted = useMemo(() => sortRows(rows, sort).map((r) => r.summary.path), [rows, sort]);
  const order = useHeldOrder(sorted, hovered || focused, `${sort.key} ${sort.dir}`);
  const byPath = new Map(rows.map((r) => [r.summary.path, r]));

  // A click leaves focus in the table, so only keyboard focus holds the order: the pointer leaving must re-sort.
  const onFocus = (e: FocusEvent) => setFocused((e.target as Element).matches(":focus-visible"));
  const onBlur = (e: FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
  };

  const head = (key: OverviewColumn, text: string, className?: string, width?: string, tip?: string) => <SortHeader text={text} className={className} width={width} tip={tip} on={sort.key === key} dir={sort.dir} onSort={() => setSort(nextSort(sort, key))} />;

  return (
    <div className="ov-tbl" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={onFocus} onBlur={onBlur}>
      <table className="dt">
        <thead>
          <tr>
            {head("name", "Worktree", undefined, "18%")}
            {head("branch", "Branch", "opt-col", "14%")}
            {head("state", "State", undefined, "136px")}
            {head("files", "Files", "r", "64px")}
            {head("lines", "+/−", "r opt-col opt-col-2", "96px")}
            {head("origin", "Origin", "opt-col opt-col-2 opt-col-3", "118px")}
            {head("ahead", `↑↓ ${base ?? "base"}`, "r opt-col", "88px", base ?? undefined)}
            {head("conflicts", "Conflicts", "r", "92px")}
            {head("commit", "Last commit", "opt-col opt-col-2 opt-col-4")}
            {head("last", "Last", "r", "76px")}
          </tr>
        </thead>
        <tbody>
          {order.map((path) => {
            const r = byPath.get(path);
            return r && <WorktreeRow key={path} r={r} now={now} base={base} current={path === cwd && !viewBranch} lastChange={lastChange[path]} possibleConflicts={possibleConflicts} displayPath={displayPath(path)} onOpen={() => void selectWorktree(path)} />;
          })}
        </tbody>
      </table>
      {Object.keys(errors).length > 0 && (
        <div className="ov-errs">
          {Object.entries(errors).map(([path, error]) => (
            <div key={path} className="ov-err">
              <b className="ell">{name(path)}</b>
              <span className="err-text">{error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OriginCell({ r }: { r: OverviewRow }) {
  const o = r.origin;
  if (!o) return NO_VALUE;
  if (o.kind === "none") return <span className="muted">{ORIGIN_TEXT.none}</span>;
  if (o.kind === "sync")
    return (
      <span className="muted" data-tip={`Up to date with ${o.upstream}`}>
        {ORIGIN_TEXT.sync}
      </span>
    );
  return (
    <span data-tip={`Compared with ${o.upstream}`}>
      origin <b>↑{o.ahead}</b> <b>↓{o.behind}</b>
    </span>
  );
}

function originTip(r: OverviewRow) {
  const o = r.origin;
  return !o ? "" : o.kind === "diverged" ? `origin ↑${o.ahead} ↓${o.behind}` : ORIGIN_TEXT[o.kind];
}

interface WorktreeRowProps {
  r: OverviewRow;
  now: number;
  base: string | null;
  current: boolean;
  lastChange: number | undefined;
  possibleConflicts: boolean;
  displayPath: string;
  onOpen: () => void;
}

function WorktreeRow({ r, now, base, current, lastChange, possibleConflicts, displayPath, onOpen }: WorktreeRowProps) {
  const w = r.summary;
  const c = w.lastCommit;
  const details = [r.branch, originTip(r), c && `${c.subject} (${c.authorName})`].filter(Boolean).join(" · ");
  return (
    <TableRow onOpen={onOpen} data-path={w.path}>
      <td className="wname" data-tip={`Show ${displayPath}\n${details}`}>
        <span className="wn">
          <span className="ell">{r.name}</span>
          {current && <Chip>current</Chip>}
        </span>
      </td>
      <td className="opt-col muted">{r.branch}</td>
      <td>
        <StateTag state={STATE_MARK[r.state]} label={STATE_LABEL[r.state]} />
      </td>
      <td className="r num" data-tip={changeCountTitle(w.changedFiles)}>
        {w.changedFiles || "–"}
      </td>
      <td className="r opt-col opt-col-2">{w.linesAdded + w.linesRemoved ? <Delta add={w.linesAdded} del={w.linesRemoved} /> : "–"}</td>
      <td className="opt-col opt-col-2 opt-col-3 num">
        <OriginCell r={r} />
      </td>
      <td className="r num opt-col">
        {base && w.branch !== base ? (
          <span data-tip={`${w.baseAhead} commits not on ${base}, ${w.baseBehind} commits on ${base} not here`}>
            {w.baseAhead}/{w.baseBehind}
          </span>
        ) : (
          NO_VALUE
        )}
      </td>
      <td className="r">
        {possibleConflicts &&
          (r.shared ? (
            <Badge tone="warn" tip={`Also changed in ${r.sharedWith.join(", ")}`}>
              <WarnTriangle />
              {r.shared}
            </Badge>
          ) : (
            NO_VALUE
          ))}
      </td>
      <td className="opt-col opt-col-2 opt-col-4">
        {c ? (
          <div className="lc" data-tip={`${c.authorName} · ${shortSha(c.sha)}`}>
            <span className="ell">{c.subject}</span>
            <span className="muted num">{shortTime(isoToUnix(c.authorDate), now)}</span>
          </div>
        ) : (
          NO_VALUE
        )}
      </td>
      <td className="r muted num" data-tip={lastChange ? `files changed ${relativeTime(lastChange, now)}` : "no activity yet"}>
        {r.last === null ? "–" : shortTime(r.last, now)}
      </td>
    </TableRow>
  );
}

function PossibleConflicts({ shared, name }: { shared: SharedFile[]; name: NameOf }) {
  const base = useStore((s) => s.base);
  const [all, setAll] = useState(false);
  const hint = `Files that more than one worktree changes; click a worktree to open its change to the file. Each worktree's change is not committed yet, unless it is marked committed (on its branch, since ${base ?? "the base"}). Committed files count only when the versions differ and neither branch already contains the other.`;
  return (
    <section className="ov-pane">
      <h2>
        Possible conflicts <Count n={shared.length} />
        <HelpTip text={hint} />
      </h2>
      <div className="ov-scroll ov-shared">
        {shared.length === 0 ? (
          <EmptyLine>No two worktrees change the same file.</EmptyLine>
        ) : (
          (all ? shared : shared.slice(0, SHOWN_FILES)).map((f) => <SharedFileRow key={f.path} f={f} name={name} />)
        )}
        {shared.length > SHOWN_FILES && <Button kind="link" className="ov-more" text={all ? "Show fewer" : `Show all ${shared.length} files`} onClick={() => setAll(!all)} />}
      </div>
    </section>
  );
}

/** A file more than one worktree changes: its worktrees are chips, and a chip opens that worktree's change to it. */
function SharedFileRow({ f, name }: { f: SharedFile; name: NameOf }) {
  const { name: file } = splitPath(f.path);
  const open = useStore((s) => s.openWorktreeChange);
  return (
    <Row
      role="listitem"
      lead={<FileTypeIcon name={file} />}
      trail={f.worktrees.map((w) => (
        <Chip key={w.path} tip={`Open ${name(w.path)}'s change to ${file} (${w.uncommitted ? "not committed yet" : "committed, not on the base yet"})`} onClick={() => void open(w.path, f.path)}>
          {name(w.path)}
          {!w.uncommitted && <span className="cs">committed</span>}
        </Chip>
      ))}
    >
      <PathLabel path={f.path} />
    </Row>
  );
}

function Activity({ activity, name, now, present, live }: { activity: ActivityEvent[]; name: NameOf; now: number; present: ReadonlySet<string>; live: boolean }) {
  return (
    <section className="ov-pane">
      <h2>
        Activity
        {live && (
          <span className="live-note">
            <i className="pulse" />
            Live
          </span>
        )}
      </h2>
      <div className="ov-scroll ov-feed">
        {activity.length === 0 ? (
          <EmptyLine>Nothing yet. Commits, branch switches and file edits in any worktree show up here while Grove is open.</EmptyLine>
        ) : (
          activity.map((e) => <FeedRow key={`${e.at}-${e.path}-${e.kind}`} e={e} name={name} now={now} exists={present.has(e.path)} />)
        )}
      </div>
    </section>
  );
}

/** One Activity entry; its links open the worktree's commit or changes while the worktree still `exists`. */
function FeedRow({ e, name, now, exists }: { e: ActivityEvent; name: NameOf; now: number; exists: boolean }) {
  const openCommit = useStore((s) => s.openWorktreeCommit);
  const selectWorktree = useStore((s) => s.selectWorktree);
  let text: ReactNode;
  if (e.kind === "editing") text = `changed ${plural(e.files.length, "file")}`;
  else if (exists && (e.kind === "commit" || e.kind === "moved")) {
    const sha = e.sha;
    text = <Button kind="link" size="sm" className="ev-link" text={e.text} tip={`Show the commit in ${name(e.path)}'s History`} onClick={() => void openCommit(e.path, sha)} />;
  } else text = e.text;
  return (
    <div className="ev">
      <span className={e.kind === "editing" ? "ev-t edit" : "ev-t"}>
        <Icon name={KIND_ICON[e.kind]} size={12} />
      </span>
      {exists ? <Button kind="ghost" size="sm" className="ev-w" text={name(e.path)} onClick={() => void selectWorktree(e.path)} /> : <span className="ev-w gone ell">{name(e.path)}</span>}
      <span className="a ell">{text}</span>
      <span className="muted num">{shortTime(e.at, now)}</span>
      {e.kind === "editing" && <EventFiles e={e} name={name} exists={exists} />}
    </div>
  );
}

function EventFiles({ e, name, exists }: { e: Extract<ActivityEvent, { kind: "editing" }>; name: NameOf; exists: boolean }) {
  const openChange = useStore((s) => s.openWorktreeChange);
  const showDir = useStore((s) => s.settings.showFolderPath);
  const [all, setAll] = useState(false);
  const shown = all ? e.files : e.files.slice(0, SHOWN_EVENT_FILES);
  const label = (path: string, origPath?: string | null) => (showDir ? (origPath ? `${origPath} → ${path}` : path) : splitPath(path).name);
  return (
    <div className="ev-files">
      {shown.map((f) => {
        const inner = (
          <>
            <StatusLetter kind={f.kind} />
            <PathLabel path={label(f.path, f.origPath)} />
          </>
        );
        return exists ? (
          <Button key={f.path} kind="ghost" size="sm" className="ev-file" tip={`Open ${name(e.path)}'s change to ${f.path}`} after={inner} onClick={() => void openChange(e.path, f.path)} />
        ) : (
          <span key={f.path} className="ev-file">
            {inner}
          </span>
        );
      })}
      {e.files.length > shown.length && <Button kind="link" size="sm" className="ev-more" text={`${e.files.length - shown.length} more`} onClick={() => setAll(true)} />}
    </div>
  );
}
