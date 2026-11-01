import { describe, expect, it } from "vitest";
import { GRAMMAR_LANGUAGES, grammarTokenizer } from "./grammars";

/** Each word of a line, with its role. */
async function rolesOf(language: string, ...lines: string[]) {
  const tokenizer = await grammarTokenizer(language);
  let state = tokenizer.getInitialState();
  const found: Record<string, string> = {};
  for (const line of lines) {
    const { tokens, endState } = tokenizer.tokenize(line, state);
    tokens.forEach((t, i) => {
      for (const word of line.slice(t.startIndex, tokens[i + 1]?.startIndex).match(/[\w!'-]+/g) ?? []) found[word] = t.scopes;
    });
    state = endState;
  }
  return found;
}

describe("grammars", () => {
  it("tells Rust's functions, types and macros from plain names", async () => {
    const r = await rolesOf("rust", 'pub fn open(path: &Path) -> Result { println!("hi"); path.len() }');
    expect(r).toMatchObject({ pub: "keyword", fn: "keyword", open: "function", Path: "type", Result: "type", "println!": "macro", hi: "string", len: "function" });
    expect(r.path).toBe("");
  });

  it("colours JSX in .tsx: components as types, tags as keywords, props as properties", async () => {
    const r = await rolesOf("tsx", 'const a = <section className="x"><Row key={k} /></section>;');
    expect(r).toMatchObject({ section: "keyword", className: "property", x: "string", Row: "type", key: "property" });
  });

  it("keeps worded operators as keywords, and symbols quiet", async () => {
    expect(await rolesOf("typescript", "const a = new Date(); typeof a;")).toMatchObject({ new: "keyword", typeof: "keyword" });
    expect(await rolesOf("python", "x = a and not b")).toMatchObject({ and: "keyword", not: "keyword" });
    const t = await grammarTokenizer("typescript");
    expect(t.tokenize("a = b", t.getInitialState()).tokens.map((x) => x.scopes)).toContain("delimiter");
  });

  it("leaves a local const a plain name", async () => expect((await rolesOf("typescript", "const shown = 1;")).shown).toBe(""));

  it("carries a block comment over lines", async () => {
    expect(await rolesOf("typescript", "/* one", "two */ const")).toMatchObject({ one: "comment", two: "comment", const: "keyword" });
  });

  it("reads JSON with comments", async () => {
    expect(await rolesOf("json", '{ "name": true } // note')).toMatchObject({ name: "property", true: "constant", note: "comment" });
  });

  it("tells a .env file's keys, values and comments apart", async () => {
    expect(await rolesOf("dotenv", "# note", "export API_URL=example", 'NAME="quoted"', "PORT=3000")).toMatchObject({
      note: "comment",
      export: "keyword",
      API_URL: "property",
      example: "string",
      NAME: "property",
      quoted: "string",
      PORT: "property",
      "3000": "constant",
    });
  });

  it("tells a line's end state by its content, so an unchanged line stops Monaco's re-tokenizing", async () => {
    const t = await grammarTokenizer("typescript");
    const end = (text: string) => t.tokenize(text, t.getInitialState()).endState;
    expect(end("const a = 1;").equals(end("const b = 2;"))).toBe(true);
    expect(end("/* open").equals(end("const a = 1;"))).toBe(false);
  });

  it("leaves a huge line plain, keeping the state", async () => {
    const t = await grammarTokenizer("typescript");
    const state = t.getInitialState();
    expect(t.tokenize("x".repeat(20001), state)).toEqual({ endState: state, tokens: [{ startIndex: 0, scopes: "" }] });
  });

  it.each(GRAMMAR_LANGUAGES)("loads the %s grammar", async (language) => {
    const t = await grammarTokenizer(language);
    expect(t.tokenize("a", t.getInitialState()).tokens.length).toBeGreaterThan(0);
  });
});
