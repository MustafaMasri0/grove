import { describe, expect, it } from "vitest";
import { childrenOf, dirsWithChanges, sortPaths } from "./tree";

const files = sortPaths([
  "src/main.ts",
  "src/lib/a.ts",
  "src/lib/b.ts",
  "src/Zeta.ts",
  "README.md",
  ".gitignore",
  "srcfile.txt",
  "docs/x/y/z.md",
]);

describe("childrenOf", () => {
  it("lists folders first, then files, case-insensitively sorted", () => {
    expect(childrenOf(files, "").map((e) => `${e.isDir ? "d" : "f"}:${e.name}`)).toEqual([
      "d:docs",
      "d:src",
      "f:.gitignore",
      "f:README.md",
      "f:srcfile.txt",
    ]);
  });

  it("lists a nested folder without leaking siblings that share a prefix", () => {
    expect(childrenOf(files, "src").map((e) => e.path)).toEqual(["src/lib", "src/main.ts", "src/Zeta.ts"]);
  });

  it("deep folders only show their direct child", () => {
    expect(childrenOf(files, "docs").map((e) => e.path)).toEqual(["docs/x"]);
  });

  it("unknown folders are empty", () => {
    expect(childrenOf(files, "nope")).toEqual([]);
  });

  it("ignored folder entries (trailing slash) appear as folders", () => {
    const withIgnored = sortPaths([...files, "node_modules/", "debug.log"]);
    const root = childrenOf(withIgnored, "");
    expect(root.find((e) => e.name === "node_modules")).toMatchObject({ isDir: true, path: "node_modules" });
    expect(root.filter((e) => e.name === "node_modules").length).toBe(1);
  });
});

describe("dirsWithChanges", () => {
  it("marks every ancestor folder of a changed file", () => {
    const d = dirsWithChanges(["src/lib/a.ts", "top.txt"]);
    expect([...d].sort()).toEqual(["src", "src/lib"]);
  });
});
