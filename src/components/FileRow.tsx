import type { ChangeKind } from "../api";
import { STATUS_LETTER, STATUS_TITLE, splitPath } from "../lib/format";
import { useStore } from "../store";
import { FileTypeIcon } from "./FileTypeIcon";

/**
 * `inTree`: the row sits under its folder in a tree, so only a rename's old path is shown.
 * `kind` null: no single change to show (the file is changed in different ways), so no colour or letter.
 */
export function FileRow({ path, origPath, kind, inTree }: { path: string; origPath?: string | null; kind: ChangeKind | null; inTree?: boolean }) {
  const { name, dir } = splitPath(path);
  const showDir = useStore((s) => s.settings.showFolderPath) && !inTree;
  const k = kind ? ` k-${kind}` : "";
  return (
    <span className={`file-row${k}`} title={`${kind ? `${STATUS_TITLE[kind]}: ` : ""}${origPath ? `${origPath} → ` : ""}${path}`}>
      <FileTypeIcon name={name} />
      <span className={`file-name${k}`}>{name}</span>
      {showDir && <span className="file-dir">{origPath ? `${origPath} → ${dir}` : dir}</span>}
      {inTree && <span className="file-dir">{origPath ? `from ${origPath}` : ""}</span>}
      {kind && <StatusLetter kind={kind} />}
    </span>
  );
}

export function StatusLetter({ kind }: { kind: ChangeKind }) {
  return <span className={`status-letter k-${kind}`}>{STATUS_LETTER[kind]}</span>;
}
