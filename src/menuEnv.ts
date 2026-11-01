// What context menu options need from outside the app, and where a row belongs.
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText } from "./api";
import { worktreeItems, type MenuEnv, type Where } from "./lib/contextMenus";
import { canReveal } from "./lib/hostPaths";
import { useStore } from "./store";

const fail = (what: string) => (e: unknown) => useStore.getState().setNotice(`${what}: ${errorText(e)}`);

/** Clipboard, File Explorer and the browser, for the menu options. */
export const menuEnv: MenuEnv = {
  copy: async (text) => {
    try {
      await api.copyText(await text);
    } catch (e) {
      fail("Could not copy")(e);
    }
  },
  reveal: (path) => revealItemInDir(path).catch(fail(`Could not show ${path} in File Explorer`)),
  openUrl: (url) => openUrl(url).catch(fail(`Could not open ${url}`)),
  terminal: (cwd) => {
    const { repo } = useStore.getState();
    return repo ? api.openTerminal(repo.id, cwd).catch(fail("Could not open a terminal")) : undefined;
  },
};

/** The menu of a worktree, wherever it is listed. */
export function worktreeMenu(w: { path: string; displayPath: string; branch: string | null; missing: boolean }) {
  const { repo } = useStore.getState();
  return worktreeItems(menuEnv, { path: w.displayPath, cwd: w.path, branch: w.branch, missing: w.missing, reveal: !!repo && canReveal(repo) });
}

/** The worktree the left pane shows, for the path options. */
export function currentWhere(): Where | null {
  const { repo, cwd } = useStore.getState();
  return repo && cwd ? { host: repo, cwd } : null;
}
