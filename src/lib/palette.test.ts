import { describe, expect, it } from "vitest";
import type { WorktreeSummary } from "../api";
import { PALETTE_LIMIT, paletteItems, type PaletteItem } from "./palette";
import type { RailRow } from "./rail";

const row = (name: string, branch: string, off: string | null = null) => ({ name, branch, off, worktree: { path: `/w/${name}` } }) as unknown as RailRow;
const summary = (name: string, ...paths: string[]) => ({ path: `/w/${name}`, uncommitted: paths.map((path) => ({ path, origPath: null, kind: "modified" })) }) as unknown as WorktreeSummary;
const labels = (items: PaletteItem[]) => items.map((i) => (i.kind === "command" ? i.command.label : i.kind === "worktree" ? i.row.name : `${i.row.name}:${i.file.path}`));

const rows = [row("agent-01", "agent/refund"), row("agent-02", "agent/rounding"), row("gone", "agent/old", "Missing")];
const summaries = [summary("agent-01", "src/refund.ts"), summary("agent-02", "src/refund.ts", "src/cart.ts"), summary("gone", "src/refund.ts")];

describe("paletteItems", () => {
  it("offers the commands and worktrees before anything is typed, and no files", () => {
    expect(labels(paletteItems("", rows, summaries))).toEqual(["Go to Overview", "Open Settings", "Show keyboard shortcuts", "agent-01", "agent-02"]);
  });

  it("finds a worktree by its branch", () => {
    expect(labels(paletteItems("rounding", rows, summaries))).toEqual(["agent-02"]);
  });

  it("finds a changed file in each worktree that changes it, ignoring case", () => {
    expect(labels(paletteItems("REFUND.ts", rows, summaries))).toEqual(["agent-01:src/refund.ts", "agent-02:src/refund.ts"]);
  });

  it("keeps the sections in order", () => {
    expect(paletteItems("o", rows, summaries).map((i) => i.section).filter((s, i, all) => s !== all[i - 1])).toEqual(["Commands", "Worktrees"]);
  });

  it("works with no repository: only the commands", () => {
    expect(labels(paletteItems("settings", [], []))).toEqual(["Open Settings"]);
  });

  it("stops at the limit", () => {
    const many = summary("agent-01", ...Array.from({ length: PALETTE_LIMIT * 2 }, (_, i) => `src/part-${i}.ts`));
    expect(paletteItems("part", rows, [many])).toHaveLength(PALETTE_LIMIT);
  });

  it("names the shortcuts section for its command", () => {
    const shortcuts = paletteItems("shortcuts", [], [])[0];
    expect(shortcuts.kind === "command" && "settings" in shortcuts.command && shortcuts.command.settings).toBe("shortcuts");
  });
});
