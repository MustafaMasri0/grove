import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useLayoutEffect, useRef } from "react";
import { CommitPane } from "./components/CommitPane";
import { EditorArea } from "./components/EditorArea";
import { editorCommands } from "./components/DocumentView";
import { previewForTest } from "./components/HtmlPreview";
import { foldRail } from "./components/foldRail";
import { imageCommands } from "./components/ImageView";
import { IssuesPane } from "./components/IssuesPane";
import { LeftPane } from "./components/LeftPane";
import { Palette } from "./components/Palette";
import { dragWidth, nudgeWidth } from "./components/paneWidth";
import { Rail } from "./components/Rail";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";
import { WorkHeader } from "./components/WorkHeader";
import { WorktreesPage } from "./components/WorktreesPage";
import { api, type WorktreeChanged } from "./api";
import { useIssues } from "./issuesStore";
import { ZOOM_STEPS } from "./lib/settingsSchema";
import { applyEditorTheme } from "./monaco";
import { commitFileTab, fileTab, revisionTab } from "./tabs";
import { normalizeSettings } from "./lib/settings";
import { bandOf, commitInList, isNarrow } from "./lib/shell";
import { effectiveDark, setActionProgress, useStore, type LeftTab } from "./store";
import { Banner, closeOverlay, isKeyboardEcho, keepOverlaysOnBlur, OverlayHost, Resizer, Spinner } from "./ui";
import { topEntry } from "./ui/overlayStack";
import "./shell.css";

function setZoom(z: number) {
  useStore.getState().updateSettings({ zoom: z });
}

function stepZoom(dir: 1 | -1) {
  const cur = useStore.getState().settings.zoom;
  const idx = ZOOM_STEPS.findIndex((z) => z >= cur - 0.001);
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (idx < 0 ? 5 : idx) + dir))];
  setZoom(next);
}

