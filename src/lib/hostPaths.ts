// Paths as Windows shows them, for copying and for File Explorer.
// Mirrors wv-core's paths::wsl_unc and WorktreeInfo.displayPath.

export interface HostKind {
  kind: "windows" | "wsl";
  distro: string | null;
}

/** A host path (Linux path for WSL repositories, `D:/…` for Windows ones) as a Windows path. */
export function windowsPath(host: HostKind, path: string): string {
  if (host.kind === "wsl") return `\\\\wsl.localhost\\${host.distro}\\${path.replace(/^\/+/, "").replace(/\//g, "\\")}`;
  return path.replace(/\//g, "\\");
}

/** A worktree folder and a repository-relative path. */
export function joinPath(dir: string, rel: string): string {
  if (!rel) return dir;
  return `${dir.replace(/[\\/]+$/, "")}/${rel}`;
}

/** A repository-relative path with the separator of its host, as VS Code copies it. */
export function relativeForCopy(host: HostKind, rel: string): string {
  return host.kind === "windows" ? rel.replace(/\//g, "\\") : rel;
}

/** The commit's page on github.com, or null if `repo` is not `owner/name` or the sha is not hex. */
export function githubCommitUrl(repo: string | null, sha: string): string | null {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{4,64}$/i.test(sha)) return null;
  return `https://github.com/${repo}/commit/${sha}`;
}
