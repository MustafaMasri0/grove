import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { menuAtElement, menuAtPointer } from "./ContextMenu";

export interface DropdownItem {
  key: string;
  label: ReactNode;
  /** Text matched by the search box. */
  search?: string;
  detail?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  current?: boolean;
  section?: string;
  trailing?: ReactNode;
  /** The item's context menu; built when it opens. */
  menu?: () => MenuItem[];
}

interface Props {
  caption: string;
  value: ReactNode;
  icon: ReactNode;
  items: DropdownItem[];
  onPick: (key: string) => void;
  searchable?: boolean;
  placeholder?: string;
  footer?: (close: () => void) => ReactNode;
  disabled?: boolean;
  width?: number;
  title?: string;
}

/** A top-bar switcher: a wide button that opens a searchable list. */
export function Dropdown(p: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? p.items.filter((i) => (i.search ?? "").toLowerCase().includes(q)) : p.items;
  }, [p.items, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // A context menu opened on one of the items keeps the list open.
      const t = e.target as Element;
      if (!root.current?.contains(t) && !t.closest?.(".ctx-menu")) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const cur = p.items.findIndex((i) => i.current);
      setActive(Math.max(0, cur));
      setTimeout(() => (input.current ?? list.current)?.focus(), 0);
    }
    // Only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(".dd-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (i: DropdownItem) => {
    if (i.disabled) return;
    setOpen(false);
    p.onPick(i.key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = visible[active];
    if (isMenuKey(e)) {
      if (cur?.menu) menuAtElement(list.current?.querySelector(".dd-item.active") ?? null, cur.menu());
    } else if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setActive((a) => Math.min(visible.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter" && visible[active]) pick(visible[active]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let lastSection: string | undefined;
  return (
    <div className="dd" ref={root}>
      <button className={`tb-button${open ? " open" : ""}`} disabled={p.disabled} onClick={() => setOpen((o) => !o)} title={p.title} style={{ width: p.width }}>
        <span className="tb-icon">{p.icon}</span>
        <span className="tb-text">
          <span className="tb-caption">{p.caption}</span>
          <span className="tb-value">{p.value}</span>
        </span>
        <span className="tb-chevron">▾</span>
      </button>
      {open && (
        <div className="dd-panel" onKeyDown={onKeyDown}>
          {p.searchable && (
            <input
              ref={input}
              className="dd-search"
              placeholder={p.placeholder ?? "Filter"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
            />
          )}
          <div className="dd-list" ref={list} tabIndex={-1}>
            {visible.length === 0 && <div className="dd-empty">Nothing matches</div>}
            {visible.map((i, idx) => {
              const header = i.section && i.section !== lastSection ? i.section : null;
              lastSection = i.section;
              return (
                <div key={i.key}>
                  {header && <div className="dd-section">{header}</div>}
                  <div
                    className={`dd-item${idx === active ? " active" : ""}${i.disabled ? " disabled" : ""}${i.current ? " current" : ""}`}
                    title={i.disabledReason}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => pick(i)}
                    onContextMenu={(e) => {
                      if (!i.menu) return;
                      setActive(idx);
                      menuAtPointer(e, i.menu());
                    }}
                  >
                    <span className="dd-check">{i.current ? "✓" : ""}</span>
                    <span className="dd-main">
                      <span className="dd-label">{i.label}</span>
                      {i.detail && <span className="dd-detail">{i.detail}</span>}
                    </span>
                    {i.trailing}
                  </div>
                </div>
              );
            })}
          </div>
          {p.footer && <div className="dd-footer">{p.footer(() => setOpen(false))}</div>}
        </div>
      )}
    </div>
  );
}
