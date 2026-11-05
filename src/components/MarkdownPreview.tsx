import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { api, type Source } from "../api";
import { classifyLink, resolveRepoPath } from "../lib/mdLinks";
import { languageFor, monaco } from "../monaco";
import { useStore } from "../store";
import { fileTab, type FileTab } from "../tabs";
import { iconMarkup } from "./Icon";

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

/** Stands in for a picture that is not shown: its alternative text in a frame. */
function blockImage(img: HTMLImageElement, tip?: string) {
  const alt = img.getAttribute("alt") ?? "";
  const box = document.createElement("span");
  box.className = "md-blocked";
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", alt);
  if (tip) box.dataset.tip = tip;
  box.innerHTML = iconMarkup("file-media");
  const label = document.createElement("span");
  label.className = "ell";
  label.textContent = alt;
  box.append(label);
  img.replaceWith(box);
}

/** Markdown as sanitised HTML; GitHub-flavoured. */
export const markdownHtml = (text: string) => DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }) as string);

/** Fenced code in rendered Markdown gets the same highlighting as the editor. */
export function highlightCode(el: HTMLElement, cancelled: () => boolean) {
  el.querySelectorAll("pre > code").forEach((code) => {
    const lang = /language-([\w+#-]+)/.exec(code.className)?.[1];
    if (!lang) return;
    const id = languageFor(`x.${lang}`) !== "plaintext" ? languageFor(`x.${lang}`) : lang;
    monaco.editor.colorize(code.textContent ?? "", id, { tabSize: 4 }).then(
      (colored) => {
        if (!cancelled()) code.innerHTML = colored;
      },
      () => {},
    );
  });
}

/**
 * Rendered Markdown for a file tab. The HTML is sanitised before it reaches
 * the page; links never navigate the app window.
 */
export function MarkdownPreview({ text, tab }: { text: string; tab: FileTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const openTab = useStore((s) => s.openTab);
  const rev = tab.source.kind === "rev" ? tab.source.rev : null;
  const path = tab.path;

  const html = useMemo(() => markdownHtml(text), [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const at = { repo: tab.repo, cwd: tab.cwd };

    // Heading anchors, as on GitHub.
    const seen = new Map<string, number>();
    el.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      const base = slug(h.textContent ?? "");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      h.id = n ? `${base}-${n}` : base;
    });

    // Images from the repository are read through the app; web images are not loaded.
    el.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      img.removeAttribute("src");
      if (classifyLink(src) !== "repo") return blockImage(img, `Remote image not loaded: ${src}`);
      const resolved = resolveRepoPath(path, src);
      if (!resolved) return blockImage(img);
      const source: Source = rev ? { kind: "rev", rev, path: resolved } : { kind: "worktree", path: resolved };
      api.readImage(at, source).then(
        (url) => {
          if (cancelled) return;
          if (url) img.src = url;
          else blockImage(img);
        },
        () => {
          if (!cancelled) blockImage(img);
        },
      );
    });

    highlightCode(el, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html, path, rev, tab.repo, tab.cwd]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    switch (classifyLink(href)) {
      case "external":
        void openUrl(href);
        break;
      case "anchor":
        ref.current?.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)?.scrollIntoView();
        break;
      case "repo": {
        const target = resolveRepoPath(path, href);
        if (target) openTab(fileTab(tab.cwd, target, rev), false);
        break;
      }
    }
  };

  return (
    <div className="ui-root md-scroll">
      <article ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
