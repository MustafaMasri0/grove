import type { ChangeKind } from "../api";
import { STATUS_LETTER, STATUS_TITLE, splitPath } from "../lib/format";
import { useStore } from "../store";
import { FileTypeIcon } from "./FileTypeIcon";

/** `inTree`: the row sits under its folder in a tree, so only a rename's old path is shown. */
export function FileRow({ path, origPath, kind, inTree }: { path: string; origPath?: string | null; kind: ChangeKind; inTree?: boolean }) {
  const { name, dir } = splitPath(path);
  const showDir = useStore((s) => s.settings.showFolderPath) && !inTree;
  return (
    <span className={`file-row k-${kind}`} title={`${STATUS_TITLE[kind]}: ${origPath ? `${origPath} → ` : ""}${path}`}>
      <FileTypeIcon name={name} />
      <span className={`file-name k-${kind}`}>{name}</span>
      {showDir && <span className="file-dir">{origPath ? `${origPath} → ${dir}` : dir}</span>}
      {inTree && <span className="file-dir">{origPath ? `from ${origPath}` : ""}</span>}
      <span className={`status-letter k-${kind}`}>{STATUS_LETTER[kind]}</span>
    </span>
  );
}
