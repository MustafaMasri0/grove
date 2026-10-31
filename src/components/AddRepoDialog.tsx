import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useId, useRef, useState } from "react";
import { errorText } from "../api";
import { sshAddress } from "../lib/hostPaths";
import { useStore } from "../store";
import { Button, closeOverlay, Dialog, Field, Tray, type TrayItem } from "../ui";
import "../addRepo.css";

type Source = "local" | "ssh";

const SOURCES: readonly TrayItem<Source>[] = [
  ["local", "Local folder"],
  ["ssh", "SSH"],
];

/** Adds a repository from a folder or over SSH. A failed attempt stays open with what was typed, so it can be corrected. */
export function AddRepoDialog({ returnFocus, onClose }: { returnFocus: HTMLElement | null; onClose: () => void }) {
  const addRepo = useStore((s) => s.addRepo);
  const [source, setSource] = useState<Source>("local");
  const [folder, setFolder] = useState("");
  const [host, setHost] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const dismissed = useRef(false);

  useEffect(() => {
    dismissed.current = false;
    return () => {
      dismissed.current = true;
    };
  }, []);

  const address = source === "local" ? folder.trim() : host.trim() && remotePath.trim() ? sshAddress(host, remotePath) : "";

  const add = async (where: string) => {
    if (!where || adding) return;
    setError(null);
    setAdding(true);
    try {
      await addRepo(where);
      // Closing again after a dismissal would close whatever is on top by then.
      if (!dismissed.current) closeOverlay();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  const browse = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Choose a git repository folder" });
    if (typeof picked !== "string") return;
    setFolder(picked);
    await add(picked);
  };

  const missing = source === "local" ? "Enter a folder path" : "Enter a host and a path";
  const busy = source === "local" ? "Adding…" : "Connecting…";
  const go = source === "local" ? "Add repository" : "Connect";

  return (
    <Dialog
      title="Add repository"
      className="repo-dlg"
      returnFocus={returnFocus}
      onClose={onClose}
      foot={
        <>
          <Button text="Cancel" onClick={() => closeOverlay()} />
          <Button kind="primary" type="submit" form={formId} text={adding ? busy : go} loading={adding} disabled={address ? undefined : missing} />
        </>
      }
    >
      <div className="repo-add">
        <Tray
          label="Where the repository is"
          value={source}
          items={SOURCES}
          onChange={(next) => {
            setSource(next);
            setError(null);
          }}
        />
        <form
          id={formId}
          key={source}
          className="repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add(address);
          }}
        >
          {source === "local" ? (
            <div className="repo-f">
              <label htmlFor={`${formId}-folder`}>Folder</label>
              <div className="repo-browse">
                <Field id={`${formId}-folder`} data-autofocus autoFocus mono value={folder} onChange={(e) => setFolder(e.target.value)} />
                <Button text="Browse…" disabled={adding ? busy : undefined} onClick={() => void browse()} />
              </div>
              <p>A folder on this computer or in WSL, or anything inside it.</p>
            </div>
          ) : (
            <>
              <div className="repo-f">
                <label htmlFor={`${formId}-host`}>Host</label>
                <Field id={`${formId}-host`} data-autofocus autoFocus mono placeholder="user@host, or a name from ssh config" value={host} onChange={(e) => setHost(e.target.value)} />
              </div>
              <div className="repo-f">
                <label htmlFor={`${formId}-path`}>Path</label>
                <Field id={`${formId}-path`} mono placeholder="/home/user/src/example or ~/example" value={remotePath} onChange={(e) => setRemotePath(e.target.value)} />
              </div>
            </>
          )}
          {/* The submit button sits in the dialog's footer, so Enter needs one inside the form. */}
          <button type="submit" hidden />
        </form>
        {error && (
          <div className="repo-err" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
