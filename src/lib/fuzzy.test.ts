import { describe, expect, it } from "vitest";
import { fuzzyMatch, quickOpen } from "./fuzzy";

const files = [
  "apps/orbit-backend/src/server.ts",
  "apps/orbit-backend/src/services/user-service.ts",
  "apps/orbit-admin/src/App.tsx",
  "packages/ui/src/Button.tsx",
  "README.md",
  "docs/server-setup.md",
];

describe("fuzzyMatch", () => {
  it("matches a subsequence case-insensitively and reports positions", () => {
    const m = fuzzyMatch("srvts", "apps/orbit-backend/src/server.ts");
    expect(m).not.toBeNull();
    expect(m!.positions.length).toBe(5);
  });

  it("rejects when characters are missing", () => {
    expect(fuzzyMatch("xyz", "README.md")).toBeNull();
  });

  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "a/b.ts")).not.toBeNull();
  });
});

describe("quickOpen", () => {
  it("ranks file-name matches above path-only matches", () => {
    const r = quickOpen("server", files).map((x) => x.path);
    expect(r[0]).toBe("apps/orbit-backend/src/server.ts");
    expect(r).toContain("docs/server-setup.md");
  });

  it("prefers contiguous and word-start matches", () => {
    const r = quickOpen("button", files).map((x) => x.path);
    expect(r[0]).toBe("packages/ui/src/Button.tsx");
  });

  it("space-separated terms must all match", () => {
    const r = quickOpen("backend service", files).map((x) => x.path);
    expect(r).toEqual(["apps/orbit-backend/src/services/user-service.ts"]);
  });

  it("limits the result count", () => {
    expect(quickOpen("", files, 2).length).toBe(2);
  });

  it("backslashes in the query act like slashes", () => {
    const r = quickOpen("ui\\src", files).map((x) => x.path);
    expect(r[0]).toBe("packages/ui/src/Button.tsx");
  });
});
