import { useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./classes";
import { closeOverlay, Overlay } from "./Overlay";

const FOCUSABLE = 'button,input,select,a[href],[tabindex="0"]';
const focusables = (box: Element) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent && x.getAttribute("tabindex") !== "-1");

export interface DialogProps {
  title: string;
  /** Beside the title. */
  head?: ReactNode;
  foot?: ReactNode;
  className?: string;
  /** Where focus returns; by default what had it when this opened. */
  returnFocus?: HTMLElement | null;
  onClose: () => void;
  /** Returns true when it used Escape itself, such as clearing a search. */
  onEscape?: (e: KeyboardEvent) => boolean;
  children: ReactNode;
}

/** Modal and focus-trapped: the page behind goes inert. [data-autofocus] takes focus on opening. */
export function Dialog({ title, head, foot, className, returnFocus, onClose, onEscape, children }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (!onEscape?.(e)) closeOverlay();
      return true;
    }
    if (e.key !== "Tab") return false;
    const f = focusables(box.current!);
    if (!f.length) return true;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) f[f.length - 1].focus();
    else if (!e.shiftKey && i === f.length - 1) f[0].focus();
    else return false;
    return true;
  };

  return (
    <Overlay
      kind="dialog"
      className="dlg-wrap"
      modal
      keys={keys}
      returnFocus={returnFocus}
      onClose={onClose}
      focus={(el) => el.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(el)[0] ?? el}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeOverlay();
      }}
    >
      <div ref={box} className={cx("dlg", className)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dlg-h">
          <h2 id={titleId}>{title}</h2>
          {head}
          <Button kind="ghost" size="sm" icon="close" label="Close" className="dlg-x" onClick={() => closeOverlay()} />
        </header>
        <div className="dlg-b">{children}</div>
        {foot && <footer className="dlg-f">{foot}</footer>}
      </div>
    </Overlay>
  );
}
