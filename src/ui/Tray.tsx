import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../components/Icon";
import { cx, thumbInsets } from "./classes";

export type TrayItem<K extends string> = readonly [key: K, label: string, disabledReason?: string];

interface TrayProps<K extends string> {
  label: string;
  value: K;
  items: readonly TrayItem<K>[];
  /** "tablist" for views, "group" for a pressed choice. */
  role?: "tablist" | "group";
  small?: boolean;
  className?: string;
  onChange?: (key: K) => void;
}

/** Segmented tray. The thumb slides to the selected button; its first placement is instant. */
export function Tray<K extends string>({ label, value, items, role = "group", small, className, onChange }: TrayProps<K>) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const tabs = role === "tablist";

  useLayoutEffect(() => {
    const on = box.current?.querySelector<HTMLElement>("[aria-selected='true'],[aria-pressed='true']");
    const t = thumb.current;
    if (!t || !on || !box.current) return;
    const { left, right } = thumbInsets(box.current.clientWidth, on.offsetLeft, on.offsetWidth);
    if (!placed.current) t.style.transition = "none";
    t.style.opacity = "1";
    t.style.left = `${left}px`;
    t.style.right = `${right}px`;
    if (!placed.current) {
      placed.current = true;
      void t.offsetWidth;
      t.style.transition = "";
    }
  });

  return (
    <div ref={box} className={cx("tray", small && "small", className)} role={tabs ? "tablist" : "group"} aria-label={label}>
      <span ref={thumb} className="glide" />
      {items.map(([key, text, reason]) => (
        <button
          key={key}
          type="button"
          role={tabs ? "tab" : undefined}
          aria-selected={tabs ? value === key : undefined}
          aria-pressed={tabs ? undefined : value === key}
          aria-disabled={reason ? true : undefined}
          data-tip={reason}
          onClick={reason ? undefined : () => onChange?.(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export type IconTabItem<K extends string> = readonly [key: K, label: string, icon: IconName, tip?: string, trailing?: ReactNode];

/** Icon tabs: only the active tab shows its label; the rest name themselves in a tooltip (`tip`, which also goes on the active tab, can add a shortcut). */
export function IconTabs<K extends string>({ label, value, items, onChange }: { label: string; value: K; items: readonly IconTabItem<K>[]; onChange?: (key: K) => void }) {
  return (
    <div className="itabs" role="tablist" aria-label={label}>
      {items.map(([key, text, icon, tip, trailing]) => (
        <button key={key} type="button" role="tab" aria-selected={value === key} aria-label={text} data-tip={tip ?? (value === key ? undefined : text)} onClick={() => onChange?.(key)}>
          <Icon name={icon} size={14} />
          {value === key && <span>{text}</span>}
          {trailing}
        </button>
      ))}
    </div>
  );
}
