import { useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { placeMenu } from "../lib/menu";
import { MenuLayer } from "./Menu";
import { entriesFrom, entriesOutside, isModalOpen, pushEntry, removeEntry, topEntry, transientEntries, watchStack, type OverlayEntry } from "./overlayStack";
import { watchTooltips } from "./Tooltip";

const HOST = "overlays";
const MARGIN = 6;

/** Test instances run in the background: an overlay opened by WV_CONTEXT_MENU stays open for the screenshot. */
let keepOnBlur = false;

export function keepOverlaysOnBlur() {
  keepOnBlur = true;
}

/** Closes `entry` (the top one by default) and whatever is over it. Focus goes back to where it came from, unless `focus` is false. */
export function closeOverlay(entry = topEntry(), focus = true) {
  if (!entry) return;
  const gone = entriesFrom(entry);
  flushSync(() => gone.forEach((e) => e.close()));
  const back = gone[gone.length - 1]?.returnFocus;
  if (focus && back?.isConnected) back.focus();
}

/** Positions `el` at a point inside the window; `flipTop` is where it ends when it has to open upwards. */
export function placeAt(el: HTMLElement, x: number, y: number, flipTop?: number) {
  el.style.maxHeight = `${window.innerHeight - 2 * MARGIN}px`;
  const { left, top } = placeMenu({ x, y }, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, flipTop);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function placeUnder(el: HTMLElement, anchor: Element, gap = 4) {
  const r = anchor.getBoundingClientRect();
  placeAt(el, r.left, r.bottom + gap, r.top - gap);
}

export interface OverlayProps extends HTMLAttributes<HTMLDivElement> {
  kind: string;
  modal?: boolean;
  transient?: boolean;
  anchor?: Element | null;
  toggledByAnchor?: boolean;
  /** Where focus returns; by default what had it when this opened. */
  returnFocus?: HTMLElement | null;
  keys?: (e: KeyboardEvent) => boolean;
  /** Asked to close: the owner stops rendering it. */
  onClose: () => void;
  /** Positions it, on opening and when the window resizes. */
  place?: (el: HTMLElement) => void;
  /** What takes focus on opening; the overlay itself by default. */
  focus?: (el: HTMLElement) => HTMLElement | null;
  children: ReactNode;
}

/** One entry of the stack, rendered into the host. Closing is instant; its only motion is the CSS fade-in. */
export function Overlay({ kind, modal, transient, anchor, toggledByAnchor, returnFocus, keys, onClose, place, focus, children, ...rest }: OverlayProps) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef({ keys, onClose, place });
  live.current = { keys, onClose, place };

  useLayoutEffect(() => {
    const active = document.activeElement;
    const entry: OverlayEntry = {
      kind,
      modal,
      transient,
      anchor,
      toggledByAnchor,
      el: el.current,
      returnFocus: returnFocus !== undefined ? returnFocus : active instanceof HTMLElement && active !== document.body ? active : null,
      keys: (e) => live.current.keys?.(e) ?? false,
      close: () => live.current.onClose(),
    };
    pushEntry(entry);
    live.current.place?.(el.current!);
    (focus?.(el.current!) ?? el.current!).focus();
    const replace = () => live.current.place?.(el.current!);
    window.addEventListener("resize", replace);
    return () => {
      window.removeEventListener("resize", replace);
      removeEntry(entry);
    };
    // One registration for the overlay's life; `live` carries what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div {...rest} ref={el} tabIndex={rest.tabIndex ?? -1}>
      {children}
    </div>,
    document.getElementById(HOST)!,
  );
}

/** Where every overlay renders, and the listeners that send keys, outside clicks and focus to the top entry. Mounted once, beside the page. */
export function OverlayHost() {
  useEffect(() => {
    // Capture on window: before the app's shortcuts and before Monaco. Registered first, as this effect runs before App's.
    const keydown = (e: KeyboardEvent) => {
      if (topEntry()?.keys?.(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const mousedown = (e: MouseEvent) => {
      const t = e.target as Node;
      entriesOutside((x) => !!x.el?.contains(t) || (!!x.toggledByAnchor && !!x.anchor?.contains(t))).forEach((x) => closeOverlay(x, false));
    };
    const dismissTransient = () => transientEntries().forEach((x) => closeOverlay(x, false));
    const blur = () => {
      if (!keepOnBlur) dismissTransient();
    };
    const wheel = (e: Event) => {
      if (!transientEntries().some((x) => x.el?.contains(e.target as Node))) dismissTransient();
    };
    // Only scrolling what a menu belongs to closes it; editors and lists elsewhere scroll on their own.
    const scroll = (e: Event) => {
      const t = e.target;
      transientEntries().forEach((x) => {
        if (t === document || (t instanceof Node && x.anchor && t.contains(x.anchor))) closeOverlay(x, false);
      });
    };
    const page = () => document.querySelectorAll("[data-overlay-inert]").forEach((p) => p.toggleAttribute("inert", isModalOpen()));
    const stopWatching = watchStack(page);
    const stopTips = watchTooltips(document.getElementById(HOST)!);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("mousedown", mousedown, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: true });
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismissTransient);
    window.addEventListener("blur", blur);
    return () => {
      stopWatching();
      stopTips();
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("mousedown", mousedown, true);
      window.removeEventListener("wheel", wheel, { capture: true });
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismissTransient);
      window.removeEventListener("blur", blur);
    };
  }, []);

  return (
    <div className="ui-root ui-overlays" id={HOST}>
      <MenuLayer />
    </div>
  );
}
