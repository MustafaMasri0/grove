import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { worktreeItems } from "../lib/contextMenus";
import { shortTime } from "../lib/format";
import { canReveal } from "../lib/hostPaths";
import { isMenuKey } from "../lib/menu";
import { railRows, railTitle, railVisible, sharedTitle, STATE_MARK, type RailRow } from "../lib/rail";
import { clampRail, isNarrow } from "../lib/shell";
import { useNow } from "../lib/useNow";
import { STATE_LABEL } from "../lib/worktrees";
import { menuEnv } from "../menuEnv";
import { useStore } from "../store";
import { Button, Count, Delta, Empty, EmptyLine, Field, Mark, menuAtElement, menuAtPointer, Resizer, Row, Skeleton, Toggle, WarnMark } from "../ui";
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
  const hasRepo = useStore((s) => !!s.repo);
  const setQuickOpen = useStore((s) => s.setQuickOpen);
  return (
    <div className="rail-top" data-tauri-drag-region="deep">
      <RepoPicker />
      {!icons && (
        <>
          <Button kind="ghost" icon="search" label="Search files" tip="Search files (Ctrl+P)" disabled={hasRepo ? undefined : "Add a repository first"} onClick={() => setQuickOpen(true)} />
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
  return (
    <Row
      className={off ? "wt off" : "wt"}
      tabIndex={0}
      on={on}
      menu={menu}
      disabled={off ?? undefined}
      title={off ? undefined : railTitle(row, icons)}
      aria-label={icons ? `${row.name}, ${STATE_LABEL[state]}` : undefined}
      data-path={w.path}
      lead={<Mark state={STATE_MARK[state]} />}
      trail={
        (shared > 0 || changed > 0) && (
          <>
            {shared > 0 && <WarnMark n={shared} title={sharedTitle(shared)} />}
            {changed > 0 && <Count n={changed} title={`${changed} changed file${changed === 1 ? "" : "s"}`} />}
          </>
        )
      }
      onClick={() => void selectWorktree(w.path)}
      onContextMenu={onMenu}
    >
      <span className="wt-name">
        <span className="n ell">{row.name}</span>
        {row.last !== null && <span className="wt-time num">{shortTime(row.last, now)}</span>}
      </span>
      <span className="wt-sub">
        <span className={rejected ? "d ell err-note" : "d ell"}>{rejected ? STATE_LABEL.rejected : row.branch}</span>
        {added + removed > 0 && <Delta add={added} del={removed} />}
      </span>
    </Row>
  );
}

const SKELETON = [1, 2, 3, 4, 5, 6];

function WorktreeList({ icons, query, changesOnly, onClear }: { icons: boolean; query: string; changesOnly: boolean; onClear: () => void }) {
  const repo = useStore((s) => s.repo);
  const worktrees = useStore((s) => s.worktrees);
  const overview = useStore((s) => s.overview);
  const changeCounts = useStore((s) => s.changeCounts);
  const lastChange = useStore((s) => s.lastChange);
  const actions = useStore((s) => s.actions);
  const cwd = useStore((s) => s.cwd);
  const atWork = useStore((s) => s.view === "work" && !s.settingsOpen);
  const loading = useStore(railLoading);
  const now = useNow(5_000);
  const [menuPath, setMenuPath] = useState<string | null>(null);

  const all = useMemo(() => railRows({ worktrees, overview, changeCounts, lastChange, actions }, now), [worktrees, overview, changeCounts, lastChange, actions, now]);
  const { rows, none } = railVisible(all, { query, changesOnly, icons, open: atWork ? cwd : null });

  const items = (r: RailRow) => worktreeItems(menuEnv, { path: r.worktree.displayPath, branch: r.worktree.branch, missing: r.worktree.missing, reveal: !!repo && canReveal(repo) });

  const onKeyDown = (e: KeyboardEvent) => {
    const row = (e.target as Element).closest<HTMLElement>(".wt");
    if (!row) return;
    const list = [...e.currentTarget.querySelectorAll<HTMLElement>(".wt")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") list[Math.max(0, Math.min(list.length - 1, list.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    else if (e.key === "Enter" || e.key === " ") row.click();
    else if (isMenuKey(e)) {
      const r = all.find((x) => x.worktree.path === row.dataset.path);
      if (!r) return;
      setMenuPath(r.worktree.path);
      menuAtElement(row, items(r), () => setMenuPath(null));
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
    <div className="rail-list" role="listbox" aria-label={`Worktree${worktrees.length > 1 ? ` (${worktrees.length})` : ""}`} onKeyDown={onKeyDown}>
      {rows.map((r) => (
        <WorktreeRow
          key={r.worktree.path}
          row={r}
          icons={icons}
          on={atWork && r.worktree.path === cwd}
          menu={menuPath === r.worktree.path}
          now={now}
          onMenu={(e) => {
            setMenuPath(r.worktree.path);
            menuAtPointer(e, items(r), () => setMenuPath(null));
          }}
        />
      ))}
      {none && <EmptyLine action={<Button kind="link" text="Clear filter" onClick={onClear} />}>{query.trim() ? "No worktrees match." : "No worktrees have changes."}</EmptyLine>}
    </div>
  );
}

/** The left edge of the shell: repository, Overview, the worktrees, Settings. It runs full height. */
export function Rail() {
  const icons = useStore(railIcons);
  const width = useStore((s) => s.settings.railWidth);
  const narrow = useStore((s) => isNarrow(s.appWidth));
  const atOverview = useStore((s) => s.view === "overview" && !s.settingsOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setView = useStore((s) => s.setView);
  const openSettings = useStore((s) => s.openSettings);
  const closeSettings = useStore((s) => s.closeSettings);
  const setQuickOpen = useStore((s) => s.setQuickOpen);
  const hasRepo = useStore((s) => !!s.repo);
  const noRepo = useStore((s) => s.settingsLoaded && !s.settings.lastRepo && !s.repo);
  const loading = useStore(railLoading);
  const [query, setQuery] = useState("");
  const [changesOnly, setChangesOnly] = useState(false);

  const clear = () => {
    setQuery("");
    setChangesOnly(false);
    document.querySelector<HTMLElement>(".rail-filter input")?.focus();
  };

  return (
    <aside className="rail ui-root" id="rail" data-compact={icons ? "" : undefined} data-bare={loading || noRepo ? "" : undefined} style={{ "--rail-w": `${width}px` } as CSSProperties}>
      <Resizer label="Resize the sidebar" onMouseDown={(e) => dragWidth(e, "railWidth", clampRail)} onKeyDown={(e) => nudgeWidth(e, "railWidth", clampRail)} />
      <RailTop icons={icons} />
      <div>
        <Nav icon="home" label="Overview" tip="Overview (Ctrl+Shift+O)" on={atOverview} onClick={() => setView("overview")} />
        {icons && <Nav icon="search" label="Search" tip="Search files (Ctrl+P)" onClick={() => hasRepo && setQuickOpen(true)} />}
      </div>
      <div className="rail-filter">
        <Field placeholder="Filter worktrees" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Toggle icon="diff" label="Show only worktrees with changes" tip="Has changes" tone="changes" on={changesOnly} onClick={() => setChangesOnly(!changesOnly)} />
      </div>
      {noRepo && !icons ? <Empty {...WELCOME} /> : <WorktreeList icons={icons} query={query} changesOnly={changesOnly} onClear={clear} />}
      <div className="rail-foot">
        {icons && !narrow && <FoldButton label="Expand sidebar" className="rail-nav" />}
        <Nav icon="gear" label="Settings" tip="Settings (Ctrl+,)" on={settingsOpen} onClick={() => (settingsOpen ? closeSettings() : openSettings())} />
      </div>
    </aside>
  );
}
