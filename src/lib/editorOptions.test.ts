import { describe, expect, it } from "vitest";
import { editorOptions, fontStack } from "./editorOptions";
import { defaultSettings } from "./settings";

describe("fontStack", () => {
  it("adds monospace fallbacks after the chosen font", () => {
    expect(fontStack("Consolas")).toBe("Consolas, 'Courier New', monospace");
    expect(fontStack("'Cascadia Code', Consolas")).toBe("'Cascadia Code', Consolas, 'Courier New', monospace");
  });

  it("uses Consolas for an empty font", () => {
    expect(fontStack("  ")).toBe("Consolas, 'Courier New', monospace");
  });
});

describe("editorOptions", () => {
  it("maps the defaults to the options the editors were created with before settings existed", () => {
    expect(editorOptions(defaultSettings.editor)).toEqual({
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 0,
      fontLigatures: false,
      wordWrap: "off",
      renderWhitespace: "selection",
      stickyScroll: { enabled: true },
      lineNumbers: "on",
    });
  });

  it("passes the user's choices through", () => {
    const o = editorOptions({ ...defaultSettings.editor, fontSize: 16, lineHeight: 22, fontLigatures: true, wordWrap: "on", stickyScroll: false, lineNumbers: "relative" });
    expect(o).toMatchObject({ fontSize: 16, lineHeight: 22, fontLigatures: true, wordWrap: "on", stickyScroll: { enabled: false }, lineNumbers: "relative" });
  });
});
