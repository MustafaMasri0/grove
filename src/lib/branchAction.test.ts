import { describe, expect, it } from "vitest";
import type { BranchStatus } from "../api";
import { branchAction } from "./branchAction";

const bs = (o: Partial<BranchStatus> = {}): BranchStatus => ({ branch: "agent/one", upstream: "origin/agent/one", upstreamGone: false, ahead: 0, behind: 0, hasOrigin: true, lastFetched: null, ...o });

describe("branchAction", () => {
  it("fetches an up-to-date branch", () => {
    expect(branchAction(bs(), false, 0)).toMatchObject({ kind: "fetch", label: "Fetch origin", caption: "Never fetched", blocked: null });
  });

  it("pushes commits ahead, publishes without an upstream", () => {
    expect(branchAction(bs({ ahead: 2 }), false, 0)).toMatchObject({ kind: "push", label: "Push origin ↑2", icon: "arrow-up" });
    expect(branchAction(bs({ upstream: null }), false, 0)).toMatchObject({ kind: "publish", caption: "Push agent/one to origin" });
    expect(branchAction(bs({ upstreamGone: true }), false, 0).kind).toBe("publish");
  });

  it("says why a push is blocked", () => {
    expect(branchAction(bs({ behind: 1 }), false, 0)).toMatchObject({ kind: "fetch", blocked: "The branch is behind origin; there is nothing to push.", caption: "↓1 · Never fetched" });
    expect(branchAction(bs({ behind: 1, ahead: 2 }), false, 0).blocked).toMatch(/diverged/);
    expect(branchAction(bs({ hasOrigin: false }), false, 0).blocked).toBe("This repository has no remote named origin.");
    expect(branchAction(bs({ branch: "" }), false, 0).blocked).toMatch(/detached/);
    expect(branchAction(bs({ branch: "" }), true, 0).blocked).toBe("Remote branches cannot be pushed.");
    expect(branchAction(bs({ ahead: 1 }), true, 0).blocked).toMatch(/only available from a worktree/);
  });
});
