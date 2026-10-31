// Monaco, bundled locally. Only the editor core, the diff editor and the
// features a read-only viewer needs are imported, plus the lightweight
// tokenizers for every language. The TypeScript/JSON/CSS/HTML language
// services (and their large workers) are left out on purpose: they add
// IntelliSense, not highlighting, and cost a lot of memory.
import * as monaco from "monaco-esm/editor/editor.api.js";
import "monaco-esm/editor/browser/coreCommands.js";
import "monaco-esm/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-esm/editor/browser/widget/diffEditor/diffEditor.contribution.js";
import "monaco-esm/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-esm/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-esm/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-esm/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-esm/features/find/register.js";
import "monaco-esm/editor/contrib/find/browser/findController.js";
import "monaco-esm/editor/contrib/folding/browser/folding.js";
import "monaco-esm/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-esm/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-esm/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-esm/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-esm/editor/contrib/smartSelect/browser/smartSelect.js";
import "monaco-esm/editor/contrib/stickyScroll/browser/stickyScrollContribution.js";
import "monaco-esm/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-esm/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js";
import "monaco-esm/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-esm/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-esm/editor/contrib/wordPartOperations/browser/wordPartOperations.js";
import "monaco-esm/editor/common/standaloneStrings.js";
import "monaco-esm/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-esm/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import "monaco-esm/languages/definitions/register.all.js";
import EditorWorker from "monaco-esm/editor/editor.worker.js?worker";
import { editorTheme } from "./lib/editorTheme";

// The diff computation runs in the editor worker; nothing else needs one.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Monaco ships no JSON tokenizer outside the JSON language service.
monaco.languages.register({
  id: "json",
  extensions: [".json", ".jsonc", ".json5", ".jsonl", ".webmanifest", ".code-workspace", ".babelrc", ".eslintrc"],
  filenames: [".prettierrc", "composer.lock"],
  aliases: ["JSON", "json"],
});
monaco.languages.setLanguageConfiguration("json", {
  brackets: [
    ["{", "}"],
    ["[", "]"],
  ],
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
});
monaco.languages.setMonarchTokensProvider("json", {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key.json"],
      [/"(?:[^"\\]|\\.)*"/, "string.value.json"],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
      [/\b(?:true|false|null)\b/, "keyword"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/[{}[\]]/, "delimiter.bracket"],
      [/[,:]/, "delimiter"],
    ],
    comment: [
      [/[^*/]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[*/]/, "comment"],
    ],
  },
});

/** Builds the theme from the design tokens as they resolve now, so call it after the page's theme changed. */
export function applyEditorTheme(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const name = dark ? "grove-dark" : "grove-light";
  monaco.editor.defineTheme(name, editorTheme((t) => css.getPropertyValue(t), dark));
  monaco.editor.setTheme(name);
}

/** Monaco's language id for a path, from registered extensions and file names. */
export function languageFor(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const langs = monaco.languages.getLanguages();
  for (const l of langs) if (l.filenames?.some((f) => f.toLowerCase() === name)) return l.id;
  let best = "";
  let bestId = "plaintext";
  for (const l of langs) {
    for (const ext of l.extensions ?? []) {
      const e = ext.toLowerCase();
      if (name.endsWith(e) && e.length > best.length) {
        best = e;
        bestId = l.id;
      }
    }
  }
  if (bestId === "plaintext" && (name === "dockerfile" || name.startsWith("dockerfile."))) return "dockerfile";
  return bestId;
}

export { monaco };
