import type { ChangeKind } from "../api";
import { STATUS_LETTER, STATUS_TITLE, splitPath } from "../lib/format";
import { useStore } from "../store";
import { FileTypeIcon } from "./FileTypeIcon";

export function FileRow({ path, origPath, kind }: { path: string; origPath?: string | null; kind: ChangeKind }) {
  const { name, dir } = splitPath(path);
  const showDir = useStore((s) => s.settings.showFolderPath);
  return (
    <span className={`file-row k-${kind}`} title={`${STATUS_TITLE[kind]}: ${origPath ? `${origPath} → ` : ""}${path}`}>
      <FileTypeIcon name={name} />
      <span className={`file-name k-${kind}`}>{name}</span>
      {showDir && <span className="file-dir">{origPath ? `${origPath} → ${dir}` : dir}</span>}
      <span className={`status-letter k-${kind}`}>{STATUS_LETTER[kind]}</span>
    </span>
  );
}
