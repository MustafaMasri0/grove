// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Overview, type RepoInfo } from "./api";
import { useStore } from "./store";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: {
    worktrees: vi.fn(async () => []),
    worktreesOverview: vi.fn(),
    watch: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
  },
}));

const overview = (overlaps: Overview["overlaps"]): Overview => ({ worktrees: [], errors: {}, overlaps });
const answer = vi.mocked(api.worktreesOverview);
const askedForOverlaps = () => answer.mock.calls.map((c) => c[3]);

/** Lets the load the store just started finish. */
const settled = () => useStore.getState().loadOverview();

describe("the possibleConflicts setting", () => {
  beforeEach(() => {
    answer.mockReset();
    answer.mockResolvedValue(overview([]));
    const settings = { ...useStore.getInitialState().settings, possibleConflicts: true };
    useStore.setState({ repo: { id: "r", root: "/r" } as RepoInfo, settings, overview: null });
  });

  it("asks the backend for overlaps only while it is on", async () => {
    await useStore.getState().loadOverview();
    useStore.getState().updateSettings({ possibleConflicts: false });
    await settled();
    expect(askedForOverlaps().at(0)).toBe(true);
    expect(askedForOverlaps().slice(1).length).toBeGreaterThan(0);
    expect(askedForOverlaps().slice(1)).not.toContain(true);
  });

  it("forgets the overlaps at once when turned off", async () => {
    answer.mockResolvedValue(overview([{ a: "x", b: "y", files: ["f"] }]));
    await useStore.getState().loadOverview();
    answer.mockResolvedValue(overview([]));
    useStore.getState().updateSettings({ possibleConflicts: false });
    expect(useStore.getState().overview).toBeNull();
    await settled();
    expect(useStore.getState().overview?.overlaps).toEqual([]);
  });

  it("shows nothing of a load that was already running when it changed", async () => {
    let finishOld = (_: Overview) => {};
    let finishNew = (_: Overview) => {};
    answer.mockReturnValueOnce(new Promise((resolve) => (finishOld = resolve)));
    answer.mockReturnValueOnce(new Promise((resolve) => (finishNew = resolve)));
    const running = useStore.getState().loadOverview();
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(1));

    useStore.getState().updateSettings({ possibleConflicts: false });
    finishOld(overview([{ a: "x", b: "y", files: ["f"] }]));
    await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    expect(useStore.getState().overview).toBeNull();

    finishNew(overview([]));
    await running;
    expect(askedForOverlaps()).toEqual([true, false]);
    expect(useStore.getState().overview?.overlaps).toEqual([]);
  });

  it("leaves the overview alone when another setting changes", async () => {
    await useStore.getState().loadOverview();
    const before = useStore.getState().overview;
    useStore.getState().updateSettings({ showIgnored: true });
    expect(useStore.getState().overview).toBe(before);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