/** App-wide shortcuts, VS Code style. Runs in the capture phase, before Monaco. */
function onKeyDown(e: KeyboardEvent) {
  const s = useStore.getState();
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const inEditor = !!(document.activeElement as HTMLElement | null)?.closest?.(".monaco-editor");
  const atWork = s.view === "work";
  const tabs: Record<string, LeftTab> = { "1": "changes", "2": "history", "3": "explorer" };

  // An open overlay had the key first and passed on it: the page behind must not act. Browser shortcuts stay off.
  const top = topEntry();
  const zoomKey = ctrl && (key === "=" || key === "+" || key === "-" || key === "0");
  if (top) {
    // Settings owns these two: Ctrl+, opens and closes it, and Zoom is one of its rows, so the window still zooms behind it.
    const settingsOnTop = s.settingsOpen && top.kind === "dialog";
    if (settingsOnTop && ctrl && !e.shiftKey && key === ",") closeOverlay();
    else if (settingsOnTop && zoomKey) key === "0" ? setZoom(1) : stepZoom(key === "-" ? -1 : 1);
    else if (key !== "F3" && !(ctrl && (key === "s" || key === "u" || key === "p"))) return;
  } else if (ctrl && !e.shiftKey && key === "k") s.setPalette("all");
  else if (ctrl && !e.shiftKey && key === "p") s.setPalette("files");
  else if (ctrl && e.shiftKey && key === "o") s.setView("overview");
  else if (ctrl && !e.shiftKey && key === "i") s.showIssues(true);
  else if (ctrl && e.shiftKey && key === "f") s.focusSearch();
  else if (ctrl && !e.shiftKey && key === "f" && !inEditor) editorCommands.run("actions.find");
  else if (ctrl && !e.shiftKey && key === "g" && !inEditor) editorCommands.run("editor.action.gotoLine");
  else if (key === "F7" && !e.ctrlKey && !e.altKey && !inEditor) editorCommands.goToDiff(e.shiftKey ? "previous" : "next");
  else if (ctrl && !e.shiftKey && key === "w") {
    if (atWork && s.activeTab) s.closeTab(s.activeTab);
  } else if (ctrl && key === "Tab") {
    if (atWork) s.cycleTab(e.shiftKey ? -1 : 1);
  }
  else if (ctrl && !e.shiftKey && tabs[key]) s.setLeftTab(tabs[key]);
  else if (ctrl && !e.shiftKey && key === "b") isNarrow(s.appWidth) ? s.toggleList() : foldRail();
  else if (ctrl && !e.shiftKey && key === ",") s.openSettings();
  else if ((key === "F5" && !e.ctrlKey) || (ctrl && key === "r")) {
    void s.refresh();
    if (atWork && s.listPane === "issues") void useIssues.getState().refresh();
    const tab = atWork ? s.tabs.find((t) => t.id === s.activeTab) : undefined;
    if (tab?.kind === "issue") void useIssues.getState().loadIssue(tab.number, true);
  }
  // While an image is shown these zoom the image, not the window.
  else if (ctrl && (key === "=" || key === "+")) imageCommands.active ? imageCommands.zoom(1) : stepZoom(1);
  else if (ctrl && key === "-") imageCommands.active ? imageCommands.zoom(-1) : stepZoom(-1);
  else if (ctrl && key === "0") imageCommands.active ? imageCommands.zoom(0) : setZoom(1);
  // Browser shortcuts that make no sense here (print, reload, save page, find bar).
  else if (key === "F3" || (ctrl && (key === "s" || key === "u"))) {
    /* swallow */
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

export function App() {
  const settingsLoaded = useStore((s) => s.settingsLoaded);
  const palette = useStore((s) => s.palette);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const repo = useStore((s) => s.repo);
  const leftWidth = useStore((s) => s.settings.leftWidth);
  const commitWidth = useStore((s) => s.settings.commitPaneWidth);
  const appWidth = useStore((s) => s.appWidth);
  const narrow = isNarrow(appWidth);
  // With no repository the work view has only settings.json to show, so the editor takes the whole page.
  const editorOnly = narrow || !repo;
  const listOpen = useStore((s) => s.listOpen);
  const issues = useStore((s) => s.listPane === "issues");
  const commitColumn = useStore((s) => s.listPane === "worktree" && s.leftTab === "history" && s.selectedCommit !== null && !commitInList(s.appWidth));
  const overview = useStore((s) => s.view === "overview");
  const dark = useStore(effectiveDark);
  const zoom = useStore((s) => s.settings.zoom);
  const uiFontSize = useStore((s) => s.settings.uiFontSize);
  const lastFocusRefresh = useRef(0);
  const appEl = useRef<HTMLDivElement>(null);

  // The bands follow the app's own width, so the first paint already has the right one.
  useLayoutEffect(() => {
    const el = appEl.current!;
    const measure = () => useStore.getState().setAppWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(() => void runAutomation());

    window.addEventListener("keydown", onKeyDown, true);
    // The browser's menu is off outside editors (Monaco has its own); the app's menus come from the
    // rows themselves. A menu key that already opened one may be followed by a contextmenu event: drop it.
    const blockMenu = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".monaco-editor")) return;
      e.preventDefault();
      if (isKeyboardEcho()) e.stopPropagation();
    };
    window.addEventListener("contextmenu", blockMenu, true);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => useStore.getState().setSystemDark(mq.matches);
    onScheme();
    mq.addEventListener("change", onScheme);

    const onFocus = () => {
      useIssues.getState().setFocused(true);
      if (Date.now() - lastFocusRefresh.current < 2000) return;
      lastFocusRefresh.current = Date.now();
      void useStore.getState().refresh();
    };
    window.addEventListener("focus", onFocus);
    const onBlur = () => useIssues.getState().setFocused(false);
    window.addEventListener("blur", onBlur);

    const unlisten = [
      listen<WorktreeChanged>("worktree-changed", (e) => useStore.getState().noteChange(e.payload)),
      listen<{ cwd: string; line: string }>("action-progress", (e) => setActionProgress(e.payload.cwd, e.payload.line)),
      listen<string>("connection-lost", (e) => void useStore.getState().reconnect(e.payload)),
    ];
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", blockMenu, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      mq.removeEventListener("change", onScheme);
      unlisten.forEach((p) => void p.then((f) => f()));
    };
  }, []);

  // A layout effect: the editors are created in a passive one, and must never paint Monaco's own theme.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    applyEditorTheme(dark);
    // What the window shows behind the page: while it opens, and in the strip a fast resize uncovers.
    const shell = getComputedStyle(document.documentElement).getPropertyValue("--shell").trim();
    void getCurrentWebviewWindow().setBackgroundColor(shell).catch(() => {});
  }, [dark]);

  useEffect(() => {
    if (settingsLoaded) getCurrentWebview().setZoom(zoom).catch(() => {});
  }, [zoom, settingsLoaded]);

  useEffect(() => {
    document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  }, [uiFontSize]);

  const columns = editorOnly ? "minmax(0, 1fr)" : commitColumn ? `minmax(160px, ${leftWidth}px) 0 minmax(160px, ${commitWidth}px) 0 minmax(320px, 1fr)` : `minmax(160px, ${leftWidth}px) 0 minmax(320px, 1fr)`;
  return (
    <>
      <div ref={appEl} className="app" data-size={bandOf(appWidth)} data-overlay-inert="">
        <div className="shell-body">
          <Rail />
          <div className="fold-host" id="rail-fold" aria-hidden="true" />
          <main className="main" id="main">
            <Notices />
            <div className="page-stack">
              <div className="work" data-covered={overview ? "" : undefined} inert={overview}>
                <WorkHeader />
                <div className="work-body" style={{ gridTemplateColumns: columns }}>
                  {repo && (
                    <div className="list-clip" data-open={!narrow || listOpen} inert={narrow && !listOpen}>
                      {issues ? <IssuesPane /> : <LeftPane />}
                    </div>
                  )}
                  {!editorOnly && <PaneEdge width="leftWidth" label="Resize the list pane" />}
                  {commitColumn && (
                    <>
                      <div className="ui-root commit-col">
                        <CommitPane />
                      </div>
                      <PaneEdge width="commitPaneWidth" label="Resize the commit pane" />
                    </>
                  )}
                  <EditorArea />
                </div>
              </div>
              {overview && <WorktreesPage />}
            </div>
          </main>
        </div>
        <WindowControls />
        {palette && <Palette scope={palette} />}
        {settingsOpen && <SettingsDialog />}
      </div>
      <OverlayHost />
    </>
  );
}

