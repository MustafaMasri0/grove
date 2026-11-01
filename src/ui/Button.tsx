import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type IconName } from "../components/Icon";
import { cx } from "./classes";
import { Spinner } from "./Feedback";

type NativeButton = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "children">;

export interface ButtonProps extends NativeButton {
  kind?: "secondary" | "primary" | "ghost" | "link";
  size?: "md" | "sm";
  icon?: IconName;
  text?: string;
  /** The accessible name of an icon-only button. */
  label?: string;
  /** Tooltip text. */
  tip?: string;
  /** The reason it is unavailable: the button stays focusable and shows the reason as its tooltip. */
  disabled?: string | boolean;
  /** Dims the label and turns the icon into a spinner. */
  loading?: boolean;
  after?: ReactNode;
}

export function Button({ kind = "secondary", size = "md", icon, text, label, tip, disabled, loading, after, className, type = "button", onClick, ref, ...rest }: ButtonProps & { ref?: Ref<HTMLButtonElement> }) {
  const only = !!icon && !text;
  const iconSize = size === "sm" ? 13 : 14;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("btn", kind !== "secondary" && kind, size === "sm" && "sm", only && "only", className)}
      aria-label={only ? label : rest["aria-label"]}
      aria-disabled={disabled ? true : undefined}
      data-tip={disabled ? (disabled === true ? "" : disabled) : tip}
      data-loading={loading ? "" : undefined}
      onClick={disabled || loading ? undefined : onClick}
    >
      {loading ? <Spinner size={iconSize} /> : icon && <Icon name={icon} size={iconSize} />}
      {text && <span className="btn-l">{text}</span>}
      {after}
    </button>
  );
}

/** A Button with a pressed state. Tone "changes" tints it blue when on. */
export function Toggle({ on, tone, className, kind = "ghost", ...rest }: ButtonProps & { on?: boolean; tone?: "changes" }) {
  return <Button {...rest} kind={kind} aria-pressed={!!on} className={cx("tgl", tone === "changes" && "tone-changes", className)} />;
}

/** A main action and the chevron that opens its menu, so a second action does not need its own button. */
export function SplitButton({ main, more }: { main: ButtonProps; more: ButtonProps & { label: string } }) {
  return (
    <div className="split">
      <Button {...main} />
      <Button {...more} kind={main.kind} size={main.size} icon="chevron-down" aria-haspopup="menu" />
    </div>
  );
}
