import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRef, useState } from "react";
import { errorText } from "../api";
import { repoItems } from "../lib/contextMenus";
import { canReveal, displayPath, sshAddress } from "../lib/hostPaths";
import { menuEnv } from "../menuEnv";
import { useStore } from "../store";
import { Button, Field, Picker, type PickerItem } from "../ui";
import { Icon } from "./Icon";

/** Top of the rail: the repository, and everything that adds one. */
export function RepoPicker() {
  const settings = useStore((s) => s.settings);
  const repos = useStore((s) => s.repos);
  const repo = useStore((s) => s.repo);
  const selectRepo = useStore((s) => s.selectRepo);
  const addRepo = useStore((s) => s.addRepo);
  const removeRepo = useStore((s) => s.removeRepo);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ssh, setSsh] = useState<{ host: string; path: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const close = () => setOpen(false);

  const add = async (path: string) => {
    if (!path.trim() || connecting) return;
    setError(null);
    setConnecting(true);
    try {
      await addRepo(path.trim());
      setTyped("");
      setSsh(null);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  };

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
      <Button ref={button} kind="ghost" className="t-repo" icon="folder" text={title} after={<Icon name="chevron-down" size={10} />} tip={repo?.id ?? "Repository"} aria-label={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <Picker
          anchor={button.current}
          items={items}
          onPick={(k) => void selectRepo(k)}
          onClose={close}
          searchable
          placeholder="Filter repositories"
          label="Repository"
          width={440}
          footer={
            <>
              <Button
                kind="primary"
                text="Add repository folder…"
                onClick={async () => {
                  const picked = await openDialog({ directory: true, multiple: false, title: "Choose a git repository folder" });
                  if (typeof picked === "string") await add(picked);
                }}
              />
              <Button text="Connect over SSH…" aria-expanded={!!ssh} onClick={() => setSsh(ssh ? null : { host: "", path: "" })} />
              {ssh && (
                <form
                  className="repo-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (ssh.host.trim() && ssh.path.trim()) void add(sshAddress(ssh.host, ssh.path));
                  }}
                >
                  <Field autoFocus placeholder="user@host, or a name from ssh config" value={ssh.host} onChange={(e) => setSsh({ ...ssh, host: e.target.value })} />
                  <Field placeholder="path, e.g. /home/user/src/example or ~/example" value={ssh.path} onChange={(e) => setSsh({ ...ssh, path: e.target.value })} />
                  <Button kind="primary" type="submit" text={connecting ? "Connecting…" : "Connect"} disabled={connecting ? "Connecting…" : undefined} />
                </form>
              )}
              <form
                className="repo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(typed);
                }}
              >
                <Field placeholder="or paste a path, or ssh://user@host/path" value={typed} onChange={(e) => setTyped(e.target.value)} />
              </form>
              {error && (
                <div className="repo-err" role="alert">
                  {error}
                </div>
              )}
            </>
          }
        />
      )}
    </>
  );
}
