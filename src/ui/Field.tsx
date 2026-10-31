import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { Icon } from "../components/Icon";
import { cx } from "./classes";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  /** The accessible name; defaults to the placeholder. */
  label?: string;
  /** Adds the search icon. */
  search?: boolean;
  /** Quiet text inside the right edge. */
  suffix?: string;
  invalid?: boolean;
  /** The code font, for paths and SHAs. */
  mono?: boolean;
  /** Only an outline until it is used: a filter at the top of a list. */
  quiet?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Text field. Wrap it with a label when it has a visible one. */
export function Field({ label, search, suffix, invalid, mono, quiet, className, type = "text", ...rest }: FieldProps) {
  const wrapped = search || suffix;
  const input = (
    <input
      {...rest}
      type={type}
      className={cx("field", mono && "mono", invalid && "invalid", quiet && "quiet", !wrapped && className)}
      aria-label={label ?? rest.placeholder}
      aria-invalid={invalid ? true : undefined}
      spellCheck={false}
    />
  );
  if (!wrapped) return input;
  return (
    <span className={cx("field-w", search && "has-ic", className)}>
      {search && <Icon name="search" size={13} />}
      {input}
      {suffix && <span className="field-sfx">{suffix}</span>}
    </span>
  );
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & { text?: ReactNode; label?: string; tip?: string };

/** Checkbox, the only on/off control. `text` is its visible label; without one give `label`. */
export function Checkbox({ text, label, tip, className, disabled, ...rest }: CheckboxProps) {
  return (
    <label className={cx("chk", disabled && "off", className)} data-tip={tip}>
      <input {...rest} type="checkbox" disabled={disabled} aria-label={text ? undefined : label} />
      <span className="box">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.2 5 8.6 9.6 3.6" />
        </svg>
      </span>
      {text && <span>{text}</span>}
    </label>
  );
}

/** Slider, for Swipe and Opacity. */
export function Slider({ text, tip, min = 0, max = 100, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> & { text: string; tip?: string }) {
  return (
    <label className="sld" data-tip={tip}>
      {text}
      <input {...rest} type="range" min={min} max={max} />
    </label>
  );
}
