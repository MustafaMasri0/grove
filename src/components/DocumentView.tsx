// The view for file, diff and settings tabs: Monaco's two editors, the rendered previews, and their toolbar.
import { useEffect, useRef, useState } from "react";
import { api, errorText, type Blame, type Content, type ImageSource } from "../api";
import { blameMargin, commitAtLine } from "../lib/blame";
import { editorOptions } from "../lib/editorOptions";
import { viewKind } from "../lib/fileKinds";
import { scriptsAllowed, withRunScripts } from "../lib/settings";
import { formatBytes, shortSha } from "../lib/format";
import { languageFor, monaco } from "../monaco";
import { useStore } from "../store";
import { isLive, isWorktreeTab, type DocumentTab, type FileTab, type Tab } from "../tabs";
import { Button, Empty, menuAtElement, PathLabel, Toggle, Toolbar, Tray } from "../ui";
import { Icon } from "./Icon";
import { HtmlPreview } from "./HtmlPreview";
import { ImageView } from "./ImageView";
import { MarkdownPreview } from "./MarkdownPreview";

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
function showsImage(t: DocumentTab, preview: boolean): boolean {
  if (!isWorktreeTab(t)) return false;
  return viewKind(t.path) === "image" && (preview || !/\.svg$/i.test(t.path));
}

/** Tabs of different worktrees may share an id, and `HEAD` differs between them. */
const docKey = (t: Tab) => `${isWorktreeTab(t) ? t.cwd : ""}\n${t.id}`;

/** Below this width the diff toolbar moves its two toggles into a More menu. */
const COMPACT_TOOLBAR = 600;

/** A whole-view message in the editor's place. */
export function Message(p: { text?: string; hint?: string }) {
  return (
    <div className="ui-root ed-msg" role="status">
      <Empty {...p} />
    </div>
  );
}

/**
 * Shows `tab`, or nothing while no document tab is active. It stays mounted either way: the editors are made
 * once, and the models of open tabs are kept so switching back is instant.
 */
