import { describe, expect, it } from "vitest";
import { isMenuKey, nextEnabled, placeMenu, type MenuItem } from "./menu";

const view = { width: 1000, height: 700 };
const size = { width: 200, height: 150 };

describe("placeMenu", () => {
  it("opens below and to the right of the point when there is room", () => {
    expect(placeMenu({ x: 100, y: 80 }, size, view)).toEqual({ left: 100, top: 80 });
  });

  it("flips to the left of the point near the right edge", () => {
    expect(placeMenu({ x: 950, y: 80 }, size, view)).toEqual({ left: 750, top: 80 });
  });

  it("ends at the right edge of the element it opens under near the right edge", () => {
    expect(placeMenu({ x: 900, y: 80 }, size, view, undefined, 960)).toEqual({ left: 760, top: 80 });
  });

  it("flips above the point near the bottom edge", () => {
    expect(placeMenu({ x: 100, y: 650 }, size, view)).toEqual({ left: 100, top: 500 });
  });

  it("keeps a margin from the edges when flipping is not enough", () => {
    // Too tall to fit above or below the point: pinned inside the window.
    expect(placeMenu({ x: 100, y: 300 }, { width: 200, height: 690 }, view)).toEqual({ left: 100, top: 4 });
    expect(placeMenu({ x: 150, y: 80 }, { width: 300, height: 100 }, { width: 320, height: 700 })).toEqual({ left: 4, top: 80 });
  });

  it("flips above the row it was opened for, not over it", () => {
    // Opened from the keyboard under a row at y 620..644: flipping up clears the row's top.
    expect(placeMenu({ x: 100, y: 644 }, size, view, 620)).toEqual({ left: 100, top: 470 });
  });

  it("never goes off the top-left corner", () => {
    expect(placeMenu({ x: -20, y: -20 }, size, view)).toEqual({ left: 4, top: 4 });
  });
});

describe("nextEnabled", () => {
  const items: MenuItem[] = [
    { label: "A", run: () => {} },
    { separator: true },
    { label: "B", run: () => {}, disabled: true },
    { label: "C", run: () => {} },
  ];

  it("skips separators and disabled items", () => {
    expect(nextEnabled(items, 0, 1)).toBe(3);
    expect(nextEnabled(items, 3, -1)).toBe(0);
  });

  it("wraps around", () => {
    expect(nextEnabled(items, 3, 1)).toBe(0);
    expect(nextEnabled(items, 0, -1)).toBe(3);
  });

  it("starts from nothing selected", () => {
    expect(nextEnabled(items, -1, 1)).toBe(0);
    expect(nextEnabled(items, -1, -1)).toBe(3);
  });

  it("returns -1 when nothing can be chosen", () => {
    expect(nextEnabled([{ separator: true }, { label: "x", run: () => {}, disabled: true }], -1, 1)).toBe(-1);
  });
});

describe("isMenuKey", () => {
  const k = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  it("is the Menu key or Shift+F10", () => {
    expect(isMenuKey(k("ContextMenu"))).toBe(true);
    expect(isMenuKey(k("F10", { shiftKey: true }))).toBe(true);
  });
  it("is not plain F10 or Ctrl+Shift+F10", () => {
    expect(isMenuKey(k("F10"))).toBe(false);
    expect(isMenuKey(k("F10", { shiftKey: true, ctrlKey: true }))).toBe(false);
  });
});
