import { describe, expect, it } from "vitest";
import { buildTree, compactFolders, flattenTree, folderKey, type TreeNode } from "./changeTree";

const f = (path: string) => ({ path });
const build = (...paths: string[]) => buildTree(paths.map(f), (x) => x.path);

/** "name (count)" for folders and "name" for files, nested as arrays. */
function shape(nodes: TreeNode<{ path: string }>[]): unknown[] {
  return nodes.map((n) => (n.kind === "folder" ? { [`${n.name} (${n.count})`]: shape(n.children) } : n.name));
}

describe("buildTree", () => {
  it("nests files under their folders, folders first, case-insensitively sorted", () => {
    const t = build("src/b.ts", "README.md", "src/lib/x.ts", "src/A.ts", "docs/guide.md", "a.txt");
    expect(shape(t)).toEqual([{ "docs (1)": ["guide.md"] }, { "src (3)": [{ "lib (1)": ["x.ts"] }, "A.ts", "b.ts"] }, "a.txt", "README.md"]);
  });

  it("keeps each item on its file node and gives folders their full path", () => {
    const t = build("src/lib/x.ts");
    const src = t[0];
    expect(src).toMatchObject({ kind: "folder", path: "src" });
    const lib = src.kind === "folder" ? src.children[0] : null;
    expect(lib).toMatchObject({ kind: "folder", path: "src/lib", name: "lib" });
    const x = lib?.kind === "folder" ? lib.children[0] : null;
    expect(x).toEqual({ kind: "file", name: "x.ts", path: "src/lib/x.ts", item: { path: "src/lib/x.ts" } });
  });

  it("counts every file below a folder, however deep", () => {
    const t = build("a/1", "a/b/2", "a/b/c/3", "a/b/c/4");
    expect(t[0]).toMatchObject({ name: "a", count: 4 });
  });

  it("is empty for no files", () => {
    expect(build()).toEqual([]);
  });
});

describe("compactFolders", () => {
  it("joins a chain of folders that each hold only one folder, like VS Code", () => {
    const t = compactFolders(build("src/main/java/App.java", "src/main/java/Util.java"));
    expect(shape(t)).toEqual([{ "src/main/java (2)": ["App.java", "Util.java"] }]);
    expect(t[0]).toMatchObject({ path: "src/main/java" });
  });

  it("stops at a folder that also holds files or more than one folder", () => {
    const t = compactFolders(build("a/b/x.ts", "a/b/c/d/y.ts", "a/b/e/z.ts"));
    expect(shape(t)).toEqual([{ "a/b (3)": [{ "c/d (1)": ["y.ts"] }, { "e (1)": ["z.ts"] }, "x.ts"] }]);
  });

  it("leaves a folder with a single file alone", () => {
    expect(shape(compactFolders(build("a/b/only.ts", "top.ts")))).toEqual([{ "a/b (1)": ["only.ts"] }, "top.ts"]);
    expect(shape(compactFolders(build("lib/only.ts")))).toEqual([{ "lib (1)": ["only.ts"] }]);
  });

  it("does not change the tree it was given", () => {
    const t = build("a/b/x.ts");
    compactFolders(t);
    expect(shape(t)).toEqual([{ "a (1)": [{ "b (1)": ["x.ts"] }] }]);
  });
});

describe("flattenTree", () => {
  const tree = compactFolders(build("src/lib/a.ts", "src/lib/b.ts", "src/main.ts", "docs/x/y.md", "z.txt"));
  const rows = (collapsed: string[] = []) => flattenTree(tree, new Set(collapsed)).map((r) => `${"  ".repeat(r.depth)}${r.node.name}`);

  it("lists every folder expanded unless collapsed, with depths", () => {
    expect(rows()).toEqual(["docs/x", "  y.md", "src", "  lib", "    a.ts", "    b.ts", "  main.ts", "z.txt"]);
  });

  it("hides what is inside a collapsed folder", () => {
    expect(rows(["src/lib"])).toEqual(["docs/x", "  y.md", "src", "  lib", "  main.ts", "z.txt"]);
    expect(rows(["src", "docs/x"])).toEqual(["docs/x", "src", "z.txt"]);
  });

  it("keys folders apart from files and links each row to its folder's row", () => {
    const r = flattenTree(tree, new Set());
    const byName = Object.fromEntries(r.map((x) => [x.node.name, x]));
    expect(byName["src"].key).toBe(folderKey("src"));
    expect(byName["a.ts"].key).toBe("src/lib/a.ts");
    expect(byName["a.ts"].parent).toBe(folderKey("src/lib"));
    expect(byName["lib"].parent).toBe(folderKey("src"));
    expect(byName["y.md"].parent).toBe(folderKey("docs/x"));
    expect(byName["src"].parent).toBeNull();
    expect(byName["z.txt"].parent).toBeNull();
  });
});

describe("folderKey", () => {
  it("never equals a file path (git paths do not end in a slash)", () => {
    expect(folderKey("src")).toBe("src/");
    expect(folderKey("src/lib")).not.toBe("src/lib");
  });
});
