import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { linkTarget, prepareHtml } from "../lib/htmlPreview";
import { useStore, type Tab } from "../store";
import { fileTab } from "../tabs";

const newNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * A rendered HTML file. The frame is sandboxed with nothing allowed: no scripts, no
 * forms or popups, and an opaque origin, so it cannot reach the app. Its images and
 * stylesheets come from the repository at the file's revision; its links come back
 * to the app (as `preview-link`), which opens them like Markdown links.
 */
export function HtmlPreview({ text, tab }: { text: string; tab: Tab }) {
  const openTab = useStore((s) => s.openTab);
  const spec = tab.spec.type === "file" ? tab.spec : null;
  const rev = spec?.source.kind === "rev" ? spec.source.rev : null;
  const path = spec?.path ?? "";
  const [base, setBase] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.previewBase({ repo: tab.repo, cwd: tab.cwd }, rev).then((b) => live && setBase(b), () => {});
    return () => {
      live = false;
    };
  }, [tab.repo, tab.cwd, rev]);

  const page = useMemo(() => {
    if (!base) return null;
    const nonce = newNonce();
    return { nonce, html: prepareHtml(text, path, base, nonce) };
  }, [text, path, base]);

  useEffect(() => {
    if (!page) return;
    const un = listen<string>("preview-link", (e) => {
      const t = linkTarget(e.payload, page.nonce);
      if (t?.kind === "external") void openUrl(t.url);
      else if (t?.kind === "repo") openTab(fileTab(tab.cwd, t.path, rev), false);
    });
    return () => void un.then((f) => f());
  }, [page, tab.cwd, rev, openTab]);

  if (!page) return null;
  return <iframe className="html-preview" title={path} sandbox="" referrerPolicy="no-referrer" srcDoc={page.html} />;
}
