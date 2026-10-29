import { fileIconId, folderIconId, iconUrl } from "../lib/fileIcons";
import { languageFor } from "../monaco";
import { effectiveDark, useStore } from "../store";

const languages = new Map<string, string>();
const languageOf = (name: string) => {
  let lang = languages.get(name);
  if (lang === undefined) languages.set(name, (lang = languageFor(name)));
  return lang;
};

/** The Charmed icon for a file name, in the variant for the current theme. */
export function FileTypeIcon({ name }: { name: string }) {
  const dark = useStore(effectiveDark);
  return (
    <span className="ficon">
      <img src={iconUrl(fileIconId(name, languageOf(name)), dark)} alt="" draggable={false} />
    </span>
  );
}

/** The Charmed icon for a folder (named folders like src or docs have their own). */
export function FolderTypeIcon({ name, open }: { name: string; open: boolean }) {
  const dark = useStore(effectiveDark);
  return (
    <span className="ficon">
      <img src={iconUrl(folderIconId(name, open), dark)} alt="" draggable={false} />
    </span>
  );
}
