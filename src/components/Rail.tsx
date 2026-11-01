import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { shortTime } from "../lib/format";
import { isMenuKey } from "../lib/menu";
import { changeCountTitle } from "../lib/changes";
import { railLabels, railRows, railTitle, railVisible, sharedTitle, splitRail, STATE_MARK, type RailRow } from "../lib/rail";
import { clampRail, isNarrow } from "../lib/shell";
import { useNow } from "../lib/useNow";
import { STATE_LABEL } from "../lib/worktrees";
import { worktreeMenu } from "../menuEnv";
import { useStore } from "../store";
import { Button, Count, Delta, Empty, EmptyLine, Field, MainTreeMark, Mark, menuAtElement, menuAtPointer, Resizer, Row, Skeleton, Toggle, WarnMark } from "../ui";
import { foldRail } from "./foldRail";
import type { IconName } from "./Icon";
import { dragWidth, nudgeWidth } from "./paneWidth";
import { RepoPicker } from "./RepoPicker";

export const WELCOME = { title: "No repository open", text: "Use the Repository menu at the top left to add a folder. Windows paths and WSL paths (\\\\wsl.localhost\\…) both work." };

/** The rail shows icons when the window is too narrow for it, or when collapsed by hand. The choice survives narrow windows. */
export const railIcons = (s: { appWidth: number; settings: { railCollapsed: boolean } }) => isNarrow(s.appWidth) || s.settings.railCollapsed;

const railLoading = (s: { settingsLoaded: boolean; settings: { lastRepo: string | null }; repoError: string | null; worktrees: readonly unknown[] }) => !s.settingsLoaded || (!!s.settings.lastRepo && !s.repoError && s.worktrees.length === 0);

/** Collapses the rail on wide windows; below 1100px the rail is icons anyway, so it is not offered. */
function FoldButton({ label, className }: { label: string; className?: string }) {
  const collapsed = useStore((s) => s.settings.railCollapsed);
  return <Button kind="ghost" icon="layout-sidebar-left" label={label} tip={`${label} (Ctrl+B)`} className={className} aria-controls="rail" aria-expanded={!collapsed} onClick={foldRail} />;
}

function RailTop({ icons }: { icons: boolean }) {
  const setPalette = useStore((s) => s.setPalette);
  return (
    <div className="rail-top" data-tauri-drag-region="deep">
      <RepoPicker />
      {!icons && (
        <>
          <Button kind="ghost" icon="search" label="Search" tip="Search (Ctrl+K)" onClick={() => setPalette("all")} />
          <FoldButton label="Collapse sidebar" />
        </>
      )}
    </div>
  );
}

function Nav({ icon, label, tip, on, onClick }: { icon: IconName; label: string; tip: string; on?: boolean; onClick: () => void }) {
  return <Toggle icon={icon} text={label} tip={tip} aria-label={label} on={on} className="rail-nav" onClick={onClick} />;
}

function WorktreeRow({ row, icons, on, menu, now, onMenu }: { row: RailRow; icons: boolean; on: boolean; menu: boolean; now: number; onMenu: (e: MouseEvent) => void }) {
  const selectWorktree = useStore((s) => s.selectWorktree);
  const { worktree: w, changed, shared, state, added, removed, off } = row;
  const rejected = state === "rejected";
  const { title, sub } = railLabels(row);
  return (
    <Row
      className={off ? "wt off" : "wt"}
      tabIndex={0}
      on={on}
      menu={menu}
      disabled={off ?? undefined}
      title={off ? undefined : railTitle(row, icons)}
      aria-label={icons || w.isMain ? `${row.name}, ${STATE_LABEL[state]}` : undefined}
      data-path={w.path}
      lead={<Mark state={STATE_MARK[state]} />}
      trail={
        (shared > 0 || changed > 0) && (
          <>
            {shared > 0 && <WarnMark n={shared} title={sharedTitle(shared)} />}
            {changed > 0 && <Count n={changed} title={changeCountTitle(changed)} />}
          </>
        )
      }
      onClick={() => void selectWorktree(w.path)}
      onContextMenu={onMenu}
    >
      <span className="wt-name">
        <span className="n ell">{title}</span>
        {w.isMain && <MainTreeMark />}
        {row.last !== null && <span className="wt-time num">{shortTime(row.last, now)}</span>}
      </span>
      <span className="wt-sub">
        <span className={rejected ? "d ell err-note" : "d ell"}>{rejected ? STATE_LABEL.rejected : sub}</span>
        {added + removed > 0 && <Delta add={added} del={removed} />}
      </span>
    </Row>
  );
}

const SKELETON = [1, 2, 3, 4, 5, 6];

/** The list's header: its name and size, which give way to the filter while filtering. */
function WorktreesHead({ n, searching, query, changesOnly, onSearching, onQuery, onChangesOnly }: { n: number; searching: boolean; query: string; changesOnly: boolean; onSearching: (on: boolean) => void; onQuery: (q: string) => void; onChangesOnly: (on: boolean) => void }) {
  const close = () => {
    onQuery("");
    onSearching(false);
  };
  return (
    <div className="rail-filter">
      {searching ? (
        <Field
          quiet
          autoFocus
          placeholder="Filter worktrees"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onBlur={() => !query.trim() && close()}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
            document.querySelector<HTMLElement>(".rail-filter .btn")?.focus();
          }}
        />
      ) : (
        <>
          <span className="rail-sec">Worktrees</span>
          <span className="rail-sec-n num">{n}</span>
        </>
      )}
      {/* Keeps the field's focus on press, so its blur cannot close it and this click open it again. */}
      <Toggle size="sm" icon="search" label="Filter worktrees" tip="Filter worktrees" on={searching} onMouseDown={(e) => e.preventDefault()} onClick={() => (searching ? close() : onSearching(true))} />
      <Toggle size="sm" icon="diff" label="Show only worktrees with changes" tip="Has changes" tone="changes" on={changesOnly} onClick={() => onChangesOnly(!changesOnly)} />
    </div>
  );
}

