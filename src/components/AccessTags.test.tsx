import { renderToStaticMarkup as html } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AccessTags } from "./AccessTags";

describe("AccessTags", () => {
  test("an editable file says so, and that git does not track it", () => {
    const out = html(<AccessTags access={{ editable: true, reason: null, tracked: false }} />);
    expect(out).toContain("Editable");
    expect(out).toContain("Not in git");
  });

  test("an editable file git tracks warns that saving makes a change to commit", () => {
    const out = html(<AccessTags access={{ editable: true, reason: null, tracked: true }} />);
    expect(out).toContain("In git: changes will be committed");
    expect(out).toContain("badge warn");
  });

  test("a file the patterns name but Grove cannot edit gives the reason as a tip", () => {
    const out = html(<AccessTags access={{ editable: false, reason: "The file is not UTF-8 text.", tracked: false }} />);
    expect(out).toContain("Read-only");
    expect(out).toContain('data-tip="The file is not UTF-8 text."');
  });

  test("any other read-only file shows nothing", () => {
    expect(html(<AccessTags access={{ editable: false, reason: null, tracked: true }} />)).toBe("");
  });
});
