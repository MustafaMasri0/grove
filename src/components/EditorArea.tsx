import { useEffect, useRef, useState } from "react";
import { api, errorText, type Blame, type Content, type ImageSource } from "../api";
import { blameMargin, commitAtLine } from "../lib/blame";
import { tabItems } from "../lib/contextMenus";
import { editorOptions } from "../lib/editorOptions";
import { viewKind } from "../lib/fileKinds";
import { scriptsAllowed, withRunScripts } from "../lib/settings";
import { formatBytes, shortSha } from "../lib/format";
import { displayPath, joinPath } from "../lib/hostPaths";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { languageFor, monaco } from "../monaco";
import { effectiveDark, useStore, type Tab } from "../store";
import { isLive, revealPathOf, tabsToClose, type CloseWhich } from "../tabs";
import { menuEnv } from "../menuEnv";
import { menuAtElement, menuAtPointer } from "../ui";
import { FileTypeIcon } from "./FileTypeIcon";
import { HtmlPreview } from "./HtmlPreview";
import { ImageView } from "./ImageView";
import { MarkdownPreview } from "./MarkdownPreview";
import { SettingsPage } from "./SettingsPage";
import { WorktreesPage } from "./WorktreesPage";

type Editor = monaco.editor.IStandaloneCodeEditor;
type DiffEditor = monaco.editor.IStandaloneDiffEditor;
type ViewState = monaco.editor.ICodeEditorViewState | monaco.editor.IDiffEditorViewState | null;

/** What one tab shows; models are kept while the tab is open so switching tabs is instant. */
interface Doc {
  state: "loading" | "ready" | "message";
  message?: string;
  original?: monaco.editor.ITextModel;
  modified?: monaco.editor.ITextModel;
  viewState?: ViewState;
  loadedTick: number;
  revealed?: boolean;
  /** File views with blame on: who changed each line, for the content loaded at `tick`. */
  blame?: { tick: number; loading: boolean; data?: Blame; error?: string };
  /** Files and diffs: shown as pictures (`images`, one per side) or as text in the editors. */
  mode?: "image" | "text";
  images?: ImageSource[];
}

/** The editor commands keyboard shortcuts reach from outside Monaco. */
export const editorCommands = {
  focus: () => {},
  run: (_id: string) => {},
  goToDiff: (_dir: "next" | "previous") => {},
};

function describe(c: Content): string | null {
  if (c.kind === "binary") return `Binary file (${formatBytes(c.size)}) is not shown.`;
  if (c.kind === "tooLarge") return `File is too large to show (${formatBytes(c.size)}; the limit is 5 MB).`;
  return null;
}

const textOf = (c: Content) => (c.kind === "text" ? c.text : "");

/** Whether a file or diff tab shows pictures: image files, except SVG while Source is chosen. */
function showsImage(t: Tab, preview: boolean): boolean {
  const s = t.spec;
  if (s.type !== "file" && s.type !== "diff") return false;
  return viewKind(s.path) === "image" && (preview || !/\.svg$/i.test(s.path));
}

/** Tabs of different worktrees may share an id, and `HEAD` differs between them. */
const docKey = (t: Pick<Tab, "cwd" | "id">) => `${t.cwd}\n${t.id}`;

/** The file a tab shows, as a Windows path. */
function tabPath(t: Tab): string {
  if (t.spec.type === "settingsJson") return t.spec.path;
  const info = useStore.getState().repos[t.repo];
  return info && "kind" in info ? displayPath(info, joinPath(t.cwd, t.spec.path)) : t.spec.path;
}

/** The file and revision a tab's "View file history" walks from; null for app tabs. */
function tabHistory(t: Tab): { path: string; rev: string | null } | null {
  const s = t.spec;
  if (s.type === "file") return { path: s.path, rev: s.source.kind === "rev" ? s.source.rev : null };
  if (s.type === "diff") return { path: s.path, rev: s.right.kind === "rev" ? s.right.rev : s.left.kind === "rev" && s.right.kind === "empty" ? s.left.rev : null };
  return null;
}

