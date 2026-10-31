import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Button } from "./Button";
import { cx } from "./classes";
import { Count } from "./Status";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card", className)}>{children}</div>;
}

export function SectionLabel({ text }: { text: string }) {
  return <div className="sec-l">{text}</div>;
}

/** Header of a collapsible section. `plain` keeps the text as written (paths, folder names). */
export function FoldHead({ text, open, n, plain, className, onClick }: { text: string; open: boolean; n?: number; plain?: boolean; className?: string; onClick?: () => void }) {
  return (
    <button type="button" className={cx("sec", plain && "plain", className)} aria-expanded={open} onClick={onClick}>
      <Icon name="chevron-right" size={10} />
      <span>{text}</span>
      {n !== undefined && <Count n={n} />}
    </button>
  );
}

/** Opening and closing is instant: only the header's chevron turns. */
export function FoldBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="fold" data-open={open}>
      {children}
    </div>
  );
}

export interface RowProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  lead?: ReactNode;
  trail?: ReactNode;
  /** The selected row, a static fill. */
  on?: boolean;
  /** The row whose context menu is open. */
  menu?: boolean;
  /** Tree depth. */
  indent?: number;
  role?: string;
  /** Why it cannot be chosen: the row stays focusable, for its menu and its reason. */
  disabled?: string;
}

/** The one row of every list. */
export function Row({ lead, trail, on, menu, indent, role = "option", disabled, className, style, tabIndex = -1, onClick, children, ...rest }: RowProps) {
  return (
    <div
      {...rest}
      className={cx("row", on && "on", menu && "menu-target", className)}
      role={role}
      aria-selected={role === "option" ? !!on : undefined}
      aria-disabled={disabled ? true : undefined}
      data-tip={disabled}
      tabIndex={tabIndex}
      onClick={disabled ? undefined : onClick}
      style={indent ? { ...style, paddingLeft: 6 + indent * 14 } : style}
    >
      {lead}
      {children}
      {trail && <span className="row-t">{trail}</span>}
    </div>
  );
}

export function SettingRow(p: { label: string; description: string; control: ReactNode; htmlFor?: string; modified?: boolean; mono?: boolean; after?: ReactNode; extra?: ReactNode; reset?: ReactNode }) {
  return (
    <div className={cx("setting", p.modified && "modified")}>
      <span className="setting-l">
        <span className="setting-t">
          <label htmlFor={p.htmlFor}>
            <b>{p.label}</b>
          </label>
          {p.after}
        </span>
        <span className={cx("setting-d", p.mono && "mono")}>{p.description}</span>
        {p.extra}
        {p.reset}
      </span>
      <span className="setting-c">{p.control}</span>
    </div>
  );
}

export interface EditorTabProps extends Omit<HTMLAttributes<HTMLDivElement>, "role"> {
  text: string;
  on?: boolean;
  /** Italic title: the next preview replaces this tab. */
  preview?: boolean;
  icon?: IconName;
  /** Ready lead content, such as a file icon. */
  lead?: ReactNode;
  /** The tab's kind, such as ± for a diff. */
  mark?: string;
  closeTip?: string;
  onClose?: () => void;
}

export function EditorTab({ text, on, preview, icon, lead, mark, className, closeTip, onClose, ...rest }: EditorTabProps) {
  return (
    <div {...rest} className={cx("tab", on && "on", preview && "preview", className)} role="tab" aria-selected={!!on} tabIndex={0}>
      {lead ?? (icon && <Icon name={icon} size={13} />)}
      {mark && (
        <span className="tab-kind" aria-hidden="true">
          {mark}
        </span>
      )}
      <span className="ell">{text}</span>
      <Button
        kind="ghost"
        size="sm"
        icon="close"
        label={`Close ${text}`}
        tip={closeTip}
        onClick={(e) => {
          e.stopPropagation();
          onClose?.();
        }}
      />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="tools">{children}</div>;
}

/** A pane's edge. Dragging belongs to the shell; this is the handle. */
export function Resizer({ label, className, ...rest }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div {...rest} className={cx("resize", className)} role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0} />;
}
