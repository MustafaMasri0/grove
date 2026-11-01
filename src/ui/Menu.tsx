import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { Icon } from "../components/Icon";
import { isMenuKey, nextEnabled, type MenuItem } from "../lib/menu";
import { cx } from "./classes";
import { closeOverlay, Overlay, placeAt } from "./Overlay";

/** A menu row beyond what context menus use: a check mark, a lead icon, a detail line, trailing content. */
export type RichMenuItem =
  | (Exclude<MenuItem, { separator: true }> & { check?: boolean; lead?: ReactNode; detail?: ReactNode; trailing?: ReactNode; disabledReason?: string })
  | { separator: true };

/** One row, shared by Menu and Picker. `id` lets a list point at its active row. */
export function MenuRow({ item, id, active, role = "menuitem", onEnter, onClick, onContextMenu }: { item: Omit<Exclude<RichMenuItem, { separator: true }>, "label" | "run"> & { label: ReactNode }; id?: string; active?: boolean; role?: string; onEnter?: () => void; onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <div
      id={id}
      role={role}
      className={cx("mi", active && "on", item.disabled && "dis")}
      aria-disabled={item.disabled || undefined}
      aria-selected={role === "option" ? !!active : undefined}
      data-tip={item.disabledReason}
      data-current={item.check || undefined}
      onMouseEnter={onEnter}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {item.check !== undefined && <span className="mi-c">{item.check && <Icon name="check" size={12} />}</span>}
      {item.lead && <span className="mi-i">{item.lead}</span>}
      <span className="mi-m">
        <span className="mi-l ell">{item.label}</span>
        {item.detail && <span className="mi-d ell">{item.detail}</span>}
      </span>
      {item.trailing}
      {item.shortcut && <span className="mi-s">{item.shortcut}</span>}
    </div>
  );
}

/** A menu's rows, without the overlay around them. */
export function MenuRows({ items, active = -1, onActive, onChoose }: { items: readonly RichMenuItem[]; active?: number; onActive?: (i: number) => void; onChoose?: (i: number) => void }) {
  return items.map((it, i) =>
    "separator" in it ? (
      <div key={i} className="menu-sep" role="separator" />
    ) : (
      <MenuRow key={i} item={it} id={onChoose ? `mi-${i}` : undefined} active={i === active} onEnter={() => onActive?.(it.disabled ? -1 : i)} onClick={() => onChoose?.(i)} />
    ),
  );
}

interface OpenMenu {
  id: number;
  items: readonly RichMenuItem[];
  x: number;
  y: number;
  /** For menus under a row: the row's top, where the menu ends when it has to open upwards. */
  flipTop?: number;
  /** Opened from the keyboard: the first item starts highlighted. */
  keyboard: boolean;
  returnFocus: HTMLElement | null;
  anchor: Element | null;
  onClose?: () => void;
}

// Its own tiny store, so opening a menu re-renders nothing but the menu.
const useMenu = create<{ menu: OpenMenu | null }>(() => ({ menu: null }));
let lastId = 0;
/** When a menu was last opened from the keyboard; the browser may follow the key with a contextmenu event. */
let keyboardOpenedAt = 0;

/** True for a contextmenu event that only echoes a key that already opened a menu. */
export function isKeyboardEcho(): boolean {
  return performance.now() - keyboardOpenedAt < 500;
}

function openMenu(items: readonly RichMenuItem[], at: { x: number; y: number }, opts: { keyboard?: boolean; anchor?: Element | null; flipTop?: number; onClose?: () => void }) {
  const prev = useMenu.getState().menu;
  prev?.onClose?.();
  if (opts.keyboard) keyboardOpenedAt = performance.now();
  // Opened over another menu: focus still goes back to where that one came from.
  const active = document.activeElement;
  const returnFocus = active instanceof HTMLElement && active !== document.body && !active.closest(".menu") ? active : prev?.returnFocus ?? null;
  useMenu.setState({ menu: { id: ++lastId, items, x: at.x, y: at.y, flipTop: opts.flipTop, keyboard: !!opts.keyboard, returnFocus, anchor: opts.anchor ?? null, onClose: opts.onClose } });
}

/** For a right-click. */
export function menuAtPointer(e: React.MouseEvent, items: readonly RichMenuItem[], onClose?: () => void) {
  e.preventDefault();
  e.stopPropagation();
  openMenu(items, { x: e.clientX, y: e.clientY }, { anchor: e.currentTarget as Element, onClose });
}

/** For Shift+F10 and the Menu key: under the left part of the element. */
export function menuAtElement(el: Element | null, items: readonly RichMenuItem[], onClose?: () => void) {
  const r = el?.getBoundingClientRect();
  openMenu(items, r ? { x: r.left + Math.min(24, r.width / 2), y: r.bottom } : { x: 40, y: 40 }, { keyboard: true, anchor: el, flipTop: r?.top, onClose });
}

/** The one context menu of the app; renders nothing while closed. */
export function MenuLayer() {
  const menu = useMenu((s) => s.menu);
  return menu ? <Menu key={menu.id} menu={menu} /> : null;
}

function Menu({ menu }: { menu: OpenMenu }) {
  const [active, setActive] = useState(() => (menu.keyboard ? nextEnabled(menu.items, -1, 1) : -1));

  const choose = (i: number) => {
    const it = menu.items[i];
    if (!it || "separator" in it || it.disabled) return;
    closeOverlay();
    void it.run();
  };

  const keys = (e: KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") setActive((a) => nextEnabled(menu.items, a, 1));
    else if (k === "ArrowUp") setActive((a) => nextEnabled(menu.items, a, -1));
    else if (k === "Home") setActive(nextEnabled(menu.items, -1, 1));
    else if (k === "End") setActive(nextEnabled(menu.items, -1, -1));
    else if (k === "Enter" || k === " ") choose(active);
    else if (k === "Escape" || k === "Tab" || isMenuKey(e)) closeOverlay();
    else return false;
    return true;
  };

  return (
    <Overlay
      kind="menu"
      className="menu"
      role="menu"
      transient
      anchor={menu.anchor}
      returnFocus={menu.returnFocus}
      keys={keys}
      onClose={() => {
        useMenu.setState({ menu: null });
        menu.onClose?.();
      }}
      place={(el) => placeAt(el, menu.x, menu.y, menu.flipTop)}
      aria-activedescendant={active >= 0 ? `mi-${active}` : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => setActive(-1)}
    >
      <MenuRows items={menu.items} active={active} onActive={setActive} onChoose={choose} />
    </Overlay>
  );
}
