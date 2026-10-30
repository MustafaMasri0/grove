import { describe, expect, it, vi } from "vitest";
import { branchItems, commitItems, fileItems, folderItems, repoItems, tabItems, worktreeItems, type MenuEnv } from "./contextMenus";
import type { MenuItem } from "./menu";

function env() {
  const copied: string[] = [];
  const e = {
    copy: vi.fn(async (t: string | Promise<string>) => void copied.push(await t)),
    reveal: vi.fn(),
    openUrl: vi.fn(),
  } satisfies MenuEnv;
  return { e, copied };
}

/** "Label" for items, "Label (off)" for disabled ones, "-" for separators. */
const labels = (items: MenuItem[]) => items.map((i) => ("separator" in i ? "-" : `${i.label}${i.disabled ? " (off)" : ""}`));
const run = async (items: MenuItem[], label: string) => {
  const it = items.find((i) => !("separator" in i) && i.label === label);
  if (!it || "separator" in it) throw new Error(`no item ${label}`);
  await it.run();
};

const wsl = { host: { kind: "wsl" as const, distro: "Ubuntu", separator: "/" }, cwd: "/home/user/repo" };
const win = { host: { kind: "local" as const, distro: null, separator: "\\" }, cwd: "D:/src/wv" };
const ssh = { host: { kind: "ssh" as const, distro: null, separator: "/" }, cwd: "/home/user/repo" };

describe("fileItems", () => {
  it("offers Open, Open file and the copy and reveal options for a diff row", () => {
    const { e } = env();
    const items = fileItems(e, wsl, { path: "src/a.ts", open: () => {}, openFile: () => {}, onDisk: true });
    expect(labels(items)).toEqual(["Open", "Open file", "-", "Copy path", "Copy relative path", "Copy file name", "-", "Reveal in File Explorer"]);
  });

  it("has no Open file for a plain file, and no Open at all when nothing is given", () => {
    const { e } = env();
    expect(labels(fileItems(e, wsl, { path: "a.ts", open: () => {}, onDisk: true }))[1]).toBe("-");
    expect(labels(fileItems(e, wsl, { path: "a.ts", onDisk: true }))[0]).toBe("Copy path");
  });

  it("can't reveal a file on an SSH host, but copies its path there", async () => {
    const { e, copied } = env();
    const items = fileItems(e, ssh, { path: "src/a.ts", onDisk: true });
    expect(labels(items)).toContain("Reveal in File Explorer (off)");
    await run(items, "Copy path");
    expect(copied).toEqual(["/home/user/repo/src/a.ts"]);
  });

  it("copies WSL paths as \\\\wsl.localhost paths and relative paths with slashes", async () => {
    const { e, copied } = env();
    const items = fileItems(e, wsl, { path: "src/a.ts", onDisk: true });
    await run(items, "Copy path");
    await run(items, "Copy relative path");
    await run(items, "Copy file name");
    expect(copied).toEqual(["\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\src\\a.ts", "src/a.ts", "a.ts"]);
  });

  it("copies Windows paths with backslashes", async () => {
    const { e, copied } = env();
    const items = fileItems(e, win, { path: "src/a.ts", onDisk: true });
    await run(items, "Copy path");
    await run(items, "Copy relative path");
    expect(copied).toEqual(["D:\\src\\wv\\src\\a.ts", "src\\a.ts"]);
  });

  it("reveals the Windows path, and is disabled for files that are not on disk", async () => {
    const { e } = env();
    await run(fileItems(e, wsl, { path: "src/a.ts", onDisk: true }), "Reveal in File Explorer");
    expect(e.reveal).toHaveBeenCalledWith("\\\\wsl.localhost\\Ubuntu\\home\\user\\repo\\src\\a.ts");
    expect(labels(fileItems(e, wsl, { path: "gone.ts", onDisk: false })).at(-1)).toBe("Reveal in File Explorer (off)");
  });

  it("offers View file history after the open options when the row has a history", async () => {
    const { e } = env();
    const history = vi.fn();
    const items = fileItems(e, wsl, { path: "src/a.ts", open: () => {}, openFile: () => {}, history, onDisk: true });
    expect(labels(items).slice(0, 4)).toEqual(["Open", "Open file", "View file history", "-"]);
    await run(items, "View file history");
    expect(history).toHaveBeenCalled();
    // Without opens it leads the menu; without a history it is not offered.
    expect(labels(fileItems(e, wsl, { path: "a.ts", history, onDisk: true })).slice(0, 2)).toEqual(["View file history", "-"]);
    expect(labels(fileItems(e, wsl, { path: "a.ts", onDisk: true }))).not.toContain("View file history");
  });

  it("offers Reveal in Explorer before Reveal in File Explorer when the row can be revealed", async () => {
    const { e } = env();
    const revealInExplorer = vi.fn();
    const items = fileItems(e, wsl, { path: "src/a.ts", open: () => {}, revealInExplorer, onDisk: true });
    expect(labels(items).slice(-3)).toEqual(["-", "Reveal in Explorer", "Reveal in File Explorer"]);
    await run(items, "Reveal in Explorer");
    expect(revealInExplorer).toHaveBeenCalled();
    // Disabled for a file Explorer does not list (deleted); not offered in Explorer itself.
    expect(labels(fileItems(e, wsl, { path: "x", revealInExplorer: null, onDisk: false }))).toContain("Reveal in Explorer (off)");
    expect(labels(fileItems(e, wsl, { path: "x", onDisk: true }))).not.toContain("Reveal in Explorer");
  });

  it("disables Open file when the file has no current version", () => {
    const { e } = env();
    expect(labels(fileItems(e, wsl, { path: "x", open: () => {}, openFile: null, onDisk: false }))[1]).toBe("Open file (off)");
  });
});

