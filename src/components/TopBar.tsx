import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { errorText } from "../api";
import { changeCountTitle } from "../lib/changes";
import { branchItems, repoItems, worktreeItems } from "../lib/contextMenus";
import { relativeTime, shortSha } from "../lib/format";
import { windowsPath } from "../lib/hostPaths";
import { useStore } from "../store";
import { menuEnv } from "./ContextMenu";
import { Dropdown, type DropdownItem } from "./Dropdown";
import { WindowControls } from "./WindowControls";
import { BranchIcon, GearIcon, PublishIcon, RepoIcon, SyncIcon, UpIcon, WorktreeIcon } from "./icons";

function RepoSwitcher() {
  const settings = useStore((s) => s.settings);
  const repos = useStore((s) => s.repos);
  const repo = useStore((s) => s.repo);
  const selectRepo = useStore((s) => s.selectRepo);
  const addRepo = useStore((s) => s.addRepo);
  const removeRepo = useStore((s) => s.removeRepo);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async (path: string, close: () => void) => {
    setError(null);
    try {
      await addRepo(path);
      setTyped("");
      close();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const items: DropdownItem[] = settings.repos.map((r) => {
    const info = repos[r];
    const name = info && "name" in info ? info.name : r.split(/[\\/]/).filter(Boolean).pop() ?? r;
    return {
      key: r,
      label: name,
      detail: info && "error" in info ? `⚠ ${info.error}` : r,
      search: `${name} ${r}`,
      current: repo?.id === r,
      menu: () => repoItems(menuEnv, { name, path: info && "root" in info ? windowsPath(info, info.root) : null, remove: () => removeRepo(r) }),
      trailing: (
        <button
          className="icon-button dd-remove"
          title="Remove from list"
          onClick={(e) => {
            e.stopPropagation();
            removeRepo(r);
          }}
        >
          ×
        </button>
      ),
    };
  });

  return (
    <Dropdown
      caption="Repository"
      value={repo ? repo.name : "Add a repository"}
      icon={<RepoIcon />}
      items={items}
      searchable
      placeholder="Filter repositories"
      width={230}
      title={repo?.id}
      onPick={(k) => void selectRepo(k)}
      footer={(close) => (
        <div className="repo-add">
          <button
            className="primary"
            onClick={async () => {
              const picked = await openDialog({ directory: true, multiple: false, title: "Choose a git repository folder" });
              if (typeof picked === "string") await add(picked, close);
            }}
          >
            Add repository folder…
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add(typed, close);
            }}
          >
            <input placeholder="or paste a path, e.g. \\wsl.localhost\Ubuntu\home\…" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </form>
          {error && <div className="error-text">{error}</div>}
        </div>
      )}
    />
  );
}

/** The uncommitted-changes badge of a worktree; nothing when it is clean or not counted yet. */
function ChangeBadge({ n }: { n: number | undefined }) {
  return n ? (
    <span className="badge change-badge" title={changeCountTitle(n)}>
      {n}
    </span>
  ) : null;
}

function WorktreeSwitcher() {
  const worktrees = useStore((s) => s.worktrees);
  const counts = useStore((s) => s.changeCounts);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const current = worktrees.find((w) => w.path === cwd);
  const label = (w: (typeof worktrees)[number]) => (w.branch ? w.branch : w.head ? `detached @ ${shortSha(w.head)}` : "bare");
  const name = (w: (typeof worktrees)[number]) => (w.isMain ? "main worktree" : w.path.split(/[\\/]/).pop() ?? w.path);

  const items: DropdownItem[] = worktrees.map((w) => ({
    key: w.path,
    label: (
      <>
        <span className="wt-name">{name(w)}</span> <span className="wt-branch">{label(w)}</span>
      </>
    ),
    detail: w.displayPath,
    trailing: <ChangeBadge n={counts[w.path]} />,
    search: `${name(w)} ${label(w)} ${w.path}`,
    current: w.path === cwd && !viewBranch,
    disabled: w.missing || w.bare,
    disabledReason: w.missing ? `Missing or prunable${w.prunable ? `: ${w.prunable}` : ""}` : w.bare ? "Bare repository" : undefined,
    menu: () => worktreeItems(menuEnv, { path: w.displayPath, branch: w.branch, missing: w.missing }),
  }));

  return (
    <Dropdown
      caption={`Worktree${worktrees.length > 1 ? ` (${worktrees.length})` : ""}`}
      value={current ? name(current) : "—"}
      icon={<WorktreeIcon />}
      items={items}
      searchable={worktrees.length > 6}
      placeholder="Filter worktrees"
      width={210}
      disabled={worktrees.length === 0}
      title={current?.displayPath}
      onPick={(k) => void selectWorktree(k)}
    />
  );
}