function tabMenu(t: Tab): MenuItem[] {
  const { tabs, closeTab, closeTabs, pinTab } = useStore.getState();
  const close = (which: CloseWhich) => closeTabs(tabsToClose(useStore.getState().tabs, t.id, which), t.id);
  const hist = tabHistory(t);
  const reveal = revealPathOf(t, useStore.getState().cwd);
  return tabItems(menuEnv, {
    index: tabs.findIndex((x) => x.id === t.id),
    count: tabs.length,
    preview: t.preview,
    path: tabPath(t),
    // Like Ctrl+W, so the same neighbour becomes active.
    close: () => closeTab(t.id),
    closeOthers: () => close("others"),
    closeRight: () => close("right"),
    closeAll: () => close("all"),
    keepOpen: () => pinTab(t.id),
    history: hist ? () => void useStore.getState().openFileHistory(hist.path, hist.rev) : undefined,
    revealInExplorer: reveal ? () => useStore.getState().revealInExplorer(reveal) : undefined,
  });
}

export function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const activeId = useStore((s) => s.activeTab);
  const tick = useStore((s) => s.tick);
  const diffOpts = useStore((s) => s.settings.diff);
  const editorSettings = useStore((s) => s.settings.editor);
  const settingsSaved = useStore((s) => s.settingsSaved);
  const mdPreview = useStore((s) => s.settings.mdPreview);
  const imageDiff = useStore((s) => s.settings.imageDiff);
  const runScripts = useStore((s) => !!s.repo && scriptsAllowed(s.settings, s.repo.id));
  const dark = useStore(effectiveDark);
  const updateSettings = useStore((s) => s.updateSettings);
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const pinTab = useStore((s) => s.pinTab);
  const blameOn = useStore((s) => s.blame);
  const toggleBlame = useStore((s) => s.toggleBlame);
  const page = useStore((s) => (s.settingsOpen ? "settings" : s.view === "overview" ? "overview" : null));

  const diffHost = useRef<HTMLDivElement>(null);
  const codeHost = useRef<HTMLDivElement>(null);
  const diffEditor = useRef<DiffEditor | null>(null);
  const codeEditor = useRef<Editor | null>(null);
  const docs = useRef(new Map<string, Doc>());
  /** Where parked tabs were scrolled to: their models are gone until their worktree is shown again. */
  const parkedViews = useRef(new Map<string, ViewState>());
  const shown = useRef<string | null>(null);
  /** The blame the file editor's margin shows, and the line count it was laid out for. */
  const blameShown = useRef<{ blame: Blame; lines: number } | null>(null);
  const [, rerender] = useState(0);

  const active = tabs.find((t) => t.id === activeId) ?? null;
  const activeKey = active ? docKey(active) : null;
  const activeDoc = activeKey ? docs.current.get(activeKey) : undefined;

  // Create the two editors once; later setting changes go through updateOptions.
  useEffect(() => {
    const { editor: ed, diff: d } = useStore.getState().settings;
    const common: monaco.editor.IEditorOptions = {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      unicodeHighlight: { ambiguousCharacters: false },
      ...editorOptions(ed),
    };
    const code = monaco.editor.create(codeHost.current!, { ...common, minimap: { enabled: ed.minimap, renderCharacters: false }, model: null });
    const diff = monaco.editor.createDiffEditor(diffHost.current!, {
      ...common,
      originalEditable: false,
      renderSideBySide: d.sideBySide,
      useInlineViewWhenSpaceIsLimited: d.inlineWhenNarrow,
      renderOverviewRuler: true,
      diffAlgorithm: "advanced",
      minimap: { enabled: false },
    });
    // F7 / Shift+F7 jump between changes, like VS Code.
    for (const ed of [diff.getOriginalEditor(), diff.getModifiedEditor()]) {
      ed.addCommand(monaco.KeyCode.F7, () => diff.goToDiff("next"));
      ed.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => diff.goToDiff("previous"));
    }
    // With blame on, a click in a line's margin opens the commit that last changed it.
    code.onMouseDown((e) => {
      const b = blameShown.current;
      if (!b || e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS || !e.target.position) return;
      const sha = commitAtLine(b.blame, e.target.position.lineNumber);
      if (sha) void useStore.getState().showCommit(sha);
    });
    code.onMouseMove((e) => {
      const b = blameShown.current;
      const line = e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS ? e.target.position?.lineNumber : undefined;
      const sha = b && line ? commitAtLine(b.blame, line) : null;
      const c = sha ? b!.blame.commits[sha] : undefined;
      codeHost.current!.title = c && sha ? `${shortSha(sha)} · ${c.authorName} · ${new Date(c.authorTime * 1000).toLocaleString()}\n${c.summary}\n\nClick to open the commit in History` : "";
    });
    codeEditor.current = code;
    diffEditor.current = diff;
    return () => {
      code.dispose();
      diff.dispose();
      for (const d of docs.current.values()) {
        d.original?.dispose();
        d.modified?.dispose();
      }
      docs.current.clear();
    };
  }, []);

  useEffect(() => {
    monaco.editor.setTheme(dark ? "vs-dark" : "vs");
  }, [dark]);

  useEffect(() => {
    diffEditor.current?.updateOptions({
      renderSideBySide: diffOpts.sideBySide,
      hideUnchangedRegions: { enabled: diffOpts.collapseUnchanged, contextLineCount: 3, minimumLineCount: 3, revealLineCount: 20 },
      ignoreTrimWhitespace: diffOpts.ignoreWhitespace,
      useInlineViewWhenSpaceIsLimited: diffOpts.inlineWhenNarrow,
    });
  }, [diffOpts]);

  // Editor settings apply live to both editors and every open model.
  useEffect(() => {
    const opts = editorOptions(editorSettings);
    codeEditor.current?.updateOptions({ ...opts, minimap: { enabled: editorSettings.minimap, renderCharacters: false }, ...lineNumberOptions() });
    diffEditor.current?.updateOptions(opts);
    for (const d of docs.current.values()) {
      d.original?.updateOptions({ tabSize: editorSettings.tabSize });
      d.modified?.updateOptions({ tabSize: editorSettings.tabSize });
    }
  }, [editorSettings]);

  // Dispose models of closed tabs, and of tabs parked with their worktree: an open worktree with
  // many tabs costs memory only while shown. Parked tabs load again, where they were, on return.
  useEffect(() => {
    const open = new Set(tabs.map(docKey));
    const parked = new Set(Object.values(useStore.getState().parked).flatMap((v) => v.tabs.map(docKey)));
    for (const [key, d] of docs.current) {
      if (open.has(key)) continue;
      if (shown.current === key) {
        d.viewState = (d.original ? diffEditor.current : codeEditor.current)?.saveViewState() ?? d.viewState;
        diffEditor.current?.setModel(null);
        codeEditor.current?.setModel(null);
        shown.current = null;
      }
      if (parked.has(key) && d.viewState) parkedViews.current.set(key, d.viewState);
      d.original?.dispose();
      d.modified?.dispose();
      docs.current.delete(key);
    }
    for (const key of parkedViews.current.keys()) if (!parked.has(key) && !open.has(key)) parkedViews.current.delete(key);
  }, [tabs]);

  /** Line numbers of the file editor: the blame margin while one is shown, else as set. */
  const lineNumberOptions = (): monaco.editor.IEditorOptions => {
    const b = blameShown.current;
    if (!b) return { lineNumbers: useStore.getState().settings.editor.lineNumbers, lineNumbersMinChars: 5 };
    const m = blameMargin(b.blame, b.lines);
    return { lineNumbers: m.text, lineNumbersMinChars: m.width };
  };

  const loadBlame = async (tab: Tab, doc: Doc) => {
    if (tab.spec.type !== "file") return;
    const tick = doc.loadedTick;
    // The previous blame stays shown until the new one arrives.
    doc.blame = { ...doc.blame, tick, loading: true };
    try {
      doc.blame = { tick, loading: false, data: await api.blame({ repo: tab.repo, cwd: tab.cwd }, tab.spec.source) };
    } catch (e) {
      doc.blame = { tick, loading: false, error: errorText(e) };
    }
    if (docs.current.get(docKey(tab)) === doc) rerender((n) => n + 1);
  };

  const load = async (tab: Tab, existing?: Doc) => {
    const at = { repo: tab.repo, cwd: tab.cwd };
    const spec = tab.spec;
    const key = docKey(tab);
    const viewState = parkedViews.current.get(key);
    const doc: Doc = existing ?? { state: "loading", loadedTick: tick, viewState, revealed: !!viewState };
    if (!existing) {
      docs.current.set(key, doc);
      parkedViews.current.delete(key);
    }
    const setText = (model: monaco.editor.ITextModel | undefined, text: string, language: string) => {
      if (!model) {
        model = monaco.editor.createModel(text, language);
        model.updateOptions({ tabSize: useStore.getState().settings.editor.tabSize });
        return model;
      }
      if (model.getValue() !== text) model.setValue(text);
      return model;
    };
    if (spec.type === "settingsJson") {
      try {
        const file = await api.settingsFile();
        if (!docs.current.has(key)) return;
        doc.loadedTick = useStore.getState().settingsSaved;
        if (file.text === null) {
          doc.state = "message";
          doc.message = "settings.json has not been written yet; it is created when a setting changes.";
        } else {
          doc.modified = setText(doc.modified, file.text, "json");
          doc.state = "ready";
        }
      } catch (e) {
        doc.state = "message";
        doc.message = errorText(e);
      }
      return rerender((n) => n + 1);
    }
    const sources = spec.type === "diff" ? [spec.left, spec.right] : [spec.source];
    if (showsImage(tab, useStore.getState().settings.mdPreview)) {
      // Only sizes and URLs here; the pictures load when the view shows them.
      try {
        const images = await api.imageSources(at, sources);
        if (!docs.current.has(key)) return;
        doc.loadedTick = useStore.getState().tick;
        doc.mode = "image";
        // The URLs change only when a file did (they carry its version), and with them the view.
        doc.images = images;
        doc.state = spec.type === "file" && images[0].kind === "missing" ? "message" : "ready";
        doc.message = doc.state === "message" ? "This file does not exist." : undefined;
      } catch (e) {
        doc.state = "message";
        doc.message = errorText(e);
      }
      return rerender((n) => n + 1);
    }
    doc.mode = "text";
    doc.images = undefined;
    try {
      const contents = await api.readSources(at, sources);
      if (!docs.current.has(key)) return;
      doc.loadedTick = useStore.getState().tick;
      const message = contents.map(describe).find(Boolean);
      if (spec.type === "file" && contents[0].kind === "missing") {
        doc.state = "message";
        doc.message = "This file does not exist.";
      } else if (message) {
        doc.state = "message";
        doc.message = message;
      } else {
        const lang = languageFor(spec.path);
        if (spec.type === "diff") {
          doc.original = setText(doc.original, textOf(contents[0]), spec.origPath ? languageFor(spec.origPath) : lang);
          doc.modified = setText(doc.modified, textOf(contents[1]), lang);
        } else {
          doc.modified = setText(doc.modified, textOf(contents[0]), lang);
        }
        doc.state = "ready";
      }
    } catch (e) {
      doc.state = "message";
      doc.message = errorText(e);
    }
    rerender((n) => n + 1);
  };

  // Load the active tab, and reload it when the worktree changed and it shows files from disk
  // (or, for settings.json, when the settings were saved again).
  useEffect(() => {
    if (!active || !activeKey) return;
    const doc = docs.current.get(activeKey);
    const json = active.spec.type === "settingsJson";
    const now = json ? settingsSaved : tick;
    // SVG switches between picture and text with the Preview/Source toggle.
    const modeChanged = !!doc?.mode && doc.mode !== (showsImage(active, mdPreview) ? "image" : "text");
    if (!doc) void load(active);
    else if (((doc.loadedTick < now && (json || isLive(active))) || modeChanged) && doc.state !== "loading") {
      doc.loadedTick = now;
      void load(active, doc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, active?.spec, tick, settingsSaved, mdPreview]);

  // Attach the active tab's models to the right editor.
  useEffect(() => {
    const prev = shown.current ? docs.current.get(shown.current) : undefined;
    const prevTab = shown.current;
    if (prev && prevTab !== activeKey) {
      prev.viewState = prev.original ? diffEditor.current?.saveViewState() : codeEditor.current?.saveViewState();
    }
    if (!active || !activeDoc || activeDoc.state !== "ready" || activeDoc.mode === "image") return;
    const isDiff = active.spec.type === "diff";
    if (shown.current !== activeKey || (isDiff ? diffEditor.current?.getModel()?.modified !== activeDoc.modified : codeEditor.current?.getModel() !== activeDoc.modified)) {
      if (isDiff) {
        codeEditor.current?.setModel(null);
        diffEditor.current?.setModel({ original: activeDoc.original!, modified: activeDoc.modified! });
        if (activeDoc.viewState) diffEditor.current?.restoreViewState(activeDoc.viewState as monaco.editor.IDiffEditorViewState);
      } else {
        diffEditor.current?.setModel(null);
        codeEditor.current?.setModel(activeDoc.modified!);
        if (activeDoc.viewState) codeEditor.current?.restoreViewState(activeDoc.viewState as monaco.editor.ICodeEditorViewState);
      }
      shown.current = activeKey;
    }
    if (active.spec.type === "file" && active.spec.line && !activeDoc.revealed) {
      const line = active.spec.line;
      codeEditor.current?.revealLineInCenter(line);
      codeEditor.current?.setSelection(new monaco.Range(line, 1, line, activeDoc.modified!.getLineMaxColumn(line)));
      activeDoc.revealed = true;
    }
  });

  // Search results can re-target an open file at a new line.
  useEffect(() => {
    if (activeDoc) activeDoc.revealed = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.spec.type === "file" ? active.spec.line : undefined]);

  const isDiff = active?.spec.type === "diff";
  const ready = activeDoc?.state === "ready" && !page;
  const isMarkdown = active?.spec.type === "file" && languageFor(active.spec.path) === "markdown";
  const showPreview = isMarkdown && mdPreview && ready;
  const kind = active && (active.spec.type === "file" || active.spec.type === "diff") ? viewKind(active.spec.path) : "text";
  const isHtml = active?.spec.type === "file" && kind === "html";
  const showHtml = isHtml && mdPreview && ready;
  const showImage = ready && activeDoc?.mode === "image";
  const isSvg = kind === "image" && /\.svg$/i.test(active!.spec.path);
  /** Shown rendered rather than in the editor. */
  const rendered = showPreview || showHtml || showImage;
  const previewToggle = (
    <div className="segmented small">
      <button className={mdPreview ? "on" : ""} onClick={() => updateSettings({ mdPreview: true })}>
        Preview
      </button>
      <button className={!mdPreview ? "on" : ""} onClick={() => updateSettings({ mdPreview: false })}>
        Source
      </button>
    </div>
  );

  // Blame: loaded for the active file view when on (again after the file reloads), shown in the line-number margin.
  useEffect(() => {
    const doc = blameOn && active?.spec.type === "file" && activeDoc?.state === "ready" && !rendered ? activeDoc : null;
    if (doc && active && !doc.blame?.loading && (!doc.blame || doc.blame.tick < doc.loadedTick)) void loadBlame(active, doc);
    const data = doc?.blame?.data ?? null;
    const lines = doc?.modified?.getLineCount() ?? 0;
    const cur = blameShown.current;
    if (data ? cur?.blame !== data || cur.lines !== lines : cur) {
      blameShown.current = data ? { blame: data, lines } : null;
      codeEditor.current?.updateOptions(lineNumberOptions());
    }
  });

  // Settings and the overview have no editor; the hidden code editor must not take focus.
  editorCommands.focus = () => !page && (isDiff ? diffEditor.current?.getModifiedEditor() : codeEditor.current)?.focus();
  editorCommands.run = (id) => {
    if (page) return;
    const ed = isDiff ? diffEditor.current?.getModifiedEditor() : codeEditor.current;
    ed?.focus();
    ed?.getAction(id)?.run();
  };
  editorCommands.goToDiff = (dir) => {
    if (isDiff) diffEditor.current?.goToDiff(dir);
  };

  const spec = active?.spec;
  return (
    <section className="editor-area">
      <div className="tab-strip" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId && !page}
            className={`tab${t.id === activeId && !page ? " active" : ""}${t.preview ? " preview" : ""}`}
            title={`${t.spec.path}\n${t.description}`}
            tabIndex={t.id === activeId ? 0 : -1}
            onContextMenu={(e) => menuAtPointer(e, tabMenu(t))}
            onKeyDown={(e) => {
              if (!isMenuKey(e)) return;
              e.preventDefault();
              menuAtElement(e.currentTarget, tabMenu(t));
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(t.id);
              }
            }}
            onClick={() => activateTab(t.id)}
            onDoubleClick={() => pinTab(t.id)}
          >
            <FileTypeIcon name={t.title} />
            {t.spec.type === "diff" && <span className="tab-kind">±</span>}
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              title="Close (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {spec && !page && (
        <div className="editor-toolbar">
          <span className="crumb" title={spec.path}>
            {spec.type === "diff" && spec.origPath && spec.origPath !== spec.path ? `${spec.origPath} → ` : ""}
            {spec.path}
          </span>
          {spec.type === "file" && (isMarkdown || isHtml || isSvg) && (
            <>
              <span className="spacer" />
              {showHtml && active && (
                <button
                  className={`toggle${runScripts ? " on" : ""}`}
                  title={"Run this page's own scripts, inline or from the repository, in every HTML preview of this repository.\nThe page still cannot reach the network or the app; web links ask first."}
                  aria-pressed={runScripts}
                  onClick={() => updateSettings(withRunScripts(useStore.getState().settings, active.repo, !runScripts))}
                >
                  Run scripts
                </button>
              )}
              {previewToggle}
            </>
          )}
          {spec.type === "file" && !rendered && !(kind === "image" && (mdPreview || !isSvg)) && (
            <>
              {!(isMarkdown || isHtml || isSvg) && <span className="spacer" />}
              {blameOn && activeDoc?.blame?.loading && <span className="muted">Loading blame…</span>}
              {blameOn && activeDoc?.blame?.error && (
                <span className="error-text ellipsis" title={activeDoc.blame.error}>
                  No blame: {activeDoc.blame.error}
                </span>
              )}
              <button
                className={`toggle${blameOn ? " on" : ""}`}
                title="Show who last changed each line; click a line's margin to open its commit in History"
                aria-pressed={blameOn}
                onClick={toggleBlame}
              >
                Blame
              </button>
            </>
          )}
          {spec.type === "diff" && showImage && (
            <>
              <span className="muted sides">
                {spec.leftLabel} ↔ {spec.rightLabel}
              </span>
              <span className="spacer" />
              {isSvg && previewToggle}
              <div className="segmented small">
                {(
                  [
                    ["sideBySide", "Side by side"],
                    ["swipe", "Swipe"],
                    ["onion", "Onion skin"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={imageDiff === m ? "on" : ""} onClick={() => updateSettings({ imageDiff: m })}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {spec.type === "diff" && !showImage && (
            <>
              <span className="muted sides">
                {spec.leftLabel} ↔ {spec.rightLabel}
              </span>
              <span className="spacer" />
              {isSvg && previewToggle}
              <button className="icon-button" title="Previous change (Shift+F7)" onClick={() => editorCommands.goToDiff("previous")}>
                ↑
              </button>
              <button className="icon-button" title="Next change (F7)" onClick={() => editorCommands.goToDiff("next")}>
                ↓
              </button>
              <div className="segmented small">
                <button className={diffOpts.sideBySide ? "on" : ""} onClick={() => updateSettings({ diff: { ...diffOpts, sideBySide: true } })}>
                  Side by side
                </button>
                <button className={!diffOpts.sideBySide ? "on" : ""} onClick={() => updateSettings({ diff: { ...diffOpts, sideBySide: false } })}>
                  Inline
                </button>
              </div>
              <button className={`toggle${diffOpts.collapseUnchanged ? " on" : ""}`} title="Collapse unchanged regions" onClick={() => updateSettings({ diff: { ...diffOpts, collapseUnchanged: !diffOpts.collapseUnchanged } })}>
                Collapse unchanged
              </button>
              <button className={`toggle${diffOpts.ignoreWhitespace ? " on" : ""}`} title="Ignore leading/trailing whitespace" onClick={() => updateSettings({ diff: { ...diffOpts, ignoreWhitespace: !diffOpts.ignoreWhitespace } })}>
                Ignore whitespace
              </button>
            </>
          )}
        </div>
      )}
      <div className="editor-stack">
        <div ref={diffHost} className="editor-host" style={{ visibility: isDiff && ready && !showImage ? "visible" : "hidden" }} />
        <div ref={codeHost} className={`editor-host${blameOn && spec?.type === "file" ? " blame-on" : ""}`} style={{ visibility: !isDiff && !page && ready && !rendered ? "visible" : "hidden" }} />
        {page === "settings" && <SettingsPage />}
        {page === "overview" && <WorktreesPage />}
        {showPreview && active && activeDoc?.modified && <MarkdownPreview tab={active} text={activeDoc.modified.getValue()} />}
        {showHtml && active && activeDoc?.modified && <HtmlPreview tab={active} text={activeDoc.modified.getValue()} />}
        {showImage && spec && activeDoc?.images && (
          <ImageView
            key={`${active!.id}|${activeDoc.images.map((i) => (i.kind === "image" ? i.url : i.kind)).join("|")}`}
            sides={spec.type === "diff" ? [{ label: spec.leftLabel, source: activeDoc.images[0] }, { label: spec.rightLabel, source: activeDoc.images[1] }] : [{ label: active!.title, source: activeDoc.images[0] }]}
            mode={imageDiff}
          />
        )}
        {!active && !page && (
          <div className="editor-empty">
            <p>Select a changed file, a commit file or a file in Explorer.</p>
            <p className="muted">Ctrl+P open file · Ctrl+Shift+F search · Ctrl+1/2/3 switch panes · F5 refresh · Ctrl+, settings</p>
          </div>
        )}
        {active && !page && activeDoc?.state === "message" && <div className="editor-empty">{activeDoc.message}</div>}
        {active && !page && (!activeDoc || activeDoc.state === "loading") && <div className="editor-empty muted">Loading…</div>}
      </div>
    </section>
  );
}
