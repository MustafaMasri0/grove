import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { api } from "../api";
import { linkTarget, prepareHtml } from "../lib/htmlPreview";
import { scriptsAllowed } from "../lib/settings";
import { useStore, type Tab } from "../store";
import { fileTab } from "../tabs";

const newNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The page the preview shows, for the WV_PREVIEW_LINK test hook (the frame's own document cannot be read). */
export const previewForTest = { html: "" };

/**
 * A rendered HTML file. The page is prepared here, kept by the backend and loaded by
 * the frame from wvfile: under its own policy. The frame is sandboxed with an opaque
 * origin, so it cannot reach the app; nothing reaches the network. Its images,
 * stylesheets (and, when the repository allows it, scripts) come from the repository
 * at the file's revision; its links come back to the app (as `preview-link`), which
 * opens them like Markdown links.
 */
export function HtmlPreview({ text, tab }: { text: string; tab: Tab }) {
  const openTab = useStore((s) => s.openTab);
  const scripts = useStore((s) => scriptsAllowed(s.settings, tab.repo));
  const spec = tab.spec.type === "file" ? tab.spec : null;
  const rev = spec?.source.kind === "rev" ? spec.source.rev : null;
  const path = spec?.path ?? "";
  const [base, setBase] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; nonce: string; scripts: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    api.previewBase({ repo: tab.repo, cwd: tab.cwd }, rev).then((b) => live && setBase(b), () => {});
    return () => {
      live = false;
    };
  }, [tab.repo, tab.cwd, rev]);

  // The backend keeps the page only while this preview shows it.
  useEffect(() => {
    if (!base) return;
    let live = true;
    let url: string | null = null;
    const nonce = newNonce();
    const html = prepareHtml(text, path, base, nonce, scripts);
    previewForTest.html = html;
    api.previewPage(html, scripts).then(
      (u) => {
        url = u;
        if (live) setPage({ url: u, nonce, scripts });
        else void api.dropPreviewPage(u);
      },
      () => {},
    );
    return () => {
      live = false;
      if (url) void api.dropPreviewPage(url);
    };
  }, [text, path, base, scripts]);

  useEffect(() => {
    if (!page) return;
    const un = listen<string>("preview-link", async (e) => {
      const t = linkTarget(e.payload, page.nonce);
      if (t?.kind === "repo") openTab(fileTab(tab.cwd, t.path, rev), false);
      else if (t?.kind === "external") {
        // A script could fake a click to send the page somewhere; with scripts on, the user decides.
        if (page.scripts && !(await ask(`This page wants to open a link in your browser:\n\n${t.url}`, { title: "Open link?", kind: "warning", okLabel: "Open", cancelLabel: "Cancel" }))) return;
        void openUrl(t.url);
      }
    });
    return () => void un.then((f) => f());
  }, [page, tab.cwd, rev, openTab]);

  if (!page) return null;
  // A new frame for each page, so the sandbox it was created with always matches.
  return (
    <div className="ui-root html-wrap">
      <iframe key={page.url} className="html-preview" title={path} sandbox={page.scripts ? "allow-scripts" : ""} referrerPolicy="no-referrer" src={page.url} />
    </div>
  );
}
