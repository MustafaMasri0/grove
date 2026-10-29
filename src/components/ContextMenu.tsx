import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { create } from "zustand";
import { api, errorText } from "../api";
import type { MenuEnv, Where } from "../lib/contextMenus";
import { nextEnabled, placeMenu, type MenuItem } from "../lib/menu";
import { useStore } from "../store";

interface OpenMenu {
  id: number;
  items: MenuItem[];
  x: number;
  y: number;
  /** For menus under a row: the row's top, where the menu ends when it has to open upwards. */
  flipTop?: number;
  /** Opened from the keyboard: the first item starts highlighted. */
  keyboard: boolean;
  returnFocus: HTMLElement | null;
  /** What the menu was opened on; scrolling it away closes the menu. */
  anchor: Element | null;
  onClose?: () => void;
}

// Its own tiny store, so opening a menu re-renders nothing but the menu.
const useMenu = create<{ menu: OpenMenu | null }>(() => ({ menu: null }));

/** When a menu was last opened from the keyboard; the browser may follow the key with a contextmenu event. */
let keyboardOpenedAt = 0;
let lastId = 0;
/** Test instances run in the background: a menu opened by WV_CONTEXT_MENU stays open for the screenshot. */
let keepOnBlur = false;

export function keepMenusOnBlur() {
  keepOnBlur = true;
}

export function openContextMenu(
  items: MenuItem[],
  at: { x: number; y: number },
  opts: { keyboard?: boolean; anchor?: Element | null; flipTop?: number; onClose?: () => void } = {},
) {
  const prev = useMenu.getState().menu;
  closeContextMenu(false);
  if (opts.keyboard) keyboardOpenedAt = performance.now();
  // Opened over another menu: focus still goes back to where that one came from.
  const active = document.activeElement;
  const returnFocus = active instanceof HTMLElement && !active.closest(".ctx-menu") ? active : prev?.returnFocus ?? null;
  useMenu.setState({
    menu: {
      id: ++lastId,
      items,
      x: at.x,
      y: at.y,
      flipTop: opts.flipTop,
      keyboard: !!opts.keyboard,
      returnFocus,
      anchor: opts.anchor ?? null,
      onClose: opts.onClose,
    },
  });
}

/** For a right-click. */
export function menuAtPointer(e: React.MouseEvent, items: MenuItem[], onClose?: () => void) {
  e.preventDefault();
  e.stopPropagation();
  openContextMenu(items, { x: e.clientX, y: e.clientY }, { anchor: e.currentTarget as Element, onClose });
}

/** For Shift+F10 and the Menu key: under the left part of the element. */
export function menuAtElement(el: Element | null, items: MenuItem[], onClose?: () => void) {
  const r = el?.getBoundingClientRect();
  openContextMenu(items, r ? { x: r.left + Math.min(24, r.width / 2), y: r.bottom } : { x: 40, y: 40 }, { keyboard: true, anchor: el, flipTop: r?.top, onClose });
}

export function closeContextMenu(restoreFocus = true) {
  const m = useMenu.getState().menu;
  if (!m) return;
  useMenu.setState({ menu: null });
  m.onClose?.();
  if (restoreFocus && m.returnFocus?.isConnected) m.returnFocus.focus();
}

/** True for a contextmenu event that only echoes a key that already opened a menu. */
export function isKeyboardEcho(): boolean {
  return performance.now() - keyboardOpenedAt < 500;
}

const fail = (what: string) => (e: unknown) => useStore.getState().setNotice(`${what}: ${errorText(e)}`);

/** Clipboard, File Explorer and the browser, for the menu options. */
export const menuEnv: MenuEnv = {
  copy: async (text) => {
    try {
      await api.copyText(await text);
    } catch (e) {
      fail("Could not copy")(e);
    }
  },
  reveal: (path) => revealItemInDir(path).catch(fail(`Could not show ${path} in File Explorer`)),
  openUrl: (url) => openUrl(url).catch(fail(`Could not open ${url}`)),
};

/** The worktree the left pane shows, for the path options. */
export function currentWhere(): Where | null {
  const { repo, cwd } = useStore.getState();
  return repo && cwd ? { host: repo, cwd } : null;
}

/** The one context menu of the app; renders nothing while closed. */
export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu);
  return menu ? <Menu key={menu.id} menu={menu} /> : null;
}

function Menu({ menu }: { menu: OpenMenu }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => (menu.keyboard ? nextEnabled(menu.items, -1, 1) : -1));

  useLayoutEffect(() => {
    const el = ref.current!;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const { left, top } = placeMenu({ x: menu.x, y: menu.y }, size, { width: window.innerWidth, height: window.innerHeight }, menu.flipTop);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
    el.focus();
  }, [menu]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu(false);
    };
    // Only scrolling what the menu belongs to closes it; editors and lists elsewhere scroll on their own.
    const scrolled = (e: Event) => {
      const t = e.target;
      if (t === document || (t instanceof Node && menu.anchor && t.contains(menu.anchor))) closeContextMenu(false);
    };
    const away = (e: Event) => {
      if (e.type === "blur" && keepOnBlur) return;
      closeContextMenu(false);
    };
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", away);
    };
  }, [menu]);

  const choose = (i: number) => {
    const it = menu.items[i];
    if (!it || "separator" in it || it.disabled) return;
    closeContextMenu();
    void it.run();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") setActive((a) => nextEnabled(menu.items, a, 1));
    else if (k === "ArrowUp") setActive((a) => nextEnabled(menu.items, a, -1));
    else if (k === "Home") setActive(nextEnabled(menu.items, -1, 1));
    else if (k === "End") setActive(nextEnabled(menu.items, -1, -1));
    else if (k === "Enter" || k === " ") choose(active);
    else if (k === "Escape" || k === "Tab" || k === "ContextMenu" || (k === "F10" && e.shiftKey)) closeContextMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? `ctx-item-${active}` : undefined}
      style={{ left: menu.x, top: menu.y, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onMouseLeave={() => setActive(-1)}
    >
      {menu.items.map((it, i) =>
        "separator" in it ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <div
            key={i}
            id={`ctx-item-${i}`}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            className={`ctx-item${i === active ? " active" : ""}${it.disabled ? " disabled" : ""}`}
            onMouseEnter={() => setActive(it.disabled ? -1 : i)}
            onClick={() => choose(i)}
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </div>
        ),
      )}
    </div>
  );
}

