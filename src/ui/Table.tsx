import type { HTMLAttributes, KeyboardEvent } from "react";
import { Icon } from "../components/Icon";
import { cx } from "./classes";

export interface SortHeaderProps {
  text: string;
  /** This column is the sorted one. */
  on?: boolean;
  dir?: 1 | -1;
  /** "r" aligns the column right. */
  className?: string;
  width?: string;
  tip?: string;
  onSort: () => void;
}

/** A column header that sorts: a real button, so the keyboard needs nothing more. */
export function SortHeader({ text, on, dir = 1, className, width, tip, onSort }: SortHeaderProps) {
  return (
    <th className={className} style={width ? { width } : undefined} aria-sort={on ? (dir > 0 ? "ascending" : "descending") : "none"}>
      <button type="button" className="dt-sort" data-tip={tip} onClick={onSort}>
        <span className="ell">{text}</span>
        <Icon name="chevron-down" size={10} />
      </button>
    </th>
  );
}

/** A table row that opens something: by click, and by Enter or Space when it has focus. */
export function TableRow({ onOpen, className, children, ...rest }: HTMLAttributes<HTMLTableRowElement> & { onOpen: () => void }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    onOpen();
  };
  return (
    <tr {...rest} className={cx("dt-row", className)} tabIndex={0} onClick={onOpen} onKeyDown={onKeyDown}>
      {children}
    </tr>
  );
}
