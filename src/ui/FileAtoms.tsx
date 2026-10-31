import type { ChangeKind } from "../api";
import { Icon } from "../components/Icon";
import { STATUS_LETTER, STATUS_TITLE, cx, splitDisplayPath } from "./classes";

export function StatusLetter({ kind }: { kind: ChangeKind }) {
  return (
    <span className={cx("sl", `k-${kind}`)} title={STATUS_TITLE[kind]}>
      {STATUS_LETTER[kind]}
    </span>
  );
}

/** The chevron column of a tree row. It turns as a folder opens; a file keeps the column empty, so names line up. */
export function TreeChevron({ folder, open }: { folder?: boolean; open?: boolean }) {
  return (
    <span className="tchev" data-open={!!open}>
      {folder && <Icon name="chevron-right" size={10} />}
    </span>
  );
}

/** Lines added and removed. */
export function Delta({ add, del }: { add: number; del: number }) {
  return (
    <span className="delta">
      <i>+{add}</i> <u>−{del}</u>
    </span>
  );
}

/** A path with its file name emphasised. */
export function PathLabel({ path }: { path: string }) {
  const { dir, name } = splitDisplayPath(path);
  return (
    <span className="path" title={path}>
      <span>{dir}</span>
      <b>{name}</b>
    </span>
  );
}
