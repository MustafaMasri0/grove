import { describe, expect, it } from "vitest";
import { coalesce } from "./coalesce";

describe("coalesce", () => {
  it("runs once more after the running call, however many calls came meanwhile", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const load = coalesce(async () => {
      runs++;
      if (runs === 1) await new Promise<void>((r) => (release = r));
    });
    const first = load();
    const second = load();
    void load();
    expect(second).toBe(first);
    release();
    await first;
    expect(runs).toBe(2);
  });

  it("starts afresh once idle, also after a failed run", async () => {
    let runs = 0;
    const load = coalesce(async () => {
      if (++runs === 1) throw new Error("boom");
    });
    await expect(load()).rejects.toThrow("boom");
    await load();
    expect(runs).toBe(2);
  });
});
