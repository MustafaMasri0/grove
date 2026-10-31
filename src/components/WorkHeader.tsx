import { useRef, useState } from "react";
import { branchAction } from "../lib/branchAction";
import { changeCountTitle } from "../lib/changes";
import { branchItems } from "../lib/contextMenus";
import { relativeTime } from "../lib/format";
import { branchLabel } from "../lib/rail";
import { isNarrow } from "../lib/shell";
import { useNow } from "../lib/useNow";
import { worktreeName } from "../lib/worktrees";
import { menuEnv } from "../menuEnv";
import { actionOf, useStore } from "../store";
import { Badge, Banner, Button, Count, menuAtElement, Picker, ProgressLine, SplitButton, Toggle, type ButtonProps, type PickerItem } from "../ui";
import { Icon } from "./Icon";

function BranchSelector() {
  const branches = useStore((s) => s.branches);
  const counts = useStore((s) => s.changeCounts);
  const worktrees = useStore((s) => s.worktrees);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const selectBranch = useStore((s) => s.selectBranch);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const current = worktrees.find((w) => w.path === cwd);
  const value = viewBranch ? viewBranch.name : current ? branchLabel(current) : "—";

  const items: PickerItem[] = branches.map((b) => {
    const wt = b.kind === "local" ? worktrees.find((w) => w.branch === b.name && !w.missing) : undefined;
    const n = wt && counts[wt.path];
    return {
      key: b.fullRef,
      label: b.name,
      section: b.kind === "local" ? "Local branches" : "Remote branches",
      search: b.name,
      current: viewBranch ? viewBranch.fullRef === b.fullRef : b.kind === "local" && current?.branch === b.name,
      menu: () => branchItems(menuEnv, { name: b.name }),
      trailing: n ? <Count n={n} title={changeCountTitle(n)} /> : undefined,
      detail: wt ? `checked out in ${worktreeName(wt)}` : `${relativeTime(b.committerUnix)} · view only`,
    };
  });
  items.sort((a, b) => (a.section === b.section ? 0 : a.section === "Local branches" ? -1 : 1));

  return (
    <>
      <Button ref={button} kind="ghost" size="sm" className="br-btn" icon="git-branch" text={value} after={<Icon name="chevron-down" size={10} />} tip={value} disabled={branches.length === 0 ? "No branches" : undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Picker
          anchor={button.current}
          items={items}
          searchable
          placeholder="Filter branches"
          label="Branches"
          width={320}
          onClose={() => setOpen(false)}
          onPick={(k) => {
            const b = branches.find((x) => x.fullRef === k);
            if (b) void selectBranch(b);
          }}
        />
      )}
    </>
  );
}

/** Fetch, push or publish, and the second action behind the chevron. */
function PushButton() {
  const bs = useStore((s) => s.branchStatus);
  const action = useStore(actionOf);
  const viewing = useStore((s) => !!s.viewBranch);
  const lost = useStore((s) => !!s.connectionLost);
  const runAction = useStore((s) => s.runAction);
  const now = useNow(30_000);

  if (!bs) return <Button kind="primary" icon="sync" text="Fetch origin" disabled />;
  const a = branchAction(bs, viewing, now);
  const off = lost ? "Not available while reconnecting" : undefined;
  const noOrigin = a.kind === "fetch" && !a.hasOrigin ? `Push unavailable: ${a.blocked}` : undefined;
  const label = action.running ? action.label : a.label;
  const reason = a.kind === "fetch" && a.hasOrigin && !action.running ? a.blocked : null;
  const push: ButtonProps = {
    kind: "primary",
    icon: action.running ? "sync" : a.icon,
    text: label,
    loading: action.running,
    disabled: off ?? noOrigin,
    tip: action.running ? undefined : a.blocked && a.kind === "fetch" ? `Push unavailable: ${a.blocked}` : a.caption,
    "aria-label": label,
    className: "push",
    onClick: () => void runAction(a.kind),
  };
  return (
    <div className="head-tools">
      {action.running ? (
        <ProgressLine text={action.progress || "Working…"} />
      ) : (
        reason && (
          <span className="muted ell cap" data-tip={reason} tabIndex={0}>
            {reason}
          </span>
        )
      )}
      {a.kind !== "fetch" && a.hasOrigin && !action.running ? (
        <SplitButton
          main={push}
          more={{
            label: "More actions",
            tip: "More actions",
            disabled: off,
            onClick: (e) => menuAtElement(e.currentTarget, [{ label: "Fetch origin", detail: a.fetched, lead: <Icon name="sync" size={14} />, run: () => runAction("fetch") }]),
          }}
        />
      ) : (
        <Button {...push} />
      )}
    </div>
  );
}

/** The worktree's page header. Its empty space moves the window. */
export function WorkHeader() {
  const hasRepo = useStore((s) => !!s.repo);
  if (hasRepo) return <RepoHeader />;
  // settings.json with no repository: nothing to name here, but the top of the page still moves the window.
  return (
    <div className="ui-root work-top">
      <div className="page-band" data-tauri-drag-region="deep" />
    </div>
  );
}

function RepoHeader() {
  const worktrees = useStore((s) => s.worktrees);
  const cwd = useStore((s) => s.cwd);
  const viewBranch = useStore((s) => s.viewBranch);
  const base = useStore((s) => s.base);
  const summary = useStore((s) => s.overview?.worktrees.find((w) => w.path === s.cwd));
  const narrow = useStore((s) => isNarrow(s.appWidth));
  const listOpen = useStore((s) => s.listOpen);
  const toggleList = useStore((s) => s.toggleList);
  const actionError = useStore((s) => actionOf(s).error);
  const clearError = useStore((s) => s.clearActionError);
  const selectWorktree = useStore((s) => s.selectWorktree);
  const current = worktrees.find((w) => w.path === cwd);
  const ahead = summary?.baseAhead ?? 0;
  const behind = summary?.baseBehind ?? 0;

  return (
    <div className="ui-root work-top">
      <header className="head" data-tauri-drag-region="deep">
        {narrow && <Toggle icon="layout-sidebar-left" label="Toggle list" tip="Toggle list (Ctrl+B)" on={listOpen} aria-expanded={listOpen} onClick={toggleList} />}
        <div className="head-id">
          <h1>
            <span className="ell">{current ? worktreeName(current) : "—"}</span>
            <BranchSelector />
            {base && (ahead > 0 || behind > 0) && (
              <span className="head-ab" data-tip={`${ahead} ahead, ${behind} behind ${base}`} tabIndex={0}>
                {[ahead > 0 && `↑${ahead}`, behind > 0 && `↓${behind}`].filter(Boolean).join(" ")}
              </span>
            )}
            {viewBranch && <Badge tone="changes">View only</Badge>}
          </h1>
        </div>
        <PushButton />
      </header>
      {viewBranch && current && <Banner tone="view" title={`Viewing ${viewBranch.name}`} text="Read-only. Nothing is checked out." actions={current.branch && <Button kind="link" text={`Back to ${current.branch}`} onClick={() => void selectWorktree(current.path)} />} />}
      {actionError && <Banner tone="error" pre text={actionError} onDismiss={clearError} />}
    </div>
  );
}
