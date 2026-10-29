import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { menuAtElement, menuAtPointer } from "./ContextMenu";

export const ROW_HEIGHT = 24;

interface Props<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  selectedKey: string | null;
  render: (item: T, selected: boolean) => ReactNode;
  /** `pin` is true for double-click and Enter (keep the editor tab open); `via` tells clicks from arrow keys. */
  onSelect: (item: T, pin: boolean, via: "click" | "key") => void;
  /** Left/Right arrows, for trees. */
  onHorizontal?: (item: T, dir: -1 | 1) => void;
  onEndReached?: () => void;
  /** The item's context menu (right-click, Shift+F10, the Menu key); null for none. */
  menu?: (item: T) => MenuItem[] | null;
  empty?: ReactNode;
  className?: string;
  label: string;
  /** Bumped to bring the selected row into view, centred, unless it is already in view. */
  reveal?: number;
}

/** A virtualised, keyboard-driven list: Up/Down move and preview, Enter pins. */
export function ListView<T>(p: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [menuKey, setMenuKey] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const index = p.selectedKey === null ? -1 : p.items.findIndex((i) => p.getKey(i) === p.selectedKey);

  // Keep the selected row visible: at the nearest edge when moving, centred when revealed.
  const revealed = useRef(p.reveal);
  useEffect(() => {
    const el = ref.current;
    if (!el || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (p.reveal !== revealed.current) {
      revealed.current = p.reveal;
      if (top < el.scrollTop || top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top - (el.clientHeight - ROW_HEIGHT) / 2;
    } else if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
  }, [index, p.reveal]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const last = Math.min(p.items.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 5);

  const move = (to: number) => {
    if (p.items.length === 0) return;
    const i = Math.max(0, Math.min(p.items.length - 1, to));
    p.onSelect(p.items[i], false, "key");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isMenuKey(e)) {
      e.preventDefault();
      const items = index >= 0 && p.menu?.(p.items[index]);
      if (!items) return;
      const key = p.getKey(p.items[index]);
      setMenuKey(key);
      menuAtElement(ref.current?.querySelector(".row.selected") ?? ref.current, items, () => setMenuKey(null));
      return;
    }
    const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
    const cur = index;
    switch (e.key) {
      case "ArrowDown":
        move(cur + 1);
        break;
      case "ArrowUp":
        move(cur < 0 ? 0 : cur - 1);
        break;
      case "PageDown":
        move(cur + page);
        break;
      case "PageUp":
        move(cur - page);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(p.items.length - 1);
        break;
      case "Enter":
        if (cur >= 0) p.onSelect(p.items[cur], true, "key");
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (cur >= 0 && p.onHorizontal) p.onHorizontal(p.items[cur], e.key === "ArrowLeft" ? -1 : 1);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onScroll = () => {
    const el = ref.current!;
    setScrollTop(el.scrollTop);
    if (p.onEndReached && el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 5) p.onEndReached();
  };

  return (
    <div ref={ref} className={`list ${p.className ?? ""}`} tabIndex={0} role="listbox" aria-label={p.label} onKeyDown={onKeyDown} onScroll={onScroll}>
      {p.items.length === 0 ? (
        <div className="list-empty">{p.empty}</div>
      ) : (
        <div style={{ height: p.items.length * ROW_HEIGHT, position: "relative" }}>
          {p.items.slice(first, last).map((item, k) => {
            const i = first + k;
            const selected = i === index;
            return (
              <div
                key={p.getKey(item)}
                role="option"
                aria-selected={selected}
                className={`row${selected ? " selected" : ""}${menuKey === p.getKey(item) ? " menu-target" : ""}`}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                onContextMenu={(e) => {
                  const items = p.menu?.(item);
                  if (!items) return;
                  const key = p.getKey(item);
                  setMenuKey(key);
                  menuAtPointer(e, items, () => setMenuKey(null));
                }}
                onClick={() => p.onSelect(item, false, "click")}
                onDoubleClick={() => p.onSelect(item, true, "click")}
              >
                {p.render(item, selected)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
