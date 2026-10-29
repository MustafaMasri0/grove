// Context menu logic that does not need the DOM: items, placement, keyboard moves.

export type MenuItem =
  | { label: string; run: () => void | Promise<void>; disabled?: boolean; shortcut?: string }
  | { separator: true };

const MARGIN = 4;

/**
 * Where a menu of `size` opened at `at` goes so it stays inside `view`: below
 * and right of the point, flipped left or up when it would cross an edge, and
 * pinned inside the window (with a small margin) when it fits neither way.
 * `flipTop`: where an upward flip ends, for menus opened under a row (its top).
 */
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  view: { width: number; height: number },
  flipTop?: number,
): { left: number; top: number } {
  const axis = (p: number, len: number, max: number, flipAt = p) => {
    let v = p + len > max - MARGIN ? flipAt - len : p;
    v = Math.min(v, max - MARGIN - len);
    return Math.max(MARGIN, v);
  };
  return { left: axis(at.x, size.width, view.width), top: axis(at.y, size.height, view.height, flipTop) };
}

/** The next item an arrow key moves to, skipping separators and disabled items; -1 if none. */
export function nextEnabled(items: readonly MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  let i = from < 0 ? (dir === 1 ? -1 : n) : from;
  for (let step = 0; step < n; step++) {
    i = (i + dir + n) % n;
    const it = items[i];
    if (!("separator" in it) && !it.disabled) return i;
  }
  return -1;
}

/** The Menu key, or Shift+F10: open the context menu of what has focus. */
export function isMenuKey(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  if (e.key === "ContextMenu") return true;
  return e.key === "F10" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
}
