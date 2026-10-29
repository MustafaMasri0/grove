import { describe, expect, it } from "vitest";
import { avatarHue, createAvatarLoader, initials } from "./avatar";

describe("initials", () => {
  it("takes the first letters of the first and last name", () => {
    expect(initials("Ada Lovelace", "ada@example.com")).toBe("AL");
    expect(initials("Grace Brewster Murray Hopper", "")).toBe("GH");
  });

  it("uses one letter for a single name", () => {
    expect(initials("linus", "")).toBe("L");
  });

  it("skips punctuation and handles non-Latin letters", () => {
    expect(initials("  (bot) renovate[bot] ", "")).toBe("BR");
    expect(initials("Élodie Ørsted", "")).toBe("ÉØ");
  });

  it("falls back to the email, then to a question mark", () => {
    expect(initials("", "j.doe@example.com")).toBe("J");
    expect(initials("", "")).toBe("?");
  });
});

describe("avatarHue", () => {
  it("is stable for the same author whatever the case or spaces", () => {
    expect(avatarHue(" Ada@Example.com ")).toBe(avatarHue("ada@example.com"));
  });

  it("is a hue in degrees", () => {
    for (const e of ["a@b.c", "x@y.z", "someone@else.org"]) {
      const h = avatarHue(e);
      expect(Number.isInteger(h) && h >= 0 && h < 360).toBe(true);
    }
  });

  it("tells different authors apart", () => {
    const hues = new Set(["a@x.org", "b@x.org", "c@x.org", "d@x.org", "e@x.org"].map(avatarHue));
    expect(hues.size).toBeGreaterThan(2);
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createAvatarLoader", () => {
  it("asks once per author, whatever the case of the email", async () => {
    const calls: string[] = [];
    const load = createAvatarLoader(async (e) => {
      calls.push(e);
      return `data:${e}`;
    }, 4);
    const [a, b] = await Promise.all([load("Ada@Example.com"), load("ada@example.com")]);
    expect(a).toBe("data:ada@example.com");
    expect(b).toBe(a);
    expect(await load(" ADA@example.com")).toBe(a);
    expect(calls).toEqual(["ada@example.com"]);
  });

  it("remembers authors without a picture and failed lookups as null", async () => {
    let n = 0;
    const load = createAvatarLoader(async (e) => {
      n++;
      if (e.startsWith("err")) throw new Error("offline");
      return null;
    }, 4);
    expect(await load("none@x.org")).toBeNull();
    expect(await load("err@x.org")).toBeNull();
    expect(await load("none@x.org")).toBeNull();
    expect(n).toBe(2);
  });

  it("returns what it already knows without waiting", async () => {
    const load = createAvatarLoader(async () => "data:x", 4);
    expect(load.peek("a@x.org")).toBeUndefined();
    await load("a@x.org");
    expect(load.peek("A@x.org")).toBe("data:x");
  });

  it("runs at most the given number of lookups at once", async () => {
    let running = 0;
    let most = 0;
    const release: (() => void)[] = [];
    const load = createAvatarLoader(
      (e) =>
        new Promise<string>((resolve) => {
          running++;
          most = Math.max(most, running);
          release.push(() => {
            running--;
            resolve(e);
          });
        }),
      2,
    );
    const all = Promise.all(["a", "b", "c", "d", "e"].map((x) => load(`${x}@x.org`)));
    await tick();
    expect(running).toBe(2);
    while (release.length) {
      release.shift()!();
      await tick();
    }
    await all;
    expect(most).toBe(2);
  });

  it("passes the first caller's hint (repository and commit) to the lookup", async () => {
    const seen: unknown[] = [];
    const load = createAvatarLoader<{ sha: string }>(async (_e, hint) => {
      seen.push(hint);
      return "x";
    }, 4);
    await Promise.all([load("a@x.org", { sha: "111" }), load("a@x.org", { sha: "222" })]);
    await load("b@x.org");
    expect(seen).toEqual([{ sha: "111" }, undefined]);
  });

  it("does not look up an empty email", async () => {
    let n = 0;
    const load = createAvatarLoader(async () => {
      n++;
      return "x";
    }, 4);
    expect(await load("  ")).toBeNull();
    expect(n).toBe(0);
  });
});
