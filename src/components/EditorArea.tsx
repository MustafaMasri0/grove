// The tab row, and the view for the active tab.
import { useEffect, useRef } from "react";
import { tabItems } from "../lib/contextMenus";
import { isMenuKey, type MenuItem } from "../lib/menu";
import { useStore } from "../store";
import { docKey, isDocumentTab, revealPathOf, tabsToClose, type CloseWhich, type Tab } from "../tabs";
import { menuEnv } from "../menuEnv";
import { EditorTab, menuAtElement, menuAtPointer } from "../ui";
import { DocumentView, Message } from "./DocumentView";
import { IssueView } from "./IssueView";
import { kindOf } from "./tabKinds";
import "../editor.css";

function tabMenu(t: Tab): MenuItem[] {
  const { tabs, cwd, closeTab, closeTabs, pinTab } = useStore.getState();
  const close = (which: CloseWhich) => closeTabs(tabsToClose(useStore.getState().tabs, t.id, which), t.id);
  const kind = kindOf(t);
  const hist = kind.history(t);
  const reveal = revealPathOf(t, cwd);
  return tabItems(menuEnv, {
    index: tabs.findIndex((x) => x.id === t.id),
    count: tabs.length,
    preview: t.isPreview,
    path: kind.path(t),
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
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const pinTab = useStore((s) => s.pinTab);
  const strip = useRef<HTMLDivElement>(null);
  const active = tabs.find((t) => t.id === activeId) ?? null;
  const issues = useStore((s) => s.listPane === "issues");
  const unsaved = useStore((s) => s.unsaved);

  // The strip has no scrollbar, so the active tab brings itself into view.
  useEffect(() => {
    strip.current?.querySelector(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  return (
    <section className="editor-area">
      <div className="ui-root ed-chrome">
        <div ref={strip} className="tabs">
          <div className="tabs-in" role="tablist">
            {tabs.map((t) => {
              const kind = kindOf(t);
              const dirty = docKey(t) in unsaved;
              return (
                <EditorTab
                  key={t.id}
                  text={t.title}
                  on={t.id === activeId}
                  preview={t.isPreview}
                  lead={kind.lead(t)}
                  mark={kind.mark}
                  dirty={dirty}
                  title={dirty ? `${kind.tip(t)}\nUnsaved changes` : kind.tip(t)}
                  closeTip="Close (Ctrl+W)"
                  onClose={() => closeTab(t.id)}
                  onContextMenu={(e) => menuAtPointer(e, tabMenu(t))}
                  onKeyDown={(e) => {
                    if (isMenuKey(e)) {
                      e.preventDefault();
                      menuAtElement(e.currentTarget, tabMenu(t));
                    } else if (e.key === "Enter" && e.target === e.currentTarget) {
                      e.preventDefault();
                      activateTab(t.id);
                      pinTab(t.id);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(t.id);
                    }
                  }}
                  onClick={() => activateTab(t.id)}
                  onDoubleClick={() => pinTab(t.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
      <DocumentView tab={active && isDocumentTab(active) ? active : null} />
      {active?.kind === "issue" && <IssueView key={active.id} tab={active} />}
      {!active && (
        <div className="editor-stack">
          <Message
            text={issues ? "Select an issue, a changed file or a file in Explorer." : "Select a changed file, a commit file or a file in Explorer."}
            hint="Ctrl+P open file · Ctrl+Shift+F search · Ctrl+1/2/3 switch panes · F5 refresh · Ctrl+, settings"
          />
        </div>
      )}
    </section>
  );
}
