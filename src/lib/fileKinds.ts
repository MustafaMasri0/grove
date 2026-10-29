// Which view a file opens in: a picture, rendered HTML or Markdown, or the editor.

export type ViewKind = "image" | "html" | "markdown" | "text";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);

function ext(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function viewKind(path: string): ViewKind {
  const e = ext(path);
  if (IMAGE.has(e)) return "image";
  if (e === "html" || e === "htm") return "html";
  if (e === "md" || e === "markdown") return "markdown";
  return "text";
}

export const isImagePath = (path: string) => viewKind(path) === "image";
