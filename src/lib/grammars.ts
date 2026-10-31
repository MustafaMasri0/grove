// TextMate grammars for the common languages, as Monaco tokens provider. Monaco's built-in Monarch
// tokenizers call most names `identifier`; these tell functions, types, macros and JSX apart.
// A grammar resolves each piece of code to a role (see SYNTAX_ROLES), never to a colour: the editor
// theme colours the roles from the design tokens, so changing theme needs no new tokenizing.
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { EncodedTokenMetadata, INITIAL, type StateStack } from "shiki/textmate";

/** What a piece of code is, by TextMate scope. A more specific scope wins, as in a VS Code theme. */
const ROLE_SCOPES = {
  comment: ["comment", "punctuation.definition.comment", "string.quoted.docstring"],
  string: ["string", "punctuation.definition.string", "property.value.dotenv"],
  keyword: ["keyword", "storage", "variable.language", "entity.name.tag", "keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical.python"],
  function: ["entity.name.function", "support.function", "variable.function", "entity.other.attribute-name.class.css", "entity.other.attribute-name.id.css", "entity.other.attribute-name.pseudo-class.css"],
  type: ["entity.name.type", "entity.name.class", "entity.other.inherited-class", "support.type", "support.class", "entity.name.scope-resolution", "entity.name.namespace", "entity.name.lifetime"],
  constant: ["constant", "variable.other.enummember", "support.constant", "keyword.other.unit", "string.regexp constant"],
  macro: ["entity.name.function.macro", "entity.name.function.preprocessor", "support.macro", "support.function.macro", "meta.attribute", "meta.decorator", "entity.name.function.decorator", "punctuation.definition.attribute", "punctuation.definition.decorator", "string.regexp", "constant.character.escape", "keyword.operator.regexp", "punctuation.section.embedded"],
  property: ["variable.other.property", "variable.other.object.property", "support.type.property-name", "meta.object-literal.key", "entity.other.attribute-name", "entity.name.tag.yaml", "variable.key.dotenv"],
  delimiter: ["punctuation", "keyword.operator", "meta.brace", "storage.type.function.arrow"],
} as const;

export type SyntaxRole = keyof typeof ROLE_SCOPES;
export const SYNTAX_ROLES = Object.keys(ROLE_SCOPES) as SyntaxRole[];

/** Monaco's language id to its grammar. Each grammar is its own file, fetched when a file needs it. */
const GRAMMARS: Record<string, () => Promise<{ default: Parameters<HighlighterCore["loadLanguage"]>[0] }>> = {
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  dotenv: () => import("shiki/langs/dotenv.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  shell: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};
const GRAMMAR_NAMES: Record<string, string> = { json: "jsonc", shell: "shellscript" };

export const GRAMMAR_LANGUAGES = Object.keys(GRAMMARS);

// The theme's colours are only labels for the roles, so that a token's metadata names its role.
const label = (i: number) => `#${(i + 1).toString(16).padStart(6, "0")}`;
const ROLE_OF_LABEL = new Map(SYNTAX_ROLES.map((role, i) => [label(i), role]));
const ROLES_THEME = {
  name: "roles",
  type: "dark" as const,
  fg: "#000000",
  bg: "#ffffff",
  settings: SYNTAX_ROLES.map((role, i) => ({ scope: [...ROLE_SCOPES[role]], settings: { foreground: label(i) } })),
};

// The JavaScript regex engine, as the app's script-src 'self' would refuse Shiki's WASM one.
let highlighter: Promise<HighlighterCore> | undefined;
const shared = () => (highlighter ??= createHighlighterCore({ themes: [ROLES_THEME], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }));

/** Longer lines are generated or minified: they stay plain, as a grammar could take seconds on them. */
const MAX_LINE = 20000;
const LINE_BUDGET_MS = 500;

class GrammarState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return this;
  }
  equals(other: unknown) {
    return other instanceof GrammarState && other.stack.equals(this.stack);
  }
}

/** A Monaco tokens provider for one of GRAMMAR_LANGUAGES, whose tokens are SyntaxRoles. */
export async function grammarTokenizer(language: string) {
  const hl = await shared();
  await hl.loadLanguage((await GRAMMARS[language]()).default);
  const grammar = hl.getLanguage(GRAMMAR_NAMES[language] ?? language);
  const { colorMap } = hl.setTheme("roles");
  const roleOf = (metadata: number) => ROLE_OF_LABEL.get(colorMap[EncodedTokenMetadata.getForeground(metadata)]?.toLowerCase()) ?? "";

  return {
    getInitialState: () => new GrammarState(INITIAL),
    tokenize(line: string, state: GrammarState) {
      if (line.length > MAX_LINE) return { endState: state, tokens: [{ startIndex: 0, scopes: "" }] };
      const { tokens: encoded, ruleStack } = grammar.tokenizeLine2(line, state.stack, LINE_BUDGET_MS);
      const tokens: { startIndex: number; scopes: string }[] = [];
      for (let i = 0; i < encoded.length; i += 2) {
        const scopes = roleOf(encoded[i + 1]);
        if (tokens.at(-1)?.scopes !== scopes) tokens.push({ startIndex: encoded[i], scopes });
      }
      return { endState: new GrammarState(ruleStack), tokens };
    },
  };
}
