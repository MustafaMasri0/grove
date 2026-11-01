// Paths as the machine holding them shows them, for copying and for the file manager.
// Mirrors wv-core's paths::display_path.

export interface HostKind {
  kind: "local" | "wsl" | "ssh";
  distro: string | null;
  separator: string;
}

/** A host path (Linux path for WSL repositories, `D:/…` for local ones on Windows) as its machine shows it. */
export function displayPath(host: HostKind, path: string): string {
  if (host.kind === "wsl") return `\\\\wsl.localhost\\${host.distro}\\${path.replace(/^\/+/, "").replace(/\//g, "\\")}`;
  return path.replace(/\//g, host.separator);
}

/** Whether a path of this host can be shown in this machine's file manager. */
export function canReveal(host: HostKind): boolean {
  return host.kind !== "ssh";
}

/** The repository address for a host (`user@host:port` or a config alias) and a path on it. */
export function sshAddress(host: string, path: string): string {
  const where = host.trim().replace(/^ssh:\/\//i, "").replace(/\/+$/, "");
  const on = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return `ssh://${where}/${on}`;
}

/** The folder a clone of `url` goes into by default, as git names it: the address's last part without `.git`. */
export function repoNameFromUrl(url: string): string {
  return url.trim().replace(/[/\\]+$/, "").replace(/\.git$/, "").split(/[/\\:]/).pop() ?? "";
}

/** A worktree folder and a repository-relative path. */
export function joinPath(dir: string, rel: string): string {
  if (!rel) return dir;
  return `${dir.replace(/[\\/]+$/, "")}/${rel}`;
}

/** A repository-relative path with the separator of its host, as VS Code copies it. */
export function relativeForCopy(host: HostKind, rel: string): string {
  return rel.replace(/\//g, host.separator);
}

/** The commit's page on github.com, or null if `repo` is not `owner/name` or the sha is not hex. */
export function githubCommitUrl(repo: string | null, sha: string): string | null {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{4,64}$/i.test(sha)) return null;
  return `https://github.com/${repo}/commit/${sha}`;
}
