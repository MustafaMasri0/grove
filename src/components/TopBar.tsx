import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRef, useState, type ReactNode } from "react";
import { errorText } from "../api";
import { changeCountTitle } from "../lib/changes";
import { branchItems, repoItems, worktreeItems } from "../lib/contextMenus";
import { relativeTime, shortSha } from "../lib/format";
import { canReveal, displayPath, sshAddress } from "../lib/hostPaths";
import { useNow } from "../lib/useNow";
import { isActive, sharedFiles, worktreeName } from "../lib/worktrees";
import { actionOf, useStore } from "../store";
import { menuEnv } from "../menuEnv";
import { Button, Count, Field, Picker, type PickerItem } from "../ui";
import { WindowControls } from "./WindowControls";
import { Icon } from "./Icon";

/** A top-bar switcher: a wide button that opens a Picker. `footer` gets what closes it. */
function Switcher(p: {
  caption: string;
  value: ReactNode;
  icon: ReactNode;
  items: PickerItem[];
  onPick: (key: string) => void;
  searchable?: boolean;
  placeholder?: string;
  footer?: (close: () => void) => ReactNode;
  disabled?: boolean;
  width?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <div className="tb-switcher">
      <button ref={button} className={`tb-button${open ? " open" : ""}`} disabled={p.disabled} onClick={() => setOpen(!open)} title={p.title} style={{ width: p.width }} aria-haspopup="listbox" aria-expanded={open}>
        <span className="tb-icon">{p.icon}</span>
        <span className="tb-text">
          <span className="tb-caption">{p.caption}</span>
          <span className="tb-value">{p.value}</span>
        </span>
        <span className="tb-chevron">▾</span>
      </button>
      {open && <Picker anchor={button.current} items={p.items} onPick={p.onPick} onClose={close} searchable={p.searchable} placeholder={p.placeholder} label={p.caption} width={440} footer={p.footer?.(close)} />}
    </div>
  );
}

function RepoSwitcher() {
  const settings = useStore((s) => s.settings);
  const repos = useStore((s) => s.repos);
  const repo = useStore((s) => s.repo);
  const selectRepo = useStore((s) => s.selectRepo);
  const addRepo = useStore((s) => s.addRepo);
  const removeRepo = useStore((s) => s.removeRepo);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ssh, setSsh] = useState<{ host: string; path: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  const add = async (path: string, close: () => void) => {
    setError(null);
    setConnecting(true);
    try {
      await addRepo(path);
      setTyped("");
      setSsh(null);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  };

  const items: PickerItem[] = settings.repos.map((r) => {
    const info = repos[r];
    const name = info && "name" in info ? info.name : r.split(/[\\/]/).filter(Boolean).pop() ?? r;
    return {
      key: r,
      label: name,
      detail: info && "error" in info ? `⚠ ${info.error}` : r,
      search: `${name} ${r}`,
      current: repo?.id === r,
      menu: () => repoItems(menuEnv, { name, path: info && "root" in info ? displayPath(info, info.root) : null, reveal: !!info && "root" in info && canReveal(info), remove: () => removeRepo(r) }),
      trailing: (
        <Button
          kind="ghost"
          size="sm"
          icon="close"
          label="Remove from list"
          className="mi-x"
          title="Remove from list"
          onClick={(e) => {
            e.stopPropagation();
            removeRepo(r);
          }}
        />
      ),
    };
  });

  return (
    <Switcher
      caption="Repository"
      value={repo ? repo.name : "Add a repository"}
      icon={<Icon name="root-folder" />}
      items={items}
      searchable
      placeholder="Filter repositories"
      width={230}
      title={repo?.id}
      onPick={(k) => void selectRepo(k)}
      footer={(close) => (
        <div className="repo-add">
          <Button
            kind="primary"
            text="Add repository folder…"
            onClick={async () => {
              const picked = await openDialog({ directory: true, multiple: false, title: "Choose a git repository folder" });
              if (typeof picked === "string") await add(picked, close);
            }}
          />
          <Button text="Connect over SSH…" onClick={() => setSsh(ssh ? null : { host: "", path: "" })} />
          {ssh && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (ssh.host.trim() && ssh.path.trim()) void add(sshAddress(ssh.host, ssh.path), close);
              }}
            >
              <Field autoFocus placeholder="user@host, or a name from ssh config" value={ssh.host} onChange={(e) => setSsh({ ...ssh, host: e.target.value })} />
              <Field placeholder="path, e.g. /home/user/src/example or ~/example" value={ssh.path} onChange={(e) => setSsh({ ...ssh, path: e.target.value })} />
              <Button kind="primary" type="submit" text={connecting ? "Connecting…" : "Connect"} disabled={connecting ? "Connecting…" : undefined} />
            </form>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add(typed, close);
            }}
          >
            <Field placeholder="or paste a path, or ssh://user@host/path" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </form>
          {error && <div className="error-text">{error}</div>}
        </div>
      )}
    />
  );
}

/** The uncommitted-changes badge of a worktree; nothing when it is clean or not counted yet. */
function ChangeBadge({ n }: { n: number | undefined }) {
  return n ? <Count n={n} title={changeCountTitle(n)} /> : null;
}

