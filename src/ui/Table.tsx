import type { HTMLAttributes, KeyboardEvent } from "react";
import { Icon } from "../components/Icon";
import { isMenuKey } from "../lib/menu";
import { cx } from "./classes";
import { menuAtElement, menuAtPointer, type RichMenuItem } from "./Menu";

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

/** Marks the row for as long as its menu is open; returns what unmarks it. */
const markRow = (row: Element) => {
  row.classList.add("menu-target");
  return () => row.classList.remove("menu-target");
};

/** A table row that opens something: by click, and by Enter or Space when it has focus. With `menu`, it has a context menu too. */
export function TableRow({ onOpen, menu, className, children, ...rest }: HTMLAttributes<HTMLTableRowElement> & { onOpen: () => void; menu?: () => readonly RichMenuItem[] }) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (menu && isMenuKey(e)) {
      e.preventDefault();
      menuAtElement(e.currentTarget, menu(), markRow(e.currentTarget));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <tr
      {...rest}
      className={cx("dt-row", className)}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onContextMenu={menu && ((e) => menuAtPointer(e, menu(), markRow(e.currentTarget)))}
    >
      {children}
    </tr>
  );
}