const clampPane = (w: number) => Math.max(220, Math.min(window.innerWidth - 400, w));

/** The handle between two panes; it sits on the hairline and takes no room of its own. */
function PaneEdge({ width, label }: { width: "leftWidth" | "commitPaneWidth"; label: string }) {
  return (
    <div className="ui-root pane-edge">
      <Resizer label={label} onMouseDown={(e) => dragWidth(e, width, clampPane)} onKeyDown={(e) => nudgeWidth(e, width, clampPane)} />
    </div>
  );
}

function Notices() {
  const repoError = useStore((s) => s.repoError);
  const notice = useStore((s) => s.notice);
  const lost = useStore((s) => s.connectionLost);
  const setNotice = useStore((s) => s.setNotice);
  if (!repoError && !notice && !lost) return null;
  return (
    <div className="ui-root notices">
      {repoError && <Banner flush tone="error" text={repoError} />}
      {lost && <Banner flush lead={<Spinner size={12} />} text={`Connection to ${lost} lost. Reconnecting…`} />}
      {notice && <Banner flush tone="error" text={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}

/** Test hooks (see the `automation` command): act like a user would, without input injection. */
async function runAutomation() {
  const auto = await api.automation().catch(() => null);
  if (!auto) return;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (auto.openDiffs) {
    const s = useStore.getState();
    s.setChangesMode("base");
    await s.loadBaseDiff();
    const { baseDiff, base } = useStore.getState();
    if (baseDiff && base) {
      for (const f of baseDiff.files.filter((f) => f.kind === "modified").slice(0, auto.openDiffs)) {
        useStore.getState().openTab(revisionTab(f, baseDiff.mergeBase, "HEAD", base, "HEAD"), true);
        await wait(2000);
      }
    }
  }
  if (auto.showHistory) {
    useStore.getState().setLeftTab("history");
    await useStore.getState().loadMoreCommits();
    const sha = auto.showHistory === "1" ? useStore.getState().commits[0]?.sha : auto.showHistory;
    if (sha) await useStore.getState().selectCommit(sha);
  }
  if (auto.runAction) await useStore.getState().runAction(auto.runAction);
  if (auto.leftTab) useStore.getState().setLeftTab(auto.leftTab);
  const { cwd } = useStore.getState();
  if (auto.leftTab || auto.showHistory || auto.listKeys || auto.historySearch || auto.fileHistory) useStore.getState().setView("work");
  if (auto.openFile && cwd) useStore.getState().openTab(fileTab(cwd, auto.openFile, null), true);
  if (auto.openRevFile && cwd) {
    const at = auto.openRevFile.indexOf(":");
    useStore.getState().openTab(fileTab(cwd, auto.openRevFile.slice(at + 1), auto.openRevFile.slice(0, at)), true);
  }
  if (auto.openCommitFile) {
    // A file of the commit WV_SHOW_HISTORY selected, as clicking it in the commit pane would.
    const c = useStore.getState().selectedCommit;
    const f = c?.files.find((f) => f.path === auto.openCommitFile);
    if (c && f) useStore.getState().openTab(commitFileTab(f, c.detail, c.parent), true);
    else console.error(`WV_OPEN_COMMIT_FILE: ${auto.openCommitFile} is not in the selected commit`);
  }
  if (auto.openSettings) {
    useStore.getState().openSettings();
    if (auto.openSettings === "settings.json") await useStore.getState().openSettingsFile();
    else if (auto.openSettings !== "1") useStore.getState().setSettingsQuery(auto.openSettings);
  }
  if (auto.settingsPatch && typeof auto.settingsPatch === "object") {
    // Like changing them in Settings, a moment after everything above has rendered.
    await wait(2000);
    const s = useStore.getState();
    const patch = auto.settingsPatch as Record<string, unknown>;
    const merged = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => {
        const cur = (s.settings as unknown as Record<string, unknown>)[k];
        return [k, v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" ? { ...cur, ...v } : v];
      }),
    );
    s.updateSettings(normalizeSettings({ ...s.settings, ...merged }));
  }
  if (auto.blame) useStore.getState().toggleBlame();
  if (auto.fileHistory) {
    await useStore.getState().openFileHistory(auto.fileHistory);
    const first = useStore.getState().fileHistory?.entries[0];
    if (first) useStore.getState().openTab(commitFileTab(first.file, first.commit, first.parent), true);
  }
  if (auto.historySearch) {
    // Typed into the search box, as a user would.
    useStore.getState().setLeftTab("history");
    const input = await waitFor<HTMLInputElement>(".history-search input");
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, auto.historySearch);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  if (auto.blame?.startsWith("click:")) await clickBlameForTest(Number(auto.blame.slice(6)));
  if (auto.imageZoom) await zoomImageForTest(auto.imageZoom);
  if (auto.previewLink !== null) await followPreviewLinkForTest(auto.previewLink);
  if (auto.reveal) useStore.getState().revealInExplorer(auto.reveal);
  if (auto.worktrees) await worktreesForTest(auto.worktrees);
  if (auto.listKeys) await pressListKeysForTest(auto.listKeys.split(","));
  if (auto.contextMenu) await openMenuForTest(auto.contextMenu);
}

/**
 * WV_WORKTREES=1|chip:<n>|feed:<n>: opens the Worktrees overview, then clicks the n-th worktree chip of
 * the shared files, or the n-th link in Activity (waiting up to a minute for one to appear).
 */
async function worktreesForTest(spec: string) {
  useStore.getState().setView("overview");
  const [what, n] = spec.split(":");
  if (what !== "chip" && what !== "feed") return;
  const sel = what === "chip" ? ".ov-shared button.chip" : ".ov-feed .ev-link, .ov-feed button.ev-file";
  for (let i = 0; i < 600; i++) {
    const el = document.querySelectorAll<HTMLElement>(sel)[Number(n)];
    if (el) {
      await new Promise((r) => setTimeout(r, 500));
      return el.click();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`WV_WORKTREES: nothing matches ${sel} #${n}`);
}

/** WV_LIST_KEYS=ArrowDown,ArrowLeft,Ctrl+3,…: presses the keys in the left pane's list, as typing them there would. */
async function pressListKeysForTest(keys: string[]) {
  const list = await waitFor<HTMLElement>(".left .lbox");
  if (!list) return console.error("WV_LIST_KEYS: no list in the left pane");
  await new Promise((r) => setTimeout(r, 1000));
  list.focus();
  for (const k of keys) {
    const mods = k.split("+");
    const key = mods.pop()!;
    const code = /^[0-9]$/.test(key) ? `Digit${key}` : key;
    list.dispatchEvent(new KeyboardEvent("keydown", { key, code, ctrlKey: mods.includes("Ctrl"), shiftKey: mods.includes("Shift"), bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** WV_BLAME=click:<line>: once the blame margin shows, presses the mouse on that line's margin. */
async function clickBlameForTest(line: number) {
  for (let i = 0; i < 150; i++) {
    const nums = [...document.querySelectorAll<HTMLElement>(".blame-on .margin-view-overlays .line-numbers")];
    const el = nums.find((e) => e.textContent?.trim().endsWith(` ${line}`) && /[0-9a-f]{7} /.test(e.textContent ?? ""));
    if (el) {
      const r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: r.left + 20, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new MouseEvent("mousedown", at));
      el.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.error(`WV_BLAME: no blamed line ${line}`);
}

/** WV_IMAGE_ZOOM=in|out|fit|<scale>: once an image view shows, zooms it as Ctrl+= / Ctrl+- / Ctrl+0 would. */
async function zoomImageForTest(z: string) {
  if (!(await waitFor(".image-view img"))) return console.error("WV_IMAGE_ZOOM: no image shown");
  await new Promise((r) => setTimeout(r, 500));
  if (z === "in" || z === "out" || z === "fit") imageCommands.zoom(z === "in" ? 1 : z === "out" ? -1 : 0);
  else imageCommands.set(Number(z));
}

/**
 * WV_PREVIEW_LINK=n: once an HTML preview shows, follows its n-th link (from 0) the way a
 * click does: the frame navigates to the link's URL. The page inside cannot be reached
 * from here (it has its own origin), so the link is read from the page the app gave it.
 */
async function followPreviewLinkForTest(n: number) {
  const frame = await waitFor<HTMLIFrameElement>("iframe.html-preview");
  if (!frame) return console.error("WV_PREVIEW_LINK: no HTML preview");
  await new Promise((r) => setTimeout(r, 1500));
  const links = [...new DOMParser().parseFromString(previewForTest.html, "text/html").querySelectorAll("a[href*='/~link?']")];
  const href = links[n]?.getAttribute("href");
  if (!href) return console.error(`WV_PREVIEW_LINK: the page has ${links.length} links`);
  frame.contentWindow!.location.href = href;
}

async function waitFor<T extends Element>(sel: string): Promise<T | null> {
  for (let i = 0; i < 100; i++) {
    const el = document.querySelector<T>(sel);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * WV_CONTEXT_MENU=<place>[:key]: opens a context menu the way a user would, with a
 * contextmenu event on the row (or with `:key`, Shift+F10 on the focused list), so
 * the open menu can be screenshotted. Events go to this window's page only.
 */
async function openMenuForTest(spec: string) {
  const [head, pickLabel] = spec.split(">");
  const [place, how] = head.split(":");
  keepOverlaysOnBlur();
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const find = async (sel: string, pick?: (els: HTMLElement[]) => HTMLElement | undefined) => {
    for (let i = 0; i < 100; i++) {
      const els = [...document.querySelectorAll<HTMLElement>(sel)];
      const el = pick ? pick(els) : els[0];
      if (el) return el;
      await wait(100);
    }
    throw new Error(`WV_CONTEXT_MENU: nothing matches ${sel}`);
  };
  // `select`: click the row first, so the key acts on it (not for dropdown items, where a click picks).
  const open = async (el: HTMLElement, select = true) => {
    if (how === "key") {
      if (select) {
        el.click();
        await wait(300);
      }
      const target = (el.closest(".lbox") as HTMLElement | null) ?? el;
      target.focus();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", code: "F10", shiftKey: true, bubbles: true, cancelable: true }));
      return;
    }
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + Math.min(80, r.width / 2), clientY: r.top + r.height / 2 }));
  };
  const s = useStore.getState();
  const dropdown = async (button: string) => {
    (await find(button)).click();
    return find(".picker .mi", (els) => els.find((e) => e.dataset.current) ?? els[0]);
  };
  const isFolder = (e: HTMLElement) => !!e.querySelector(".tchev svg");
  // Rows of a scrolled list are also rendered just outside its visible part.
  const shown = (e: HTMLElement) => {
    const r = e.getBoundingClientRect();
    const box = (e.closest(".lbox") ?? document.body).getBoundingClientRect();
    return r.top >= box.top && r.bottom <= box.bottom;
  };
  const visibleRow = (pref?: (e: HTMLElement) => boolean) => (els: HTMLElement[]) => {
    const vis = els.filter(shown);
    return (pref && vis.find(pref)) ?? vis[0];
  };
  try {
    await openPlace(place);
    if (pickLabel) {
      // Chooses an option, as a click on it would.
      const item = await find(".menu [role=menuitem]", (els) => els.find((e) => e.textContent?.startsWith(pickLabel)));
      await wait(300);
      item.click();
    }
  } catch (e) {
    console.error(e);
  }

  async function openPlace(place: string) {
    if (place !== "repo" && place !== "worktree") s.setView("work");
    switch (place) {
      case "changes":
        s.setLeftTab("changes");
        // Nothing uncommitted: the branch's own changes have rows.
        if (s.settings.changesMode === "uncommitted" && !s.status?.entries.some((e) => e.kind !== "ignored")) s.setChangesMode("base");
        return open(await find(".left .lbox .row", visibleRow((e) => !!e.querySelector(".k-modified"))));
      case "commit":
      case "commitfile":
        if (!useStore.getState().selectedCommit) {
          s.setLeftTab("history");
          await s.loadMoreCommits();
          const sha = useStore.getState().commits[0]?.sha;
          if (sha) await s.selectCommit(sha);
        }
        return open(await find(place === "commit" ? ".history .lbox .row" : ".commit-pane .lbox .row", visibleRow()));
      case "explorer":
      case "folder":
        s.setLeftTab("explorer");
        return open(await find(".tree .row", visibleRow((e) => isFolder(e) === (place === "folder"))));
      case "search": {
        s.focusSearch();
        const input = await find(".search-form input");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "import");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        (input as HTMLInputElement).form!.requestSubmit();
        return open(await find(".left .lbox .row", (els) => els.filter(shown)[1]));
      }
      case "quickopen":
        s.setPalette("files");
        if (how === "key") {
          const input = await find(".pal input");
          await find(".pal .mi");
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", code: "ContextMenu", bubbles: true, cancelable: true }));
          return;
        }
        return open(await find(".pal .mi", (els) => els[1] ?? els[0]));
      case "tab":
        return open(await find(".tabs .tab", (els) => (els.length > 1 ? els[els.length - 2] : els[0])));
      case "repo":
        return open(await dropdown(".t-repo"), false);
      case "worktree":
        return open(await find(".rail .wt:not(.off)", (els) => els[1] ?? els[0]));
      case "branch":
        return open(await dropdown(".br-btn"), false);
    }
  }
}
