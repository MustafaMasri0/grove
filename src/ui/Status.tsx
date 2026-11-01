import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./classes";

/** The approved state marks: rings. Changing turns its half-filled centre; Has changes has the same construction with a full one. */
export type MarkState = "active" | "changes" | "idle" | "error";

export function Mark({ state }: { state: MarkState }) {
  return (
    <span className="mark" data-s={state} aria-hidden="true">
      <svg className="m-live" viewBox="0 0 16 16">
        <circle className="ring" cx="8" cy="8" r="6" />
        <path className="pie" d="M8 4.4a3.6 3.6 0 0 1 0 7.2z" />
      </svg>
      <svg className="m-changes" viewBox="0 0 16 16">
        <circle className="ring" cx="8" cy="8" r="6" />
        <circle className="disc" cx="8" cy="8" r="3.6" />
      </svg>
      <svg className="m-error" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 4.9v3.5M8 10.9v.1" />
      </svg>
      <svg className="m-idle" viewBox="0 0 16 16">
        <circle className="ring" cx="8" cy="8" r="6" />
      </svg>
    </span>
  );
}

/** The possible-conflict triangle: amber, never the error colour. */
export function WarnTriangle() {
  return (
    <svg className="tri" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.6 14 13H2z" />
      <path d="M8 6.6v2.6M8 11.3v.1" />
    </svg>
  );
}

/** The tree that marks the main worktree: neutral, because a coloured one would read as a state. */
export function MainTreeMark() {
  return (
    <svg className="main-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 14.5V8M8 11 5.5 8.5M8 9.5l2.5-2" />
      <path d="M8 1.5c3 1 4.5 3.2 4 5.7-.4 1.8-2 2.8-4 2.8s-3.6-1-4-2.8C3.5 4.7 5 2.5 8 1.5Z" />
    </svg>
  );
}

export type BadgeTone ="" | "live" | "active" | "changes" | "idle" | "warn" | "error";

/** Badge. Coloured badges hide at zero: the caller leaves them out. */
export function Badge({ tone = "", tip, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; tip?: string }) {
  return (
    <span {...rest} className={cx("badge", tone, className)} data-tip={tip}>
      {children}
    </span>
  );
}

/** A worktree's state: only the exception gets a filled badge; normal states are the mark and its name. */
export function StateTag({ state, label }: { state: MarkState; label: string }) {
  const body = (
    <>
      <Mark state={state} />
      <span className="ell">{label}</span>
    </>
  );
  return state === "error" ? <Badge tone="error">{body}</Badge> : <span className={cx("st-tag", state)}>{body}</span>;
}

export function Count({ n, title }: { n: number; title?: string }) {
  return (
    <span className="count" title={title}>
      {n}
    </span>
  );
}

/** A small label; with onClick it is a button. */
export function Chip({ children, tip, className, onClick }: { children: ReactNode; tip?: string; className?: string; onClick?: () => void }) {
  return onClick ? (
    <button type="button" className={cx("chip", className)} data-tip={tip} onClick={onClick}>
      {children}
    </button>
  ) : (
    <span className={cx("chip", className)} data-tip={tip}>
      {children}
    </span>
  );
}

export function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="keys">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

/** Files that also change in another worktree: amber triangle and count. */
export function WarnMark({ n, title }: { n: number; title?: string }) {
  return (
    <span className="warn-mark" title={title}>
      <WarnTriangle />
      {n}
    </span>
  );
}