describe("folderItems", () => {
  it("offers copy, reveal and Collapse all", async () => {
    const { e, copied } = env();
    const collapse = vi.fn();
    const items = folderItems(e, win, { path: "src/lib", onDisk: true, collapseAll: collapse });
    expect(labels(items)).toEqual(["Copy path", "Copy relative path", "-", "Reveal in File Explorer", "-", "Collapse all"]);
    await run(items, "Copy path");
    await run(items, "Collapse all");
    expect(copied).toEqual(["D:\\src\\wv\\src\\lib"]);
    expect(collapse).toHaveBeenCalled();
  });
});

describe("tabItems", () => {
  const base = { close: vi.fn(), closeOthers: vi.fn(), closeRight: vi.fn(), closeAll: vi.fn(), keepOpen: vi.fn() };

  it("offers the close options, Keep open and Copy path", () => {
    const { e } = env();
    const items = tabItems(e, { ...base, index: 0, count: 3, preview: true, path: "C:\\x\\a.ts" });
    expect(labels(items)).toEqual(["Close", "Close others", "Close to the right", "Close all", "-", "Keep open", "-", "Copy path"]);
  });

  it("offers Reveal in Explorer for a repository file's tab", async () => {
    const { e } = env();
    const revealInExplorer = vi.fn();
    const items = tabItems(e, { ...base, index: 0, count: 1, preview: false, path: "C:\\x\\a.ts", revealInExplorer });
    expect(labels(items).slice(-2)).toEqual(["Copy path", "Reveal in Explorer"]);
    await run(items, "Reveal in Explorer");
    expect(revealInExplorer).toHaveBeenCalled();
  });

  it("disables what does not apply to a lone, kept, path-less tab", () => {
    const { e } = env();
    const items = tabItems(e, { ...base, index: 0, count: 1, preview: false, path: null });
    expect(labels(items)).toEqual(["Close", "Close others (off)", "Close to the right (off)", "Close all", "-", "Keep open (off)", "-", "Copy path (off)"]);
  });

  it("offers View file history for file tabs only", async () => {
    const { e } = env();
    const history = vi.fn();
    const items = tabItems(e, { ...base, index: 0, count: 1, preview: false, path: "C:\\x\\a.ts", history });
    expect(labels(items).slice(-4)).toEqual(["Keep open (off)", "-", "View file history", "Copy path"]);
    await run(items, "View file history");
    expect(history).toHaveBeenCalled();
    expect(labels(tabItems(e, { ...base, index: 0, count: 1, preview: false, path: null }))).not.toContain("View file history");
  });

  it("disables Close to the right on the last tab and shows Ctrl+W on Close", () => {
    const { e } = env();
    const items = tabItems(e, { ...base, index: 2, count: 3, preview: false, path: null });
    expect(labels(items)[2]).toBe("Close to the right (off)");
    expect(items[0]).toMatchObject({ shortcut: "Ctrl+W" });
  });
});

