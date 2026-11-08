// Monaco, bundled locally. Only the editor core, the diff editor and the
// features a viewer needs are imported (with line comments and line moves for
// the few files that can be edited), plus the lightweight
// tokenizers for every language, which lib/grammars.ts replaces for the common
// ones. The TypeScript/JSON/CSS/HTML language services (and their large
// workers) are left out on purpose: they add IntelliSense, not highlighting,
// and cost a lot of memory.
import * as monaco from "monaco-esm/editor/editor.api.js";
import "monaco-esm/editor/browser/coreCommands.js";
import "monaco-esm/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-esm/editor/browser/widget/diffEditor/diffEditor.contribution.js";
import "monaco-esm/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-esm/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-esm/editor/contrib/comment/browser/comment.js";
import "monaco-esm/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-esm/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-esm/features/find/register.js";
import "monaco-esm/editor/contrib/find/browser/findController.js";
import "monaco-esm/editor/contrib/folding/browser/folding.js";
import "monaco-esm/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-esm/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-esm/editor/contrib/linesOperations/browser/linesOperations.js";
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
import { GRAMMAR_LANGUAGES, grammarTokenizer } from "./lib/grammars";

// The diff computation runs in the editor worker; nothing else needs one.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Monaco ships no JSON language outside the JSON language service, and reads JSX as plain script.
monaco.languages.register({
  id: "json",
  extensions: [".json", ".jsonc", ".json5", ".jsonl", ".webmanifest", ".code-workspace", ".babelrc", ".eslintrc"],
  filenames: [".prettierrc", "composer.lock"],
  aliases: ["JSON", "json"],
});
monaco.languages.register({ id: "tsx", aliases: ["TSX", "tsx"] });
monaco.languages.register({ id: "jsx", aliases: ["JSX", "jsx"] });
monaco.languages.register({ id: "dotenv", extensions: [".env"], filenames: [".env"], aliases: ["dotenv", ".env"] });
monaco.languages.setLanguageConfiguration("dotenv", { comments: { lineComment: "#" } });
const CURLY_LANGUAGE: monaco.languages.LanguageConfiguration = {
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
};
for (const id of ["json", "tsx", "jsx"]) monaco.languages.setLanguageConfiguration(id, CURLY_LANGUAGE);

// Replaces Monarch for these languages; Markdown and the rarer ones stay on it.
for (const id of GRAMMAR_LANGUAGES) monaco.languages.registerTokensProviderFactory(id, { create: () => grammarTokenizer(id) });

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
  // Monaco's typescript and javascript claim these extensions too.
  if (name.endsWith(".tsx")) return "tsx";
  if (name.endsWith(".jsx")) return "jsx";
  if (name.startsWith(".env.")) return "dotenv";
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
