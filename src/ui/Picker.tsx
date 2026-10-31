import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { cx } from "./classes";
import { EmptyLine } from "./Feedback";
import { Field } from "./Field";
import { menuAtElement, menuAtPointer, MenuRow } from "./Menu";
import { closeOverlay, Overlay, placeUnder } from "./Overlay";
import { SectionLabel } from "./Structure";

export interface PickerItem {
  key: string;
  label: ReactNode;
  /** Text matched by the filter; the label when it is a string. */
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

export interface PickerProps {
  /** What it opens under: the button that toggles it. */
  anchor: Element | null;
  items: readonly PickerItem[];
  onPick: (key: string) => void;
  onClose: () => void;
  searchable?: boolean;
  placeholder?: string;
  label?: string;
  width?: number;
  /** The filter text itself can be chosen. */
  free?: boolean;
  footer?: ReactNode;
}

/** The items a filter leaves. `free` offers the text itself first, unless an item already has that key. */
export function filterPicker(items: readonly PickerItem[], query: string, free = false): PickerItem[] {
  const q = query.trim();
  const low = q.toLowerCase();
  const shown = low ? items.filter((i) => (i.search ?? (typeof i.label === "string" ? i.label : "")).toLowerCase().includes(low)) : [...items];
  return free && q && !items.some((i) => i.key === q) ? [{ key: q, label: `Use “${q}”` }, ...shown] : shown;
}

/** A popover list with an optional filter and footer: the repository and branch switchers, and Select. */
export function Picker({ anchor, items, onPick, onClose, searchable, placeholder, label, width = 320, free, footer }: PickerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.current)));
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterPicker(items, query, free), [items, query, free]);
  const on = Math.max(0, Math.min(active, shown.length - 1));

  useEffect(() => {
    list.current?.querySelector(".mi.on")?.scrollIntoView({ block: "nearest" });
  }, [on, shown]);

  const pick = (i: number) => {
    const it = shown[i];
    if (!it || it.disabled) return;
    closeOverlay();
    onPick(it.key);
  };

  const keys = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") {
      closeOverlay();
      return true;
    }
    // The footer's own fields and buttons keep their keys.
    if ((e.target as Element).closest?.(".picker-f")) return false;
    const menu = shown[on]?.menu;
    if (isMenuKey(e)) {
      if (menu) menuAtElement(list.current?.querySelector(".mi.on") ?? null, menu());
    } else if (k === "ArrowDown") setActive(Math.min(shown.length - 1, on + 1));
    else if (k === "ArrowUp") setActive(Math.max(0, on - 1));
    else if (k === "Enter") pick(on);
    else return false;
    return true;
  };

  let section: string | undefined;
  return (
    <Overlay
      kind="picker"
      className="pop picker"
      anchor={anchor}
      toggledByAnchor
      keys={keys}
      onClose={onClose}
      style={{ width }}
      place={(el) => anchor && placeUnder(el, anchor)}
      focus={(el) => el.querySelector("input") ?? list.current}
    >
      {searchable && (
        <Field
          className="picker-q"
          search
          placeholder={placeholder ?? "Filter"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
      )}
      <div ref={list} className="picker-l" role="listbox" tabIndex={-1} aria-label={label ?? placeholder ?? "Options"}>
        {shown.length === 0 && <EmptyLine>Nothing matches</EmptyLine>}
        {shown.map((it, i) => {
          const header = it.section && it.section !== section ? it.section : null;
          section = it.section;
          return (
            <Fragment key={it.key}>
              {header && <SectionLabel text={header} />}
              <MenuRow
                role="option"
                active={i === on}
                item={{ ...it, check: !!it.current }}
                onEnter={() => !it.disabled && setActive(i)}
                onClick={() => pick(i)}
                onContextMenu={
                  it.menu &&
                  ((e) => {
                    setActive(i);
                    menuAtPointer(e, it.menu!());
                  })
                }
              />
            </Fragment>
          );
        })}
      </div>
      {footer && <div className="picker-f">{footer}</div>}
    </Overlay>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  detail?: ReactNode;
  section?: string;
}

export interface SelectProps {
  /** The accessible name. */
  label: string;
  value: string | null;
  options: readonly SelectOption[];
  onPick: (value: string) => void;
  /** Why it is unavailable. */
  disabled?: string;
  placeholder?: string;
  searchable?: boolean;
  free?: boolean;
  popWidth?: number;
  className?: string;
}

/** A button that opens a Picker. Arrow keys open it too. */
export function Select({ label, value, options, onPick, disabled, placeholder, searchable, free, popWidth = 180, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={cx("sel", className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        aria-disabled={disabled ? true : undefined}
        data-tip={disabled}
        onClick={disabled ? undefined : () => setOpen(!open)}
        onKeyDown={(e) => {
          if (!disabled && !open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="ell">{current?.label ?? value ?? placeholder ?? "—"}</span>
        <Icon name="chevron-down" size={10} />
      </button>
      {open && (
        <Picker
          anchor={button.current}
          items={options.map((o) => ({ ...o, key: o.value, current: o.value === value }))}
          searchable={searchable}
          free={free}
          placeholder={placeholder}
          label={label}
          width={Math.max(button.current?.offsetWidth ?? 0, popWidth)}
          onClose={() => setOpen(false)}
          onPick={onPick}
        />
      )}
    </>
  );
}
