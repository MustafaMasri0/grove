import { describe, expect, it } from "vitest";
import { isImagePath, viewKind } from "./fileKinds";

describe("viewKind", () => {
  it("shows image files as pictures, whatever the case of the extension", () => {
    for (const p of ["a.png", "b/c.JPG", "x.jpeg", "y.gif", "z.webp", "i.svg", "f.ico", "w.bmp", "q.avif"]) {
      expect(viewKind(p), p).toBe("image");
      expect(isImagePath(p)).toBe(true);
    }
  });

  it("renders HTML and Markdown, and leaves everything else to the editor", () => {
    expect(viewKind("index.html")).toBe("html");
    expect(viewKind("docs/Page.HTM")).toBe("html");
    expect(viewKind("README.md")).toBe("markdown");
    expect(viewKind("notes.markdown")).toBe("markdown");
    for (const p of ["a.ts", "png", "x.png.txt", "Makefile", "style.css", "img.tiff", ".png/readme"]) {
      expect(viewKind(p), p).toBe("text");
      expect(isImagePath(p)).toBe(false);
    }
  });

  it("only SVG has a source worth reading", () => {
    expect(viewKind("a.svg")).toBe("image");
    expect(isImagePath("a.svg")).toBe(true);
  });
});
