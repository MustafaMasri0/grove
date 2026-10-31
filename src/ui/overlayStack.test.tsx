import { afterEach, describe, expect, test } from "vitest";
import { filterPicker } from "./Picker";
import { entriesFrom, entriesOutside, isModalOpen, pushEntry, removeEntry, topEntry, transientEntries, watchStack, type OverlayEntry } from "./overlayStack";

const entry = (kind: string, o: Partial<OverlayEntry> = {}): OverlayEntry => ({ kind, el: null, returnFocus: null, close() {}, ...o });
const open: OverlayEntry[] = [];
const push = (e: OverlayEntry) => {
  open.push(e);
  pushEntry(e);
  return e;
};

afterEach(() => open.splice(0).forEach(removeEntry));

describe("the stack", () => {
  test("the last opened is on top", () => {
    push(entry("picker"));
    const menu = push(entry("menu"));
    expect(topEntry()).toBe(menu);
  });
  test("closing an entry takes what was opened over it, topmost first", () => {
    const p = push(entry("picker"));
    const m = push(entry("menu"));
    expect(entriesFrom(p)).toEqual([m, p]);
  });
  test("an entry already gone closes nothing", () => expect(entriesFrom(entry("x"))).toEqual([]));
  test("a removed entry leaves the stack", () => {
    const p = push(entry("picker"));
    removeEntry(p);
    expect(topEntry()).toBeUndefined();
  });
  test("watchers hear changes until they stop", () => {
    let n = 0;
    const stop = watchStack(() => n++);
    const p = push(entry("a"));
    removeEntry(p);
    stop();
    push(entry("b"));
    expect(n).toBe(2);
  });
});

describe("outside presses", () => {
  test("close from the top down to the entry pressed", () => {
    const p = push(entry("picker"));
    const m = push(entry("menu"));
    expect(entriesOutside((e) => e === p)).toEqual([m]);
  });
  test("stop at a modal", () => {
    push(entry("quick-open", { modal: true }));
    const m = push(entry("menu"));
    expect(entriesOutside(() => false)).toEqual([m]);
    expect(isModalOpen()).toBe(true);
  });
});

describe("transient entries", () => {
  test("are only the ones on top", () => {
    push(entry("menu", { transient: true }));
    const p = push(entry("picker"));
    const m = push(entry("menu", { transient: true }));
    expect(transientEntries()).toEqual([m]);
    removeEntry(m);
    removeEntry(p);
    expect(transientEntries()).toHaveLength(1);
  });
});

describe("filterPicker", () => {
  const items = [{ key: "main", label: "main" }, { key: "a", label: <b>x</b>, search: "agent x" }, { key: "c", label: <b>y</b> }];
  test("no filter keeps everything", () => expect(filterPicker(items, " ")).toHaveLength(3));
  test("matches the search text, without regard to case", () => expect(filterPicker(items, "AGENT").map((i) => i.key)).toEqual(["a"]));
  test("a label that is not text needs search text", () => expect(filterPicker(items, "y")).toEqual([]));
  test("free offers the text itself first", () => expect(filterPicker(items, "dev", true)[0]).toEqual({ key: "dev", label: "Use “dev”" }));
  test("free does not offer an existing item", () => expect(filterPicker(items, "main", true).map((i) => i.key)).toEqual(["main"]));
});
