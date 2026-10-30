import { describe, expect, it } from "vitest";
import { canReveal, displayPath, githubCommitUrl, joinPath, relativeForCopy, sshAddress } from "./hostPaths";

const wsl = { kind: "wsl" as const, distro: "Ubuntu", separator: "/" };
const win = { kind: "local" as const, distro: null, separator: "\\" };
const mac = { kind: "local" as const, distro: null, separator: "/" };
const ssh = { kind: "ssh" as const, distro: null, separator: "/" };

describe("displayPath", () => {
  it("turns a WSL path into a \\\\wsl.localhost path", () => {
    expect(displayPath(wsl, "/home/user/src/example/src/app.ts")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\user\\src\\example\\src\\app.ts");
  });

  it("maps the distro root", () => {
    expect(displayPath(wsl, "/")).toBe("\\\\wsl.localhost\\Ubuntu\\");
  });

  it("uses backslashes for Windows paths", () => {
    expect(displayPath(win, "C:/src/example/src/App.tsx")).toBe("C:\\src\\example\\src\\App.tsx");
  });

  it("leaves paths on Linux, macOS and SSH hosts as they are", () => {
    expect(displayPath(mac, "/Users/user/src/a.ts")).toBe("/Users/user/src/a.ts");
    expect(displayPath(ssh, "/home/user/src/a.ts")).toBe("/home/user/src/a.ts");
    expect(displayPath(ssh, "C:/src/a.ts")).toBe("C:/src/a.ts");
  });

  it("keeps spaces and unicode", () => {
    expect(displayPath(wsl, "/home/a b/ü.md")).toBe("\\\\wsl.localhost\\Ubuntu\\home\\a b\\ü.md");
  });
});

describe("sshAddress", () => {
  it("joins a host and a path", () => {
    expect(sshAddress("dev@build:2222", "/home/user/src/example")).toBe("ssh://dev@build:2222/home/user/src/example");
    expect(sshAddress(" build ", " ~/src/example ")).toBe("ssh://build/~/src/example");
  });

  it("takes a Windows path and a pasted ssh:// host", () => {
    expect(sshAddress("ssh://build/", "C:\\src\\example")).toBe("ssh://build/C:/src/example");
  });
});

describe("canReveal", () => {
  it("is for files this machine can see", () => {
    expect([win, wsl, mac, ssh].map(canReveal)).toEqual([true, true, true, false]);
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
