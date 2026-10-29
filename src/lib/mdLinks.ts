// Links and images inside a rendered Markdown file.

export type LinkKind = "external" | "anchor" | "repo" | "blocked";

export function classifyLink(href: string): LinkKind {
  const h = href.trim();
  if (h.startsWith("#")) return "anchor";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(h)?.[1]?.toLowerCase();
  if (!scheme) return "repo";
  return scheme === "http" || scheme === "https" || scheme === "mailto" ? "external" : "blocked";
}

/** A repository-relative path for a link inside `fromPath`, or null if it leaves the repository. */
export function resolveRepoPath(fromPath: string, href: string): string | null {
  let target = href.split("#")[0].split("?")[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep it as written.
  }
  const parts = target.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}
