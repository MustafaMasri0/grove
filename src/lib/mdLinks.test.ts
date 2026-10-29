import { describe, expect, it } from "vitest";
import { classifyLink, resolveRepoPath } from "./mdLinks";

describe("resolveRepoPath", () => {
  it("resolves relative to the markdown file's folder", () => {
    expect(resolveRepoPath("docs/guide/intro.md", "setup.md")).toBe("docs/guide/setup.md");
    expect(resolveRepoPath("docs/guide/intro.md", "./img/a.png")).toBe("docs/guide/img/a.png");
    expect(resolveRepoPath("docs/guide/intro.md", "../README.md")).toBe("docs/README.md");
    expect(resolveRepoPath("README.md", "docs/a.md")).toBe("docs/a.md");
  });

  it("treats a leading slash as the repository root", () => {
    expect(resolveRepoPath("docs/guide/intro.md", "/CONTRIBUTING.md")).toBe("CONTRIBUTING.md");
  });

  it("drops query and fragment, decodes escapes", () => {
    expect(resolveRepoPath("a/b.md", "c%20d.md#section")).toBe("a/c d.md");
    expect(resolveRepoPath("a/b.md", "img.png?raw=true")).toBe("a/img.png");
  });

  it("refuses to climb above the repository", () => {
    expect(resolveRepoPath("a.md", "../../etc/passwd")).toBeNull();
  });
});

describe("classifyLink", () => {
  it("separates external, anchor and repository links", () => {
    expect(classifyLink("https://example.com")).toBe("external");
    expect(classifyLink("http://x")).toBe("external");
    expect(classifyLink("mailto:a@b.c")).toBe("external");
    expect(classifyLink("#install")).toBe("anchor");
    expect(classifyLink("docs/a.md")).toBe("repo");
    expect(classifyLink("javascript:alert(1)")).toBe("blocked");
    expect(classifyLink("file:///C:/x")).toBe("blocked");
  });
});
