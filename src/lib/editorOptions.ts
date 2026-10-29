// Editor settings as Monaco options, shared by the file and the diff editor.
// Minimap and tab size are applied separately: the minimap only to file views,
// the tab size to the text models.
import type { EditorSettings } from "./settings";

export function fontStack(family: string): string {
  return `${family.trim() || "Consolas"}, 'Courier New', monospace`;
}

export function editorOptions(e: EditorSettings) {
  return {
    fontFamily: fontStack(e.fontFamily),
    fontSize: e.fontSize,
    lineHeight: e.lineHeight,
    fontLigatures: e.fontLigatures,
    wordWrap: e.wordWrap,
    renderWhitespace: e.renderWhitespace,
    stickyScroll: { enabled: e.stickyScroll },
    lineNumbers: e.lineNumbers,
  };
}
