// Turns an HTML file from the repository into a page that is safe to render in the
// preview's sandboxed frame: nothing that runs or navigates, resources only from the
// repository (at the same revision, through the app's wvfile: scheme), and links
// sent back to the app. The frame itself has no scripts and an opaque origin; this
// rewrite, and the policy it puts first in <head>, make sure nothing reaches the network.
import { classifyLink, resolveRepoPath } from "./mdLinks";

export const PREVIEW_ORIGIN = "http://wvfile.localhost";
const O = PREVIEW_ORIGIN;

export const PREVIEW_CSP = [
  "default-src 'none'",
  `img-src ${O} data:`,
  `style-src ${O} 'unsafe-inline'`,
  `font-src ${O} data:`,
  "media-src 'none'",
  "script-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Elements that run code, embed other documents or change where URLs point. */
const REMOVE = "script, iframe, frame, frameset, object, embed, applet, portal, base, meta[http-equiv]";

/** `<link>`s other than stylesheets only prefetch, preload or point at icons: dropped. */
const isStylesheet = (el: Element) => (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet");

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/**
 * The HTML in `html`, from repository file `path`, ready for the preview frame's
 * srcdoc; `base` is the wvfile: URL of the repository root at the file's revision.
 * Links carry `nonce`, so only this page's own links are followed (see {@link linkTarget}).
 */
export function prepareHtml(html: string, path: string, base: string, nonce: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const docUrl = base + encodePath(path);

  /** A resource URL inside the root, a data: URL, or null to drop it. */
  const resource = (ref: string): string | null => {
    const r = ref.trim();
    if (!r) return null;
    if (/^data:/i.test(r)) return r;
    try {
      // A leading slash is the repository root, as on a static site served from it.
      const u = (r.startsWith("/") && !r.startsWith("//") ? new URL(r.slice(1), base) : new URL(r, docUrl)).href;
      return u.startsWith(base) ? u : null;
    } catch {
      return null;
    }
  };
  const css = (text: string) => rewriteCss(text, resource);
  const via = `${O}/~link?n=${encodeURIComponent(nonce)}&`;
  const link = (href: string): string | null => {
    const h = href.trim();
    if (h.startsWith("#")) return h;
    if (!h) return null;
    switch (classifyLink(h)) {
      case "external":
        return `${via}url=${encodeURIComponent(h)}`;
      case "repo": {
        const target = resolveRepoPath(path, h);
        return target ? `${via}open=${encodeURIComponent(target)}` : null;
      }
      default:
        return null;
    }
  };
  const set = (el: Element, attr: string, value: string | null) => (value === null ? el.removeAttribute(attr) : el.setAttribute(attr, value));
  const rewrite = (el: Element, attr: string, f: (v: string) => string | null) => {
    const v = el.getAttribute(attr);
    if (v !== null) set(el, attr, f(v));
  };
  const srcset = (v: string) => {
    const parts = v
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .map(([url, ...desc]) => {
        const u = url ? resource(url) : null;
        return u ? [u, ...desc].join(" ") : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  };

  doc.querySelectorAll(REMOVE).forEach((el) => el.remove());
  doc.querySelectorAll("link").forEach((el) => {
    const href = isStylesheet(el) ? resource(el.getAttribute("href") ?? "") : null;
    if (href) el.setAttribute("href", href);
    else el.remove();
  });

  for (const el of [...doc.getElementsByTagName("*")]) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || a.name === "ping" || a.name === "formaction" || a.name === "srcdoc") el.removeAttribute(a.name);
    }
    const tag = el.localName.toLowerCase();
    switch (tag) {
      case "a":
      case "area":
        rewrite(el, "href", link);
        rewrite(el, "xlink:href", link);
        el.removeAttribute("target");
        el.removeAttribute("download");
        break;
      case "img":
      case "source":
        rewrite(el, "src", resource);
        rewrite(el, "srcset", srcset);
        break;
      case "input":
        rewrite(el, "src", resource);
        break;
      case "video":
      case "audio":
      case "track":
        el.removeAttribute("src");
        rewrite(el, "poster", resource);
        break;
      case "image":
      case "use":
      case "feimage":
        rewrite(el, "href", resource);
        rewrite(el, "xlink:href", resource);
        break;
      case "form":
        el.removeAttribute("action");
        break;
      case "style":
        el.textContent = css(el.textContent ?? "");
        break;
    }
    rewrite(el, "background", resource);
    rewrite(el, "style", css);
  }

  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", PREVIEW_CSP);
  doc.head.prepend(policy);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** CSS with every url() and @import pointed inside the root, or emptied. */
function rewriteCss(text: string, resource: (ref: string) => string | null): string {
  return text
    .replace(/@import\s+(['"])(.*?)\1/gi, (_m, _q, ref: string) => {
      const u = resource(ref);
      return u ? `@import "${u}"` : "@import none";
    })
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, ref: string) => {
      if (/^data:/i.test(ref.trim())) return m;
      const u = resource(ref);
      return u ? `url("${u}")` : "none";
    });
}

export type LinkTarget = { kind: "repo"; path: string } | { kind: "external"; url: string };

/**
 * Where a link clicked in a preview goes, from the query of its `~link` URL; null
 * unless it carries the shown page's `nonce`.
 */
export function linkTarget(query: string, nonce: string): LinkTarget | null {
  const q = new URLSearchParams(query);
  if (!nonce || q.get("n") !== nonce) return null;
  const open = q.get("open");
  if (open) return { kind: "repo", path: open };
  const url = q.get("url");
  if (url && classifyLink(url) === "external") return { kind: "external", url };
  return null;
}
