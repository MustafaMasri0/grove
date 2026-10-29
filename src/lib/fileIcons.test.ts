import { describe, expect, it } from "vitest";
import theme from "../assets/charmed/theme.json";
import { fileIconId, folderIconId, iconUrl } from "./fileIcons";

describe("fileIconId (Charmed)", () => {
  it("matches whole file names first, case-insensitively, ignoring the folder", () => {
    expect(fileIconId("package.json")).toBe("node");
    expect(fileIconId("src/deep/Package.JSON")).toBe("node");
    expect(fileIconId("README.md")).toBe("readme");
    expect(fileIconId("Dockerfile")).toBe("docker");
    expect(fileIconId(".gitignore")).toBe("git");
  });

  it("then the longest matching extension", () => {
    expect(fileIconId("App.tsx")).toBe("react-typescript");
    expect(fileIconId("a.spec.ts")).toBe("test-blue");
    expect(fileIconId("types.d.ts")).toBe("typescript-def");
    expect(fileIconId("notes.md")).toBe("markdown");
    expect(fileIconId("lib.RS")).toBe("rust");
  });

  it("then the language, when the name and extension say nothing", () => {
    expect(fileIconId("build.weird", "dockerfile")).toBe("docker");
    expect(fileIconId("a.ts", "plaintext")).toBe("typescript");
  });

  it("falls back to the default file icon", () => {
    expect(fileIconId("x.unknownext")).toBe("_file");
  });

  it("shows unknown types as plain text, as VS Code does (their language is plaintext)", () => {
    expect(fileIconId("noext", "plaintext")).toBe("text");
  });
});

describe("folderIconId (Charmed)", () => {
  it("has named folders, closed and open", () => {
    expect(folderIconId("src", false)).toBe("folder_source");
    expect(folderIconId("SRC", true)).toBe("folder_source_open");
  });

  it("falls back to the plain folder", () => {
    expect(folderIconId("zzz-not-a-known-folder", false)).toBe("_folder");
    expect(folderIconId("zzz-not-a-known-folder", true)).toBe("_folder_open");
  });
});

describe("iconUrl", () => {
  const ids = new Set<string>([theme.file, theme.folder, theme.folderExpanded]);
  for (const k of ["fileExtensions", "fileNames", "languageIds", "folderNames", "folderNamesExpanded"] as const) {
    for (const id of Object.values(theme[k] as Record<string, string>)) ids.add(id);
  }

  it("has a dark and a light picture for every icon the theme uses", () => {
    for (const id of ids) {
      expect(iconUrl(id, true), id).toBeTruthy();
      expect(iconUrl(id, false), id).toBeTruthy();
      expect(iconUrl(id, true)).not.toBe(iconUrl(id, false));
    }
  });

  it("serves icons as files, not inlined data", () => {
    expect(iconUrl("typescript", true)).not.toMatch(/^data:/);
  });
});
