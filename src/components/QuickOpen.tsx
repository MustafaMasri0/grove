import { useEffect, useMemo, useRef, useState } from "react";
import { fileItems } from "../lib/contextMenus";
import { quickOpen } from "../lib/fuzzy";
import { splitPath } from "../lib/format";
import { isMenuKey } from "../lib/menu";
import { useStore } from "../store";
import { fileTab } from "../tabs";
import { currentWhere, menuEnv } from "../menuEnv";
import { closeOverlay, menuAtElement, menuAtPointer, Overlay } from "../ui";
import { FileTypeIcon } from "./FileTypeIcon";

function Highlighted({ text, positions, offset }: { text: string; positions: Set<number>; offset: number }) {
  return (
    <>
      {[...text].map((c, i) => (positions.has(i + offset) ? <mark key={i}>{c}</mark> : <span key={i}>{c}</span>))}
    </>
  );
}

/** Ctrl+P: open any file of the current worktree (or view-only branch). */
export function QuickOpen() {
  const setOpen = useStore((s) => s.setQuickOpen);
  const fileList = useStore((s) => s.fileList);
  const loadFileList = useStore((s) => s.loadFileList);
  const viewBranch = useStore((s) => s.viewBranch);
  const cwd = useStore((s) => s.cwd);
  const openTab = useStore((s) => s.openTab);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fileList) void loadFileList();
  }, [fileList, loadFileList]);

  const results = useMemo(() => quickOpen(query, fileList?.files ?? [], 60), [query, fileList]);

  useEffect(() => {
    list.current?.querySelector(".qo-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (i: number, pin: boolean) => {
    const r = results[i];
    if (!r || !cwd) return;
    openTab(fileTab(cwd, r.path, viewBranch?.fullRef ?? null), pin);
    setOpen(false);
  };

  const menuFor = (i: number) => {
    const r = results[i];
    const where = currentWhere();
    return r && where ? fileItems(menuEnv, where, {
          path: r.path,
          open: () => pick(i, true),
          history: () => {
            setOpen(false);
            void useStore.getState().openFileHistory(r.path);
          },
          revealInExplorer: () => {
            setOpen(false);
            useStore.getState().revealInExplorer(r.path);
          },
          onDisk: !viewBranch,
        }) : null;
  };

  const keys = (e: KeyboardEvent) => {
    if (isMenuKey(e)) {
      const items = menuFor(active);
      if (items) menuAtElement(list.current?.querySelector(".qo-item.active") ?? null, items);
    } else if (e.key === "Escape") closeOverlay();
    else if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter") pick(active, true);
    else return false;
    return true;
  };

  return (
    <Overlay
      kind="quick-open"
      className="overlay"
      modal
      keys={keys}
      onClose={() => setOpen(false)}
      focus={(el) => el.querySelector("input")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeOverlay();
      }}
    >
      <div className="quick-open">
        <input
          placeholder={fileList ? `Go to file (${fileList.files.length} files)` : "Loading files…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
        <div className="qo-list" ref={list}>
          {results.map((r, i) => {
            const { name, dir } = splitPath(r.path);
            const pos = new Set(r.positions);
            return (
              <div key={r.path} className={`qo-item${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)}
                onClick={() => pick(i, true)}
                onContextMenu={(e) => {
                  const items = menuFor(i);
                  if (!items) return;
                  setActive(i);
                  menuAtPointer(e, items);
                }}
              >
                <FileTypeIcon name={name} />
                <span className="qo-name">
                  <Highlighted text={name} positions={pos} offset={r.path.length - name.length} />
                </span>
                <span className="qo-dir">
                  <Highlighted text={dir} positions={pos} offset={0} />
                </span>
              </div>
            );
          })}
          {fileList && results.length === 0 && <div className="qo-empty">No matching files</div>}
        </div>
      </div>
    </Overlay>
  );
}