function BranchSwitcher() {
  const branches = useStore((s) => s.branches);
  const counts = useStore((s) => s.changeCounts);
  const worktrees = useStore((s) => s.worktrees);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectBranch = useStore((s) => s.selectBranch);
  const current = worktrees.find((w) => w.path === cwd);
  const value = viewBranch ? viewBranch.name : current?.branch ?? (current?.head ? `detached @ ${shortSha(current.head)}` : "—");

  const items: DropdownItem[] = branches.map((b) => {
    const wt = b.kind === "local" ? worktrees.find((w) => w.branch === b.name && !w.missing) : undefined;
    const isCurrent = viewBranch ? viewBranch.fullRef === b.fullRef : b.kind === "local" && current?.branch === b.name;
    return {
      key: b.fullRef,
      label: b.name,
      section: b.kind === "local" ? "Local branches" : "Remote branches",
      search: b.name,
      current: isCurrent,
      menu: () => branchItems(menuEnv, { name: b.name }),
      trailing: wt ? <ChangeBadge n={counts[wt.path]} /> : undefined,
      detail: wt ? `checked out in ${wt.isMain ? "main worktree" : wt.path.split(/[\\/]/).pop()}` : `${relativeTime(b.committerUnix)} · view only`,
    };
  });
  items.sort((a, b) => (a.section === b.section ? 0 : a.section === "Local branches" ? -1 : 1));

  return (
    <Dropdown
      caption={viewBranch ? "Branch (view only)" : "Branch"}
      value={value}
      icon={<BranchIcon />}
      items={items}
      searchable
      placeholder="Filter branches"
      width={240}
      disabled={branches.length === 0}
      onPick={(k) => {
        const b = branches.find((x) => x.fullRef === k);
        if (b) void selectBranch(b);
      }}
    />
  );
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() / 1000), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function ActionButton() {
  const bs = useStore((s) => s.branchStatus);
  const action = useStore((s) => s.action);
  const viewBranch = useStore((s) => s.viewBranch);
  const runAction = useStore((s) => s.runAction);
  const now = useNow(30_000);

  if (!bs) return <button className="tb-button action" disabled style={{ width: 230 }} />;

  const fetched = bs.lastFetched ? `Last fetched ${relativeTime(bs.lastFetched, now)}` : "Never fetched";
  let kind: "fetch" | "push" | "publish" = "fetch";
  let title = "Fetch origin";
  let caption = fetched;
  let icon = <SyncIcon spin={action.running} />;
  let pushBlocked: string | null = null;

  if (!bs.hasOrigin) pushBlocked = "This repository has no remote named origin.";
  else if (!bs.branch) pushBlocked = viewBranch ? "Remote branches cannot be pushed." : "HEAD is detached; there is no branch to push.";
  else if (viewBranch) pushBlocked = "Pushing is only available from a worktree that has this branch checked out.";
  else if (!bs.upstream || bs.upstreamGone) {
    kind = "publish";
    title = "Publish branch";
    caption = `Push ${bs.branch} to origin`;
    icon = <PublishIcon />;
  } else if (bs.behind > 0) {
    caption = `↓${bs.behind}${bs.ahead ? ` ↑${bs.ahead}` : ""} · ${fetched}`;
    pushBlocked = bs.ahead
      ? "The branch has diverged from origin; pushing would need a pull first (not available here)."
      : "The branch is behind origin; there is nothing to push.";
  } else if (bs.ahead > 0) {
    kind = "push";
    title = `Push origin ↑${bs.ahead}`;
    caption = fetched;
    icon = <UpIcon />;
  }

  if (action.running) {
    title = action.label;
    caption = action.progress || "Working…";
    icon = <SyncIcon spin />;
  }

  const needsSeparateFetch = kind !== "fetch" && bs.hasOrigin;
  return (
    <div className="action-group">
      <button
        className="tb-button action"
        disabled={action.running || (kind === "fetch" && !bs.hasOrigin)}
        title={pushBlocked && kind === "fetch" ? `Push unavailable: ${pushBlocked}` : undefined}
        onClick={() => void runAction(kind)}
        style={{ width: 230 }}
      >
        <span className="tb-icon">{icon}</span>
        <span className="tb-text">
          <span className="tb-value">{title}</span>
          <span className="tb-caption">{caption}</span>
        </span>
      </button>
      {needsSeparateFetch && !action.running && (
        <button className="tb-button fetch-only" title={`Fetch origin · ${fetched}`} onClick={() => void runAction("fetch")}>
          <SyncIcon />
        </button>
      )}
      {pushBlocked && kind === "fetch" && bs.hasOrigin && bs.branch && !action.running && <div className="push-reason">{pushBlocked}</div>}
    </div>
  );
}

export function TopBar() {
  const actionError = useStore((s) => s.action.error);
  const clear = useStore((s) => s.clearActionError);
  const openSettings = useStore((s) => s.openSettings);
  return (
    <>
      {/* Also the window's title bar: empty space drags it, a double-click maximizes. */}
      <header className="topbar" data-tauri-drag-region>
        <RepoSwitcher />
        <WorktreeSwitcher />
        <BranchSwitcher />
        <ActionButton />
        <span className="spacer" data-tauri-drag-region />
        <button className="tb-button tb-settings" title="Settings (Ctrl+,)" aria-label="Settings" onClick={openSettings}>
          <GearIcon />
        </button>
        <WindowControls />
      </header>
      {actionError && (
        <div className="banner error" role="alert">
          <pre>{actionError}</pre>
          <button className="icon-button" onClick={clear} title="Dismiss">
            ×
          </button>
        </div>
      )}
    </>
  );
}