describe("commitItems", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";

  it("copies the sha, the short sha, the subject and the full message", async () => {
    const { e, copied } = env();
    const items = commitItems(e, { sha, subject: "fix: x", message: () => Promise.resolve("fix: x\n\nbody\n"), github: null });
    expect(labels(items)).toEqual(["Copy SHA", "Copy short SHA", "Copy subject", "Copy message"]);
    for (const l of ["Copy SHA", "Copy short SHA", "Copy subject", "Copy message"]) await run(items, l);
    expect(copied).toEqual([sha, "0123456", "fix: x", "fix: x\n\nbody"]);
  });

  it("adds Open on GitHub only for github.com repositories", async () => {
    const { e } = env();
    const items = commitItems(e, { sha, subject: "s", message: () => "s", github: "owner/repo" });
    expect(labels(items).slice(-2)).toEqual(["-", "Open on GitHub"]);
    await run(items, "Open on GitHub");
    expect(e.openUrl).toHaveBeenCalledWith(`https://github.com/owner/repo/commit/${sha}`);
  });
});

describe("top bar items", () => {
  it("repository: copy path and name, reveal, remove", async () => {
    const { e, copied } = env();
    const remove = vi.fn();
    const items = repoItems(e, { name: "example", path: "\\\\wsl.localhost\\Ubuntu\\home\\user\\example", reveal: true, remove });
    expect(labels(items)).toEqual(["Copy path", "Copy name", "-", "Reveal in File Explorer", "-", "Remove from list"]);
    await run(items, "Copy path");
    await run(items, "Copy name");
    await run(items, "Remove from list");
    expect(copied).toEqual(["\\\\wsl.localhost\\Ubuntu\\home\\user\\example", "example"]);
    expect(remove).toHaveBeenCalled();
  });

  it("repository that failed to open: path from the list, no reveal", () => {
    const { e } = env();
    expect(labels(repoItems(e, { name: "x", path: null, reveal: true, remove: () => {} }))).toEqual(["Copy path (off)", "Copy name", "-", "Reveal in File Explorer (off)", "-", "Remove from list"]);
  });

  it("worktree: copy path and branch, reveal unless missing", async () => {
    const { e, copied } = env();
    const items = worktreeItems(e, { path: "D:\\wt\\a", branch: "feat/x", missing: false, reveal: true });
    expect(labels(items)).toEqual(["Copy path", "Copy branch name", "-", "Reveal in File Explorer"]);
    await run(items, "Copy branch name");
    expect(copied).toEqual(["feat/x"]);
    expect(labels(worktreeItems(e, { path: "D:\\wt\\b", branch: null, missing: true, reveal: true }))).toEqual(["Copy path", "Copy branch name (off)", "-", "Reveal in File Explorer (off)"]);
    expect(labels(worktreeItems(e, { path: "/home/user/wt", branch: "x", missing: false, reveal: false }))).toEqual(["Copy path", "Copy branch name", "-", "Reveal in File Explorer (off)"]);
  });

  it("branch: copy name", async () => {
    const { e, copied } = env();
    const items = branchItems(e, { name: "origin/main" });
    expect(labels(items)).toEqual(["Copy name"]);
    await run(items, "Copy name");
    expect(copied).toEqual(["origin/main"]);
  });
});
