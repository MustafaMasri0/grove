import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fileItems } from "../lib/contextMenus";
import { splitPath } from "../lib/format";
import { quickOpen } from "../lib/fuzzy";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { paletteItems, type PaletteItem, type PaletteScope } from "../lib/palette";
import { railRows, STATE_MARK } from "../lib/rail";
import { STATE_LABEL } from "../lib/worktrees";
import { currentWhere, menuEnv } from "../menuEnv";
import { useStore } from "../store";
import { fileTab } from "../tabs";
import { closeOverlay, EmptyLine, Field, Keys, menuAtElement, menuAtPointer, MenuRow, Overlay, SectionLabel, StateTag } from "../ui";
import { FileTypeIcon } from "./FileTypeIcon";
import { Icon } from "./Icon";
import "../palette.css";

/** One row of either search. */
interface Entry {
  key: string;
  section?: string;
  label: ReactNode;
  detail?: ReactNode;
  lead: ReactNode;
  trailing?: ReactNode;
  run: () => void;
  menu?: () => MenuItem[] | null;
}

function Highlighted({ text, positions, offset }: { text: string; positions: Set<number>; offset: number }) {
  return (
    <>
      {[...text].map((c, i) => (positions.has(i + offset) ? <mark key={i}>{c}</mark> : <Fragment key={i}>{c}</Fragment>))}
    </>
  );
}

/** The frame both searches share: a modal list near the top of the window. */
function Frame({ label, placeholder, none, query, onQuery, entries }: { label: string; placeholder: string; none: string | null; query: string; onQuery: (q: string) => void; entries: readonly Entry[] }) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const on = Math.max(0, Math.min(active, entries.length - 1));

  useEffect(() => {
    list.current?.querySelector(".mi.on")?.scrollIntoView({ block: "nearest" });
  }, [on, entries]);

  const pick = (i: number) => {
    const it = entries[i];
    closeOverlay();
    it?.run();
  };

  const keys = (e: KeyboardEvent) => {
    if (isMenuKey(e)) {
      const items = entries[on]?.menu?.();
      if (items) menuAtElement(list.current?.querySelector(".mi.on") ?? null, items);
    } else if (e.key === "Escape") closeOverlay();
    else if (e.key === "ArrowDown") setActive(Math.min(entries.length - 1, on + 1));
    else if (e.key === "ArrowUp") setActive(Math.max(0, on - 1));
    else if (e.key === "Enter") pick(on);
    else return e.key === "Tab";
    return true;
  };

  let section: string | undefined;
  return (
    <Overlay
      kind="palette"
      className="dlg-wrap pal-wrap"
      modal
      keys={keys}
      onClose={() => useStore.getState().setPalette(null)}
      focus={(el) => el.querySelector("input")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeOverlay();
      }}
    >
      <div className="dlg pal" role="dialog" aria-modal="true" aria-label={label}>
        <div className="pal-top">
          <Field search label={label} placeholder={placeholder} value={query} onChange={(e) => {
            onQuery(e.target.value);
            setActive(0);
          }} />
          <Keys keys={["Esc"]} />
        </div>
        <div ref={list} className="pal-list" role="listbox" aria-label="Results">
          {entries.map((it, i) => {
            const header = it.section && it.section !== section ? it.section : null;
            section = it.section;
            return (
              <Fragment key={it.key}>
                {header && <SectionLabel text={header} />}
                <MenuRow
                  role="option"
                  active={i === on}
                  item={{ label: it.label, detail: it.detail, lead: it.lead, trailing: it.trailing }}
                  onEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  onContextMenu={
                    it.menu &&
                    ((e) => {
                      const items = it.menu!();
                      if (!items) return;
                      setActive(i);
                      menuAtPointer(e, items);
                    })
                  }
                />
              </Fragment>
            );
          })}
          {entries.length === 0 && none && <EmptyLine>{none}</EmptyLine>}
        </div>
        <div className="pal-foot">
          <span>
            <Keys keys={["↑", "↓"]} /> to navigate
          </span>
          <span>
            <Keys keys={["↵"]} /> to select
          </span>
        </div>
      </div>
    </Overlay>
  );
}