function WorktreeSwitcher() {
  const repo = useStore((s) => s.repo);
  const worktrees = useStore((s) => s.worktrees);
  const counts = useStore((s) => s.changeCounts);
  const lastChange = useStore((s) => s.lastChange);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const current = worktrees.find((w) => w.path === cwd);
  const label = (w: (typeof worktrees)[number]) => (w.branch ? w.branch : w.head ? `detached @ ${shortSha(w.head)}` : "bare");
  const now = useNow(5_000);

  const items: PickerItem[] = worktrees.map((w) => ({
    key: w.path,
    label: (
      <>
        <span className="wt-name">{worktreeName(w)}</span> <span className="wt-branch">{label(w)}</span>
      </>
    ),
    detail: w.displayPath,
    trailing: (
      <>
        {isActive(lastChange[w.path], now) && <span className="ov-dot live" title="Files changing now" />}
        <ChangeBadge n={counts[w.path]} />
      </>
    ),
    search: `${worktreeName(w)} ${label(w)} ${w.path}`,
    current: w.path === cwd && !viewBranch,
    disabled: w.missing || w.bare,
    disabledReason: w.missing ? `Missing or prunable${w.prunable ? `: ${w.prunable}` : ""}` : w.bare ? "Bare repository" : undefined,
    menu: () => worktreeItems(menuEnv, { path: w.displayPath, branch: w.branch, missing: w.missing, reveal: !!repo && canReveal(repo) }),
  }));

  return (
    <Switcher
      caption={`Worktree${worktrees.length > 1 ? ` (${worktrees.length})` : ""}`}
      value={current ? worktreeName(current) : "—"}
      icon={<Icon name="worktree" />}
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

  const items: PickerItem[] = branches.map((b) => {
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
      detail: wt ? `checked out in ${worktreeName(wt)}` : `${relativeTime(b.committerUnix)} · view only`,
    };
  });
  items.sort((a, b) => (a.section === b.section ? 0 : a.section === "Local branches" ? -1 : 1));

  return (
    <Switcher
      caption={viewBranch ? "Branch (view only)" : "Branch"}
      value={value}
      icon={<Icon name="git-branch" />}
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

function ActionButton() {
  const bs = useStore((s) => s.branchStatus);
  const action = useStore(actionOf);
  const viewBranch = useStore((s) => s.viewBranch);
  const runAction = useStore((s) => s.runAction);
  const now = useNow(30_000);

  if (!bs) return <button className="tb-button action" disabled style={{ width: 230 }} />;

  const fetched = bs.lastFetched ? `Last fetched ${relativeTime(bs.lastFetched, now)}` : "Never fetched";
  let kind: "fetch" | "push" | "publish" = "fetch";
  let title = "Fetch origin";
  let caption = fetched;
  let icon = <Icon name="sync" className={action.running ? "spin" : undefined} />;
  let pushBlocked: string | null = null;

  if (!bs.hasOrigin) pushBlocked = "This repository has no remote named origin.";
  else if (!bs.branch) pushBlocked = viewBranch ? "Remote branches cannot be pushed." : "HEAD is detached; there is no branch to push.";
  else if (viewBranch) pushBlocked = "Pushing is only available from a worktree that has this branch checked out.";
  else if (!bs.upstream || bs.upstreamGone) {
    kind = "publish";
    title = "Publish branch";
    caption = `Push ${bs.branch} to origin`;
    icon = <Icon name="cloud-upload" />;
  } else if (bs.behind > 0) {
    caption = `↓${bs.behind}${bs.ahead ? ` ↑${bs.ahead}` : ""} · ${fetched}`;
    pushBlocked = bs.ahead
      ? "The branch has diverged from origin; pushing would need a pull first (not available here)."
      : "The branch is behind origin; there is nothing to push.";
  } else if (bs.ahead > 0) {
    kind = "push";
    title = `Push origin ↑${bs.ahead}`;
    caption = fetched;
    icon = <Icon name="arrow-up" />;
  }

  if (action.running) {
    title = action.label;
    caption = action.progress || "Working…";
    icon = <Icon name="sync" className="spin" />;
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
          <Icon name="sync" />
        </button>
      )}
      {pushBlocked && kind === "fetch" && bs.hasOrigin && bs.branch && !action.running && <div className="push-reason">{pushBlocked}</div>}
    </div>
  );
}

/** Opens the Worktrees overview; shows how many files more than one worktree changes. */
function OverviewButton() {
  const setView = useStore((s) => s.setView);
  const shared = useStore((s) => (s.overview ? sharedFiles(s.overview.overlaps, s.overview.worktrees).length : 0));
  const repo = useStore((s) => s.repo);
  const title = `Worktrees overview (Ctrl+Shift+O)${shared ? ` · ${shared} file${shared === 1 ? "" : "s"} changed in more than one worktree` : ""}`;
  return (
    <button className="tb-button tb-settings tb-overview" title={title} aria-label={title} onClick={() => setView("overview")} disabled={!repo}>
      <Icon name="extensions" />
      {shared > 0 && <span className="tb-warn">{shared}</span>}
    </button>
  );
}

export function TopBar() {
  const actionError = useStore((s) => actionOf(s).error);
  const clear = useStore((s) => s.clearActionError);
  const openSettings = useStore((s) => s.openSettings);
  return (
    <>
      {/* Also the window's title bar: empty space drags it, a double-click maximizes. */}
      <header className="topbar" data-tauri-drag-region>
        <RepoSwitcher />
        <WorktreeSwitcher />
        <OverviewButton />
        <BranchSwitcher />
        <ActionButton />
        <span className="spacer" data-tauri-drag-region />
        <button className="tb-button tb-settings" title="Settings (Ctrl+,)" aria-label="Settings" onClick={openSettings}>
          <Icon name="gear" />
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
