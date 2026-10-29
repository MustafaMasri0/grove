import { describe, expect, it } from "vitest";
import { githubCommitUrl, joinPath, relativeForCopy, windowsPath } from "./hostPaths";

const wsl = { kind: "wsl" as const, distro: "Ubuntu" };
const win = { kind: "windows" as const, distro: null };

describe("windowsPath", () => {
  it("turns a WSL path into a \\\\wsl.localhost path", () => {
    expect(windowsPath(wsl, "/home/user/src/example/src/app.ts")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\user\\src\\example\\src\\app.ts");
  });

  it("maps the distro root", () => {
    expect(windowsPath(wsl, "/")).toBe("\\\\wsl.localhost\\Ubuntu\\");
  });

  it("uses backslashes for Windows paths", () => {
    expect(windowsPath(win, "C:/src/example/src/App.tsx")).toBe("C:\\src\\example\\src\\App.tsx");
  });

  it("keeps spaces and unicode", () => {
    expect(windowsPath(wsl, "/home/a b/ü.md")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\a b\\ü.md");
  });
});

describe("joinPath", () => {
  it("joins a worktree and a repository-relative path", () => {
    expect(joinPath("/home/user/repo", "src/a.ts")).toBe("/home/user/repo/src/a.ts");
    expect(joinPath("D:/src/wv/", "README.md")).toBe("D:/src/wv/README.md");
  });

  it("returns the worktree for an empty relative path", () => {
    expect(joinPath("/home/user/repo", "")).toBe("/home/user/repo");
  });
});

describe("relativeForCopy", () => {
  it("uses backslashes for Windows repositories and slashes for WSL ones", () => {
    expect(relativeForCopy(win, "src/lib/a.ts")).toBe("src\\lib\\a.ts");
    expect(relativeForCopy(wsl, "src/lib/a.ts")).toBe("src/lib/a.ts");
  });
});

describe("githubCommitUrl", () => {
  it("links a commit of an owner/repo", () => {
    expect(githubCommitUrl("example-org/example", "0123456789abcdef0123456789abcdef01234567")).toBe(
      "https://github.com/example-org/example/commit/0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("refuses anything that is not owner/repo and a hex sha", () => {
    expect(githubCommitUrl("a/b/c", "abc1234")).toBeNull();
    expect(githubCommitUrl("a/b", "HEAD; rm")).toBeNull();
    expect(githubCommitUrl(null, "abc1234")).toBeNull();
  });
});
