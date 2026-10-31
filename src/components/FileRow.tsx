import type { ChangeKind } from "../api";
import { splitPath } from "../lib/format";
import { STATUS_TITLE } from "../ui/classes";
import { StatusLetter, TreeChevron } from "../ui";
import { FileTypeIcon } from "./FileTypeIcon";
import type { ListRow } from "./ListView";

interface FileRow {
  path: string;
  origPath?: string | null;
  kind: ChangeKind;
  /** The row sits under its folder in a tree, so only a rename's old path is shown. */
  inTree?: boolean;
  /** The "Show folder path" setting. */
  showDir?: boolean;
}

/** One changed file: its icon, its name in its status colour, its folder and its status letter. */
export function fileRow({ path, origPath, kind, inTree, showDir }: FileRow): ListRow {
  const { name, dir } = splitPath(path);
  const where = inTree ? (origPath ? `from ${origPath}` : "") : showDir ? (origPath ? `${origPath} → ${dir}` : dir) : "";
  return {
    title: `${STATUS_TITLE[kind]}: ${origPath ? `${origPath} → ` : ""}${path}`,
    lead: (
      <>
        {inTree && <TreeChevron />}
        <FileTypeIcon name={name} />
      </>
    ),
    main: (
      <>
        <span className={`fname k-${kind}`}>{name}</span>
        <span className="fdir">{where}</span>
      </>
    ),
    trail: <StatusLetter kind={kind} />,
  };
}
