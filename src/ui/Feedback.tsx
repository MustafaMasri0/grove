import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { Button } from "./Button";
import { cx } from "./classes";

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span className="spin" aria-hidden="true">
      <Icon name="sync" size={size} />
    </span>
  );
}

/** What a running git action last printed. */
export function ProgressLine({ text }: { text: string }) {
  return (
    <span className="prog-line" role="status">
      <Spinner size={12} />
      <span className="ell">{text}</span>
    </span>
  );
}

/** A still placeholder: no shimmer. */
export function Skeleton({ width = "100%", height = 8 }: { width?: string; height?: number }) {
  return <i className="sk" style={{ width, height }} />;
}

export interface BannerProps {
  tone?: "error" | "warn" | "view" | "neutral";
  /** Bold, before the text. */
  title?: string;
  text?: string;
  /** Shows the text as raw git output instead of one line. */
  pre?: boolean;
  /** Full width, on a region's edge. */
  flush?: boolean;
  lead?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
}

export function Banner({ tone = "neutral", title, text, pre, flush, lead, actions, onDismiss }: BannerProps) {
  return (
    <div className={cx("banner", tone, flush && "flush")} role={tone === "error" || tone === "warn" ? "alert" : "status"}>
      {lead}
      {title && <b>{title}</b>}
      {pre ? (
        <pre>{text}</pre>
      ) : (
        text && (
          <span className="ell" title={text}>
            {text}
          </span>
        )
      )}
      <span className="banner-a">
        {actions}
        {onDismiss && <Button kind="ghost" size="sm" icon="close" label="Dismiss" onClick={onDismiss} />}
      </span>
    </div>
  );
}

/** The empty state of a whole view. */
export function Empty({ title, text, action }: { title?: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {title && <h2>{title}</h2>}
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/** One quiet line in a list. */
export function EmptyLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-line">
      {children}
      {action}
    </div>
  );
}

export function LoadingLine({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="empty-line" role="status">
      {text}
    </div>
  );
}
