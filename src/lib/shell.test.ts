import { describe, expect, it } from "vitest";
import { bandOf, clampRail, commitInList, isNarrow } from "./shell";

describe("shell bands", () => {
  it("splits at 800, 1100 and 1500", () => {
    expect([799, 800, 1099, 1100, 1499, 1500].map(bandOf)).toEqual(["s", "m", "m", "l", "l", "xl"]);
  });

  it("drawers the list below 1100 and moves the commit into it below 1300", () => {
    expect([isNarrow(1099), isNarrow(1100)]).toEqual([true, false]);
    expect([commitInList(1299), commitInList(1300)]).toEqual([true, false]);
  });

  it("keeps the rail between 220 and 420 in whole pixels", () => {
    expect([clampRail(100), clampRail(300.4), clampRail(900)]).toEqual([220, 300, 420]);
  });
});
