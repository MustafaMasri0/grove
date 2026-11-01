import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useId, useRef, useState } from "react";
import { api, errorText } from "../api";
import { repoNameFromUrl, sshAddress } from "../lib/hostPaths";
import { useStore } from "../store";
import { Button, closeOverlay, Dialog, Field, Tray, type TrayItem } from "../ui";
import "../addRepo.css";

type Source = "local" | "ssh" | "clone";

const SOURCES: readonly TrayItem<Source>[] = [
  ["local", "Local folder"],
  ["ssh", "SSH"],
  ["clone", "Clone"],
];

const WORDING: Record<Source, { go: string; busy: string; missing: string }> = {
  local: { go: "Add repository", busy: "Adding…", missing: "Enter a folder path" },
  ssh: { go: "Connect", busy: "Connecting…", missing: "Enter a host and a path" },
  clone: { go: "Clone", busy: "Cloning…", missing: "Enter an address and a location" },
};

/** Adds a repository from a folder, over SSH, or by cloning one. A failed attempt stays open with what was typed, so it can be corrected. */
export function AddRepoDialog({ returnFocus, onClose }: { returnFocus: HTMLElement | null; onClose: () => void }) {
  const addRepo = useStore((s) => s.addRepo);
  const [source, setSource] = useState<Source>("local");
  const [folder, setFolder] = useState("");
  const [host, setHost] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [url, setUrl] = useState("");
  const [location, setLocation] = useState("");
  const [typedName, setTypedName] = useState("");
  const [progress, setProgress] = useState("");
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

  useEffect(() => {
    const stop = listen<string>("clone-progress", (e) => setProgress(e.payload));
    return () => void stop.then((f) => f());
  }, []);

  const address = source === "local" ? folder.trim() : host.trim() && remotePath.trim() ? sshAddress(host, remotePath) : "";
  const cloneName = typedName.trim() || repoNameFromUrl(url);
  const ready = source === "clone" ? !!(url.trim() && location.trim() && cloneName) : !!address;

  /** Finds the path to open, then opens it. */
  const attempt = async (where: () => string | Promise<string>) => {
    if (adding) return;
    setError(null);
    setProgress("");
    setAdding(true);
    try {
      await addRepo(await where());
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
    await attempt(() => picked);
  };

  const browseLocation = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Choose where to clone the repository" });
    if (typeof picked === "string") setLocation(picked);
  };

  const { go, busy, missing } = WORDING[source];

  return (
    <Dialog
      title="Add repository"
      className="repo-dlg"
      returnFocus={returnFocus}
      onClose={onClose}
      foot={
        <>
          <Button text="Cancel" onClick={() => closeOverlay()} />
          <Button kind="primary" type="submit" form={formId} text={adding ? busy : go} loading={adding} disabled={ready ? undefined : missing} />
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
            if (!ready) return;
            void attempt(source === "clone" ? () => api.cloneRepo(url.trim(), location.trim(), cloneName) : () => address);
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
          ) : source === "clone" ? (
            <>
              <div className="repo-f">
                <label htmlFor={`${formId}-url`}>Address</label>
                <Field id={`${formId}-url`} data-autofocus autoFocus mono placeholder="https://example.com/user/example.git" value={url} onChange={(e) => setUrl(e.target.value)} />
                <p>An https://, ssh:// or user@host:path address. Sign-in must already work with git.</p>
              </div>
              <div className="repo-f">
                <label htmlFor={`${formId}-location`}>Location</label>
                <div className="repo-browse">
                  <Field id={`${formId}-location`} mono value={location} onChange={(e) => setLocation(e.target.value)} />
                  <Button text="Browse…" disabled={adding ? busy : undefined} onClick={() => void browseLocation()} />
                </div>
              </div>
              <div className="repo-f">
                <label htmlFor={`${formId}-name`}>Folder name (optional)</label>
                <Field id={`${formId}-name`} mono placeholder={repoNameFromUrl(url)} value={typedName} onChange={(e) => setTypedName(e.target.value)} />
              </div>
            </>
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
        {adding && progress && (
          <div className="repo-progress" role="status" title={progress}>
            {progress}
          </div>
        )}
        {error && (
          <div className="repo-err" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
