import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { loginReader } from "./issueLogins";

vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: { issueTracker: vi.fn(), issueLogins: vi.fn() },
}));

const github = { name: "GitHub", project: "example-org/example", webUrl: "https://github.com/example-org/example/issues" };
const logins = { accounts: ["octo", "work-login"], default: "octo", fixedBy: null };

describe("loginReader", () => {
  it("reads each tracker's logins once, and nothing for repositories without a tracker", async () => {
    vi.mocked(api.issueTracker).mockImplementation(async ({ repo }) => {
      if (repo === "none") throw { kind: "noOrigin" };
      return github;
    });
    vi.mocked(api.issueLogins).mockResolvedValue(logins);
    const read = loginReader();
    const [a, b, none] = await Promise.all([read({ repo: "a", cwd: "/a" }), read({ repo: "b", cwd: "/b" }), read({ repo: "none", cwd: "/n" })]);
    expect(a).toEqual({ tracker: github, logins });
    expect(b).toEqual(a);
    expect(none).toBeNull();
    expect(api.issueLogins).toHaveBeenCalledTimes(1);
  });
});
