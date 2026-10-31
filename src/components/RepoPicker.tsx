import { useRef, useState } from "react";
import { repoItems } from "../lib/contextMenus";
import { canReveal, displayPath } from "../lib/hostPaths";
import { menuEnv } from "../menuEnv";
import { useStore } from "../store";
import { Button, closeOverlay, Picker, type PickerItem } from "../ui";
import { AddRepoDialog } from "./AddRepoDialog";
import { Icon } from "./Icon";

/** Top of the rail: picks the repository, and opens the dialog that adds one. */
export function RepoPicker() {
  const settings = useStore((s) => s.settings);
  const repos = useStore((s) => s.repos);
  const repo = useStore((s) => s.repo);
  const selectRepo = useStore((s) => s.selectRepo);
  const removeRepo = useStore((s) => s.removeRepo);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);

  const items: PickerItem[] = settings.repos.map((r) => {
    const info = repos[r];
    const name = info && "name" in info ? info.name : r.split(/[\\/]/).filter(Boolean).pop() ?? r;
    return {
      key: r,
      label: name,
      detail: info && "error" in info ? <span className="repo-ed" title={info.error}>⚠ {info.error}</span> : r,
      search: `${name} ${r}`,
      current: repo?.id === r,
      menu: () => repoItems(menuEnv, { name, path: info && "root" in info ? displayPath(info, info.root) : null, reveal: !!info && "root" in info && canReveal(info), remove: () => removeRepo(r) }),
      trailing: (
        <Button
          kind="ghost"
          size="sm"
          icon="close"
          label="Remove from list"
          className="mi-x"
          tip="Remove from list"
          onClick={(e) => {
            e.stopPropagation();
            removeRepo(r);
          }}
        />
      ),
    };
  });

  const title = repo ? repo.name : "Add a repository";
  return (
    <>
      <Button ref={button} kind="ghost" className="t-repo" icon="folder" text={title} after={<Icon name="chevron-down" size={10} />} tip={repo?.id ?? "Repository"} aria-label={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => (items.length ? setOpen(!open) : setAdding(true))} />
      {open && (
        <Picker
          anchor={button.current}
          items={items}
          onPick={(k) => void selectRepo(k)}
          onClose={() => setOpen(false)}
          searchable
          placeholder="Filter repositories"
          label="Repository"
          width={440}
          footer={
            <Button
              kind="primary"
              icon="add"
              text="Add repository…"
              onClick={() => {
                closeOverlay();
                setAdding(true);
              }}
            />
          }
        />
      )}
      {adding && <AddRepoDialog returnFocus={button.current} onClose={() => setAdding(false)} />}
    </>
  );
}