export function DocumentView({ tab: active }: { tab: DocumentTab | null }) {
  const tabs = useStore((s) => s.tabs);
  const tick = useStore((s) => s.tick);
  const diffOpts = useStore((s) => s.settings.diff);
  const editorSettings = useStore((s) => s.settings.editor);
  const settingsSaved = useStore((s) => s.settingsSaved);
  const mdPreview = useStore((s) => s.settings.mdPreview);
  const imageDiff = useStore((s) => s.settings.imageDiff);
  const runScripts = useStore((s) => !!s.repo && scriptsAllowed(s.settings, s.repo.id));
  const updateSettings = useStore((s) => s.updateSettings);
  const blameOn = useStore((s) => s.blame);
  const toggleBlame = useStore((s) => s.toggleBlame);
  const covered = useStore((s) => s.view === "overview");

  const stack = useRef<HTMLDivElement>(null);
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
  const [compact, setCompact] = useState(false);

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
      renderLineHighlightOnlyWhenFocus: true,
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

  // The diff toolbar follows the editor's own width, not only the window's band.
  useEffect(() => {
    const el = stack.current!;
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT_TOOLBAR));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dispose models of closed tabs, and of tabs parked with their worktree: an open worktree with
  // many tabs costs memory only while shown. Parked tabs load again, where they were, on return.
  useEffect(() => {
    const open = new Set(tabs.map(docKey));
    const parked = new Set(Object.values(useStore.getState().parked).flatMap((v) => v.tabs.map((p) => docKey(p.tab))));
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

  const loadBlame = async (tab: FileTab, doc: Doc) => {
    const tick = doc.loadedTick;
    // The previous blame stays shown until the new one arrives.
    doc.blame = { ...doc.blame, tick, loading: true };
    try {
      doc.blame = { tick, loading: false, data: await api.blame({ repo: tab.repo, cwd: tab.cwd }, tab.source) };
    } catch (e) {
      doc.blame = { tick, loading: false, error: errorText(e) };
    }
    if (docs.current.get(docKey(tab)) === doc) rerender((n) => n + 1);
  };

  const load = async (tab: DocumentTab, existing?: Doc) => {
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
    if (tab.kind === "settings") {
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
    const at = { repo: tab.repo, cwd: tab.cwd };
    const sources = tab.kind === "diff" ? [tab.left, tab.right] : [tab.source];
    if (showsImage(tab, useStore.getState().settings.mdPreview)) {
      // Only sizes and URLs here; the pictures load when the view shows them.
      try {
        const images = await api.imageSources(at, sources);
        if (!docs.current.has(key)) return;
        doc.loadedTick = useStore.getState().tick;
        doc.mode = "image";
        // The URLs change only when a file did (they carry its version), and with them the view.
        doc.images = images;
        doc.state = tab.kind === "file" && images[0].kind === "missing" ? "message" : "ready";
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
      if (tab.kind === "file" && contents[0].kind === "missing") {
        doc.state = "message";
        doc.message = "This file does not exist.";
      } else if (message) {
        doc.state = "message";
        doc.message = message;
      } else {
        const lang = languageFor(tab.path);
        if (tab.kind === "diff") {
          doc.original = setText(doc.original, textOf(contents[0]), tab.origPath ? languageFor(tab.origPath) : lang);
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
    const json = active.kind === "settings";
    const now = json ? settingsSaved : tick;
    // SVG switches between picture and text with the Preview/Source toggle.
    const modeChanged = !!doc?.mode && doc.mode !== (showsImage(active, mdPreview) ? "image" : "text");
    if (!doc) void load(active);
    else if (((doc.loadedTick < now && (json || isLive(active))) || modeChanged) && doc.state !== "loading") {
      doc.loadedTick = now;
      void load(active, doc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, active, tick, settingsSaved, mdPreview]);

  // Attach the active tab's models to the right editor.
  useEffect(() => {
    const prev = shown.current ? docs.current.get(shown.current) : undefined;
    const prevTab = shown.current;
    if (prev && prevTab !== activeKey) {
      prev.viewState = prev.original ? diffEditor.current?.saveViewState() : codeEditor.current?.saveViewState();
    }
    if (!active || !activeDoc || activeDoc.state !== "ready" || activeDoc.mode === "image") return;
    const isDiff = active.kind === "diff";
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
    if (active.kind === "file" && active.line && !activeDoc.revealed) {
      const line = active.line;
      codeEditor.current?.revealLineInCenter(line);
      codeEditor.current?.setSelection(new monaco.Range(line, 1, line, activeDoc.modified!.getLineMaxColumn(line)));
      activeDoc.revealed = true;
    }
  });

  // Search results can re-target an open file at a new line.
  useEffect(() => {
    if (activeDoc) activeDoc.revealed = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind === "file" ? active.line : undefined]);

  const isDiff = active?.kind === "diff";
  const ready = activeDoc?.state === "ready" && !covered;
  const isMarkdown = active?.kind === "file" && languageFor(active.path) === "markdown";
  const showPreview = isMarkdown && mdPreview && ready;
  const kind = active && isWorktreeTab(active) ? viewKind(active.path) : "text";
  const isHtml = active?.kind === "file" && kind === "html";
  const showHtml = isHtml && mdPreview && ready;
  const showImage = ready && activeDoc?.mode === "image";
  const isSvg = kind === "image" && /\.svg$/i.test(active!.path);
  /** Shown rendered rather than in the editor. */
  const rendered = showPreview || showHtml || showImage;
  const previewToggle = (
    <Tray
      small
      label="Preview or source"
      value={mdPreview ? "preview" : "source"}
      items={[
        ["preview", "Preview"],
        ["source", "Source"],
      ]}
      onChange={(v) => updateSettings({ mdPreview: v === "preview" })}
    />
  );
  const setDiff = (patch: Partial<typeof diffOpts>) => updateSettings({ diff: { ...diffOpts, ...patch } });

  // Blame: loaded for the active file view when on (again after the file reloads), shown in the line-number margin.
  useEffect(() => {
    const doc = blameOn && active?.kind === "file" && activeDoc?.state === "ready" && !rendered ? activeDoc : null;
    if (doc && active?.kind === "file" && !doc.blame?.loading && (!doc.blame || doc.blame.tick < doc.loadedTick)) void loadBlame(active, doc);
    const data = doc?.blame?.data ?? null;
    const lines = doc?.modified?.getLineCount() ?? 0;
    const cur = blameShown.current;
    if (data ? cur?.blame !== data || cur.lines !== lines : cur) {
      blameShown.current = data ? { blame: data, lines } : null;
      codeEditor.current?.updateOptions(lineNumberOptions());
    }
  });

  // The overview has no editor, and neither has a tab of another kind; the hidden code editor must not take focus.
  const usable = !covered && !!active;
  editorCommands.focus = () => usable && (isDiff ? diffEditor.current?.getModifiedEditor() : codeEditor.current)?.focus();
  editorCommands.run = (id) => {
    if (!usable) return;
    const ed = isDiff ? diffEditor.current?.getModifiedEditor() : codeEditor.current;
    ed?.focus();
    ed?.getAction(id)?.run();
  };
  editorCommands.goToDiff = (dir) => {
    if (isDiff) diffEditor.current?.goToDiff(dir);
  };

  return (
    <>
      {active && (
        <div className="ui-root ed-chrome">
          <Toolbar>
            <span className="crumb" title={active.path}>
              {active.kind === "diff" && active.origPath && active.origPath !== active.path && (
                <>
                  <span className="muted ell">{active.origPath}</span>
                  <span className="muted arrow">→</span>
                </>
              )}
              {active.kind === "settings" ? <span className="ell">{active.path}</span> : <PathLabel path={active.path} />}
            </span>
            {active.kind === "diff" && (
              <span className="muted ell opt-long">
                {active.leftLabel} ↔ {active.rightLabel}
              </span>
            )}
            <span className="spacer" />
            {active.kind === "file" && (isMarkdown || isHtml || isSvg) && (
              <>
                {showHtml && (
                  <Toggle
                    text="Run scripts"
                    tip={"Run this page's own scripts, inline or from the repository, in every HTML preview of this repository.\nThe page still cannot reach the network or the app; web links ask first."}
                    on={runScripts}
                    onClick={() => updateSettings(withRunScripts(useStore.getState().settings, active.repo, !runScripts))}
                  />
                )}
                {previewToggle}
              </>
            )}
            {active.kind === "file" && !rendered && !(kind === "image" && (mdPreview || !isSvg)) && (
              <>
                {blameOn && activeDoc?.blame?.loading && <span className="muted">Loading blame…</span>}
                {blameOn && activeDoc?.blame?.error && (
                  <span className="err-text ell" title={activeDoc.blame.error}>
                    No blame: {activeDoc.blame.error}
                  </span>
                )}
                <Toggle text="Blame" tip="Show who last changed each line; click a line's margin to open its commit in History" on={blameOn} onClick={toggleBlame} />
              </>
            )}
            {active.kind === "diff" && isSvg && previewToggle}
            {active.kind === "diff" && showImage && (
              <Tray
                small
                label="Compare images"
                value={imageDiff}
                items={[
                  ["sideBySide", "Side by side"],
                  ["swipe", "Swipe"],
                  ["onion", "Onion skin"],
                ]}
                onChange={(m) => updateSettings({ imageDiff: m })}
              />
            )}
            {active.kind === "diff" && !showImage && (
              <>
                <Button kind="ghost" size="sm" icon="arrow-up" label="Previous change" tip="Previous change (Shift+F7)" onClick={() => editorCommands.goToDiff("previous")} />
                <Button kind="ghost" size="sm" icon="arrow-down" label="Next change" tip="Next change (F7)" onClick={() => editorCommands.goToDiff("next")} />
                <Tray
                  small
                  label="Diff layout"
                  value={diffOpts.sideBySide ? "side" : "inline"}
                  items={[
                    ["side", "Side by side"],
                    ["inline", "Inline"],
                  ]}
                  onChange={(v) => setDiff({ sideBySide: v === "side" })}
                />
                {compact ? (
                  <Button
                    kind="ghost"
                    size="sm"
                    text="More"
                    after={<Icon name="chevron-down" size={10} />}
                    tip="Collapse unchanged, Ignore whitespace"
                    aria-haspopup="menu"
                    onClick={(e) =>
                      menuAtElement(e.currentTarget, [
                        { label: "Collapse unchanged", check: diffOpts.collapseUnchanged, run: () => setDiff({ collapseUnchanged: !diffOpts.collapseUnchanged }) },
                        { label: "Ignore whitespace", check: diffOpts.ignoreWhitespace, run: () => setDiff({ ignoreWhitespace: !diffOpts.ignoreWhitespace }) },
                      ])
                    }
                  />
                ) : (
                  <>
                    <Toggle text="Collapse unchanged" tip="Collapse unchanged regions" on={diffOpts.collapseUnchanged} onClick={() => setDiff({ collapseUnchanged: !diffOpts.collapseUnchanged })} />
                    <Toggle text="Ignore whitespace" tip="Ignore leading/trailing whitespace" on={diffOpts.ignoreWhitespace} onClick={() => setDiff({ ignoreWhitespace: !diffOpts.ignoreWhitespace })} />
                  </>
                )}
              </>
            )}
          </Toolbar>
        </div>
      )}
      {/* Hidden, not unmounted, while no document tab is active: the editors live as long as the window. */}
      <div ref={stack} className="editor-stack" hidden={!active}>
        <div ref={diffHost} className="editor-host" style={{ visibility: isDiff && ready && !showImage ? "inherit" : "hidden" }} />
        <div ref={codeHost} className={`editor-host${blameOn && active?.kind === "file" ? " blame-on" : ""}`} style={{ visibility: !isDiff && ready && !rendered ? "inherit" : "hidden" }} />
        {showPreview && active?.kind === "file" && activeDoc?.modified && <MarkdownPreview tab={active} text={activeDoc.modified.getValue()} />}
        {showHtml && active?.kind === "file" && activeDoc?.modified && <HtmlPreview tab={active} text={activeDoc.modified.getValue()} />}
        {showImage && active && isWorktreeTab(active) && activeDoc?.images && (
          <ImageView
            key={`${active.id}|${activeDoc.images.map((i) => (i.kind === "image" ? i.url : i.kind)).join("|")}`}
            sides={active.kind === "diff" ? [{ label: active.leftLabel, source: activeDoc.images[0] }, { label: active.rightLabel, source: activeDoc.images[1] }] : [{ label: active.title, source: activeDoc.images[0] }]}
            mode={imageDiff}
          />
        )}
        {active && activeDoc?.state === "message" && <Message text={activeDoc.message} />}
        {active && (!activeDoc || activeDoc.state === "loading") && <Message text="Loading…" />}
      </div>
    </>
  );
}