/** Ctrl+P: open any file of the current worktree (or view-only branch). */
function FileSearch() {
  const fileList = useStore((s) => s.fileList);
  const loadFileList = useStore((s) => s.loadFileList);
  const viewBranch = useStore((s) => s.viewBranch);
  const cwd = useStore((s) => s.cwd);
  const openTab = useStore((s) => s.openTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!fileList) void loadFileList();
  }, [fileList, loadFileList]);

  const results = useMemo(() => quickOpen(query, fileList?.files ?? [], 60), [query, fileList]);

  const entries = results.map((r): Entry => {
    const { name, dir } = splitPath(r.path);
    const positions = new Set(r.positions);
    const open = () => {
      if (cwd) openTab(fileTab(cwd, r.path, viewBranch?.fullRef ?? null), true);
    };
    return {
      key: r.path,
      label: <Highlighted text={name} positions={positions} offset={r.path.length - name.length} />,
      detail: <Highlighted text={dir} positions={positions} offset={0} />,
      lead: <FileTypeIcon name={name} />,
      run: open,
      menu: () => {
        const where = currentWhere();
        return where
          ? fileItems(menuEnv, where, {
              path: r.path,
              open: () => {
                closeOverlay();
                open();
              },
              history: () => {
                closeOverlay();
                void useStore.getState().openFileHistory(r.path);
              },
              revealInExplorer: () => {
                closeOverlay();
                useStore.getState().revealInExplorer(r.path);
              },
              onDisk: !viewBranch,
            })
          : null;
      },
    };
  });

  return <Frame label="Go to file" placeholder={fileList ? `Go to file (${fileList.files.length} files)` : "Loading files…"} none={fileList ? "No matching files" : null} query={query} onQuery={setQuery} entries={entries} />;
}

/** Ctrl+K: the commands, the worktrees, and what each worktree has changed. */
function EverythingSearch() {
  const worktrees = useStore((s) => s.worktrees);
  const overview = useStore((s) => s.overview);
  const changeCounts = useStore((s) => s.changeCounts);
  const lastChange = useStore((s) => s.lastChange);
  const actions = useStore((s) => s.actions);
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => railRows({ worktrees, overview, changeCounts, lastChange, actions }, now), [worktrees, overview, changeCounts, lastChange, actions, now]);
  const items = useMemo(() => paletteItems(query, rows, overview?.worktrees ?? []), [query, rows, overview]);

  return <Frame label="Search" placeholder="Search files, worktrees…" none="Nothing matches" query={query} onQuery={setQuery} entries={items.map(entryOf)} />;
}

function entryOf(it: PaletteItem): Entry {
  const s = useStore.getState();
  if (it.kind === "command") {
    const c = it.command;
    return {
      key: `c:${c.label}`,
      section: it.section,
      label: c.label,
      lead: <Icon name={c.icon} size={13} />,
      trailing: c.keys && <Keys keys={c.keys} />,
      run: () => ("go" in c ? (c.go === "issues" ? s.showIssues() : s.setView(c.go)) : s.openSettings(c.settings ?? undefined)),
    };
  }
  const { path } = it.row.worktree;
  if (it.kind === "worktree")
    return {
      key: `w:${path}`,
      section: it.section,
      label: it.row.name,
      detail: it.row.branch,
      lead: <Icon name="git-branch" size={13} />,
      trailing: <StateTag state={STATE_MARK[it.row.state]} label={STATE_LABEL[it.row.state]} />,
      run: () => void s.selectWorktree(path),
    };
  const { file } = it;
  const open = () => void s.openWorktreeChange(path, file.path);
  const inWorktree = (go: () => void) => () => {
    closeOverlay();
    void s.selectWorktree(path).then(go);
  };
  return {
    key: `f:${path}:${file.path}`,
    section: it.section,
    label: splitPath(file.path).name,
    detail: it.row.name,
    lead: <Icon name="diff" size={13} />,
    run: open,
    menu: () => {
      const { repo } = useStore.getState();
      const gone = file.kind === "deleted";
      return repo
        ? fileItems(menuEnv, { host: repo, cwd: path }, {
            path: file.path,
            open: () => {
              closeOverlay();
              open();
            },
            history: inWorktree(() => void useStore.getState().openFileHistory(file.path)),
            revealInExplorer: gone ? null : inWorktree(() => useStore.getState().revealInExplorer(file.path)),
            onDisk: !gone,
          })
        : null;
    },
  };
}

export function Palette({ scope }: { scope: PaletteScope }) {
  return scope === "files" ? <FileSearch /> : <EverythingSearch />;
}