function WorktreeList({ icons }: { icons: boolean }) {
  const worktrees = useStore((s) => s.worktrees);
  const overview = useStore((s) => s.overview);
  const changeCounts = useStore((s) => s.changeCounts);
  const lastChange = useStore((s) => s.lastChange);
  const actions = useStore((s) => s.actions);
  const cwd = useStore((s) => s.cwd);
  const atWork = useStore((s) => s.view === "work");
  const loading = useStore(railLoading);
  const now = useNow(5_000);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);

  const all = useMemo(() => railRows({ worktrees, overview, changeCounts, lastChange, actions }, now), [worktrees, overview, changeCounts, lastChange, actions, now]);
  const { main, others } = splitRail(all);
  const { rows, none } = railVisible(others, { query, changesOnly, icons, open: atWork ? cwd : null });

  const clear = () => {
    setQuery("");
    setChangesOnly(false);
    document.querySelector<HTMLElement>(".rail-filter input")?.focus();
  };

  const row = (r: RailRow) => (
    <WorktreeRow
      key={r.worktree.path}
      row={r}
      icons={icons}
      on={atWork && r.worktree.path === cwd}
      menu={menuPath === r.worktree.path}
      now={now}
      onMenu={(e) => {
        setMenuPath(r.worktree.path);
        menuAtPointer(e, worktreeMenu(r.worktree), () => setMenuPath(null));
      }}
    />
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const focused = (e.target as Element).closest<HTMLElement>(".wt");
    if (!focused) return;
    const list = [...e.currentTarget.querySelectorAll<HTMLElement>(".wt")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") list[Math.max(0, Math.min(list.length - 1, list.indexOf(focused) + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    else if (e.key === "Enter" || e.key === " ") focused.click();
    else if (isMenuKey(e)) {
      const r = all.find((x) => x.worktree.path === focused.dataset.path);
      if (!r) return;
      setMenuPath(r.worktree.path);
      menuAtElement(focused, worktreeMenu(r.worktree), () => setMenuPath(null));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (loading)
    return (
      <div className="rail-list" aria-hidden="true">
        {SKELETON.map((i) => (
          <Row key={i} role="presentation" className="wt skel" lead={<Skeleton width="16px" height={16} />}>
            <span className="wt-name">
              <Skeleton width="55%" />
            </span>
            <span className="wt-sub">
              <Skeleton width="80%" />
            </span>
          </Row>
        ))}
      </div>
    );

  return (
    // Arrow keys walk main and the list as one, so the handler sits above both.
    <div className="rail-worktrees" onKeyDown={onKeyDown}>
      {main && (
        <div className="rail-pinned" role="listbox" aria-label="Main worktree">
          {row(main)}
        </div>
      )}
      {!icons && others.length > 0 && <WorktreesHead n={others.length} searching={searching} query={query} changesOnly={changesOnly} onSearching={setSearching} onQuery={setQuery} onChangesOnly={setChangesOnly} />}
      {others.length > 0 && (
        <div className="rail-list" role="listbox" aria-label={`Worktrees (${others.length})`}>
          {rows.map(row)}
          {none && <EmptyLine action={<Button kind="link" text="Clear filter" onClick={clear} />}>{query.trim() ? "No worktrees match." : "No worktrees have changes."}</EmptyLine>}
        </div>
      )}
    </div>
  );
}

/** The left edge of the shell: repository, Overview, the worktrees, Settings. It runs full height. */
export function Rail() {
  const icons = useStore(railIcons);
  const width = useStore((s) => s.settings.railWidth);
  const narrow = useStore((s) => isNarrow(s.appWidth));
  const atOverview = useStore((s) => s.view === "overview");
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setView = useStore((s) => s.setView);
  const openSettings = useStore((s) => s.openSettings);
  const setPalette = useStore((s) => s.setPalette);
  const noRepo = useStore((s) => s.settingsLoaded && !s.settings.lastRepo && !s.repo);

  return (
    <aside className="rail ui-root" id="rail" data-compact={icons ? "" : undefined} style={{ "--rail-w": `${width}px` } as CSSProperties}>
      <Resizer label="Resize the sidebar" onMouseDown={(e) => dragWidth(e, "railWidth", clampRail)} onKeyDown={(e) => nudgeWidth(e, "railWidth", clampRail)} />
      <RailTop icons={icons} />
      <div>
        <Nav icon="home" label="Overview" tip="Overview (Ctrl+Shift+O)" on={atOverview} onClick={() => setView("overview")} />
        {icons && <Nav icon="search" label="Search" tip="Search (Ctrl+K)" onClick={() => setPalette("all")} />}
      </div>
      {noRepo && !icons ? <Empty {...WELCOME} /> : <WorktreeList icons={icons} />}
      <div className="rail-foot">
        {icons && !narrow && <FoldButton label="Expand sidebar" className="rail-nav" />}
        <Nav icon="gear" label="Settings" tip="Settings (Ctrl+,)" on={settingsOpen} onClick={() => openSettings()} />
      </div>
    </aside>
  );
}
