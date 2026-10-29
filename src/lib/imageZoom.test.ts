import { describe, expect, it } from "vitest";
import { anchoredScroll, fitScale, formatZoom, MAX_PIXELS, stepZoom, tooManyPixels, ZOOM_LEVELS } from "./imageZoom";

describe("fitScale", () => {
  it("shrinks a large image to fit the view, and never enlarges a small one", () => {
    expect(fitScale(2000, 1000, 1000, 1000)).toBe(0.5);
    expect(fitScale(1000, 4000, 1000, 1000)).toBe(0.25);
    expect(fitScale(16, 16, 1000, 800)).toBe(1);
  });

  it("copes with empty images and views", () => {
    expect(fitScale(0, 0, 100, 100)).toBe(1);
    expect(fitScale(100, 100, 0, 0)).toBe(1);
  });
});

describe("stepZoom", () => {
  it("moves to the next level up or down from any scale", () => {
    expect(stepZoom(1, 1)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1) + 1]);
    expect(stepZoom(1, -1)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1) - 1]);
    // From a fitted scale between levels, the nearest level in that direction.
    expect(stepZoom(0.37, 1)).toBe(0.5);
    expect(stepZoom(0.37, -1)).toBe(0.25);
  });

  it("stops at the smallest and largest level", () => {
    const [lo, hi] = [ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]];
    expect(stepZoom(lo, -1)).toBe(lo);
    expect(stepZoom(hi, 1)).toBe(hi);
    expect(stepZoom(lo / 10, -1)).toBe(lo);
  });
});

describe("anchoredScroll", () => {
  it("keeps the point under the pointer in place while zooming", () => {
    // Pointer 100px into the view, scrolled 300px: image point 400 at scale 1 is 800 at scale 2.
    expect(anchoredScroll(300, 100, 1, 2)).toBe(700);
    expect(anchoredScroll(700, 100, 2, 1)).toBe(300);
    expect(anchoredScroll(0, 50, 1, 0.5)).toBe(0);
  });
});

it("formats zoom as a percentage", () => {
  expect(formatZoom(1)).toBe("100%");
  expect(formatZoom(0.3333)).toBe("33%");
  expect(formatZoom(12)).toBe("1200%");
});

it("refuses images whose decoded pixels would take too much memory", () => {
  expect(tooManyPixels(8000, 8000)).toBe(false);
  expect(tooManyPixels(20000, 20000)).toBe(true);
  expect(tooManyPixels(MAX_PIXELS, 1)).toBe(false);
  expect(tooManyPixels(MAX_PIXELS + 1, 1)).toBe(true);
});
