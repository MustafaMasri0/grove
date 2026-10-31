// What context menu options need from outside the app, and where a row belongs.
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText } from "./api";
import type { MenuEnv, Where } from "./lib/contextMenus";
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
};

/** The worktree the left pane shows, for the path options. */
export function currentWhere(): Where | null {
  const { repo, cwd } = useStore.getState();
  return repo && cwd ? { host: repo, cwd } : null;
}
