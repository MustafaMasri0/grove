// The one stack of open overlays. Keys, outside clicks and focus always go to the top entry first.

export interface OverlayEntry {
  kind: string;
  /** Blocks everything behind it: the page goes inert and outside clicks stop at it. */
  modal?: boolean;
  /** Closes on resize, window blur and wheel outside. */
  transient?: boolean;
  el: HTMLElement | null;
  /** What it was opened on: scrolling that away closes a transient overlay. */
  anchor?: Element | null;
  /** The anchor is a button that toggles it, so pressing the anchor is not an outside click. */
  toggledByAnchor?: boolean;
  returnFocus: HTMLElement | null;
  /** Returns true when it used the key. */
  keys?: (e: KeyboardEvent) => boolean;
  close: () => void;
}

const stack: OverlayEntry[] = [];
const watchers = new Set<() => void>();

export const topEntry = (): OverlayEntry | undefined => stack[stack.length - 1];
export const isModalOpen = () => stack.some((e) => e.modal);

export function pushEntry(e: OverlayEntry) {
  stack.push(e);
  watchers.forEach((f) => f());
}

export function removeEntry(e: OverlayEntry) {
  const i = stack.indexOf(e);
  if (i < 0) return;
  stack.splice(i, 1);
  watchers.forEach((f) => f());
}

/** `e` and everything above it, topmost first: closing an overlay closes what was opened over it. */
export function entriesFrom(e: OverlayEntry): OverlayEntry[] {
  const i = stack.indexOf(e);
  return i < 0 ? [] : stack.slice(i).reverse();
}

/** The entries an outside press closes, top down: it stops at a modal and at the entry it landed in. */
export function entriesOutside(contains: (e: OverlayEntry) => boolean): OverlayEntry[] {
  const out: OverlayEntry[] = [];
  for (let i = stack.length - 1; i >= 0 && !stack[i].modal && !contains(stack[i]); i--) out.push(stack[i]);
  return out;
}

/** The transient entries on top of the stack, topmost first. */
export function transientEntries(): OverlayEntry[] {
  const out: OverlayEntry[] = [];
  for (let i = stack.length - 1; i >= 0 && stack[i].transient; i--) out.push(stack[i]);
  return out;
}

export function watchStack(f: () => void) {
  watchers.add(f);
  return () => void watchers.delete(f);
}
