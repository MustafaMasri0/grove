// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { linkTarget, PREVIEW_CSP, prepareHtml, previewCsp } from "./htmlPreview";

const BASE = "http://wvfile.localhost/tok123/";
const prep = (html: string, path = "site/pages/index.html") => {
  const out = prepareHtml(html, path, BASE, "n1");
  return { out, doc: new DOMParser().parseFromString(out, "text/html") };
};

describe("prepareHtml", () => {
  it("starts with a strict content security policy before anything else", () => {
    const { out, doc } = prep("<html><head><link rel=stylesheet href=a.css><title>T</title></head><body>x</body></html>");
    expect(out.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    const first = doc.head.firstElementChild!;
    expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(first.getAttribute("content")).toBe(PREVIEW_CSP);
    for (const d of ["default-src 'none'", "script-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
      expect(PREVIEW_CSP).toContain(d);
    }
    expect(PREVIEW_CSP).not.toMatch(/https?:\/\/(?!wvfile\.localhost)/);
  });

  it("removes scripts, frames, plugins, base, meta refresh and prefetching", () => {
    const { doc } = prep(`<head>
      <base href="https://evil.example/">
      <meta http-equiv="refresh" content="0;url=https://evil.example">
      <link rel="preconnect" href="https://evil.example"><link rel="dns-prefetch" href="//evil.example">
      <link rel="prefetch" href="https://evil.example/x"><link rel="preload" href="x.png" as="image">
      <link rel="modulepreload" href="m.js"><link rel="icon" href="https://evil.example/i.png">
      <script src="https://unpkg.com/react.js"></script><script>alert(1)</script>
      </head><body onload="alert(1)">
      <iframe src="https://evil.example"></iframe><object data="x.swf"></object>
      <embed src="x.swf"><portal src="https://evil.example"></portal>
      <img src="a.png" onerror="alert(1)"><svg><script>alert(1)</script></svg>
      <frame src="x.html"></body>`);
    expect(doc.querySelectorAll("script, iframe, frame, object, embed, portal, base").length).toBe(0);
    expect(doc.querySelectorAll("meta[http-equiv]").length).toBe(1); // only the policy
    expect(doc.querySelectorAll("link").length).toBe(0);
    expect(doc.body.hasAttribute("onload")).toBe(false);
    expect(doc.querySelector("img")!.hasAttribute("onerror")).toBe(false);
  });

  it("points relative images and stylesheets at the same revision in the repository", () => {
    const { doc } = prep(`<link rel="stylesheet" href="../styles.css">
      <img src="img/a b.png"><img src="/logo.svg"><img src="data:image/png;base64,AAAA">
      <img srcset="s.png 1x, ../l.png 2x"><picture><source srcset="w.webp"></picture>
      <svg><image href="i.png"></image><use href="sprite.svg#a"></use></svg>`);
    expect(doc.querySelector("link")!.getAttribute("href")).toBe(`${BASE}site/styles.css`);
    const imgs = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? i.getAttribute("srcset"));
    expect(imgs).toEqual([`${BASE}site/pages/img/a%20b.png`, `${BASE}logo.svg`, "data:image/png;base64,AAAA", `${BASE}site/pages/s.png 1x, ${BASE}site/l.png 2x`]);
    expect(doc.querySelector("source")!.getAttribute("srcset")).toBe(`${BASE}site/pages/w.webp`);
    expect(doc.querySelector("image")!.getAttribute("href")).toBe(`${BASE}site/pages/i.png`);
    expect(doc.querySelector("use")!.getAttribute("href")).toBe(`${BASE}site/pages/sprite.svg#a`);
  });

  it("drops resources on the web or above the repository, so nothing is fetched from the network", () => {
    const { doc } = prep(`<link rel="stylesheet" href="https://cdn.example/x.css">
      <img src="https://evil.example/t.gif"><img src="//evil.example/t.gif"><img src="../../../../up.png">
      <img src="http://wvfile.localhost/othertoken/x.png"><img src="file:///C:/x.png">
      <img srcset="ok.png 1x, https://evil.example/x.png 2x"><video src="v.mp4" poster="https://evil.example/p.png"></video>`);
    expect(doc.querySelectorAll("link").length).toBe(0);
    const srcs = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(doc.querySelectorAll("img")[5].getAttribute("srcset")).toBe(`${BASE}site/pages/ok.png 1x`);
    const v = doc.querySelector("video")!;
    expect(v.hasAttribute("src") || v.hasAttribute("poster")).toBe(false);
  });

  it("rewrites url() and @import in style elements and attributes", () => {
    const { doc } = prep(`<style>@import "base.css"; @import url('https://cdn.example/f.css');
      body { background: url(bg.png) } .a { background-image: url("https://evil.example/x.png") }
      @font-face { src: url(../fonts/f.woff2) format("woff2"), url(data:font/woff2;base64,AA) }</style>
      <div style="background:url('tile.png')"></div>`);
    const css = doc.querySelector("style")!.textContent!;
    expect(css).toContain(`@import "${BASE}site/pages/base.css"`);
    expect(css).toContain(`url("${BASE}site/pages/bg.png")`);
    expect(css).toContain(`url("${BASE}site/fonts/f.woff2")`);
    expect(css).toContain("url(data:font/woff2;base64,AA)");
    expect(css).not.toContain("evil.example");
    expect(css).not.toContain("cdn.example");
    expect(doc.querySelector("div")!.getAttribute("style")).toBe(`background:url("${BASE}site/pages/tile.png")`);
  });

  it("sends every link to the app instead of navigating the preview", () => {
    const { doc } = prep(`<a href="other.html#top" target="_blank" ping="https://evil.example">o</a>
      <a href="https://example.com/a?b=1">w</a><a href="#section">s</a><a href="javascript:alert(1)">j</a>
      <a href="../../../../x.html">up</a><map><area href="../a.md"></map><svg><a href="b.html"><text>t</text></a></svg>
      <form action="https://evil.example"><button formaction="https://evil.example">b</button></form>`);
    const a = [...doc.querySelectorAll("a")];
    expect(a[0].getAttribute("href")).toBe("http://wvfile.localhost/~link?n=n1&open=site%2Fpages%2Fother.html");
    expect(a[0].hasAttribute("target") || a[0].hasAttribute("ping")).toBe(false);
    expect(a[1].getAttribute("href")).toBe(`http://wvfile.localhost/~link?n=n1&url=${encodeURIComponent("https://example.com/a?b=1")}`);
    expect(a[2].getAttribute("href")).toBe("#section");
    expect(a[3].hasAttribute("href")).toBe(false);
    expect(a[4].hasAttribute("href")).toBe(false);
    expect(doc.querySelector("area")!.getAttribute("href")).toBe("http://wvfile.localhost/~link?n=n1&open=site%2Fa.md");
    expect(a[5].getAttribute("href")).toBe("http://wvfile.localhost/~link?n=n1&open=site%2Fpages%2Fb.html");
    expect(doc.querySelector("form")!.hasAttribute("action")).toBe(false);
    expect(doc.querySelector("button")!.hasAttribute("formaction")).toBe(false);
  });

  it("keeps the page itself: text, inline styles and structure", () => {
    const { doc } = prep(`<!doctype html><html lang="en"><head><title>Hi</title><style>p{color:red}</style></head><body><h1 class="t">Hello</h1><p>World</p></body></html>`);
    expect(doc.title).toBe("Hi");
    expect(doc.documentElement.getAttribute("lang")).toBe("en");
    expect(doc.querySelector("h1.t")!.textContent).toBe("Hello");
    expect(doc.querySelector("style")!.textContent).toBe("p{color:red}");
  });
});

describe("linkTarget", () => {
  it("reads back where a clicked link goes", () => {
    expect(linkTarget("n=n1&open=site%2Fa%20b.html", "n1")).toEqual({ kind: "repo", path: "site/a b.html" });
    expect(linkTarget(`n=n1&url=${encodeURIComponent("https://example.com/?q=1")}`, "n1")).toEqual({ kind: "external", url: "https://example.com/?q=1" });
    // Only web and mail links leave the app.
    expect(linkTarget(`n=n1&url=${encodeURIComponent("file:///C:/x")}`, "n1")).toBeNull();
    expect(linkTarget("", "n1")).toBeNull();
  });

  it("ignores link requests that did not come from the page's own links", () => {
    // A stylesheet from the repository is not rewritten and could name the link URL itself.
    expect(linkTarget(`url=${encodeURIComponent("https://evil.example")}`, "n1")).toBeNull();
    expect(linkTarget(`n=n2&open=a.html`, "n1")).toBeNull();
    expect(linkTarget(`n=&open=a.html`, "")).toBeNull();
  });
});

describe("prepareHtml with scripts on", () => {
  const run = (html: string, path = "site/pages/index.html") => {
    const out = prepareHtml(html, path, BASE, "n1", true);
    return { out, doc: new DOMParser().parseFromString(out, "text/html") };
  };

  it("lets the page's own scripts run: inline, and from the repository at the same revision", () => {
    const { doc } = run(`<head><script>window.x = 1</script><script src="../app.js"></script>
      <script type="module" src="/lib/m.js"></script></head><body onload="init()"><button onclick="go()">b</button></body>`);
    const s = [...doc.querySelectorAll("script")];
    expect(s.map((e) => e.getAttribute("src"))).toEqual([null, `${BASE}site/app.js`, `${BASE}lib/m.js`]);
    expect(s[0].textContent).toBe("window.x = 1");
    expect(doc.body.getAttribute("onload")).toBe("init()");
    expect(doc.querySelector("button")!.getAttribute("onclick")).toBe("go()");
  });

  it("still loads nothing from the web, and keeps frames, base and refresh out", () => {
    const { doc } = run(`<head><script src="https://cdn.example/react.js"></script><script src="//cdn.example/x.js"></script>
      <base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"></head>
      <body><iframe src="x.html"></iframe><a href="javascript:steal()">j</a></body>`);
    expect(doc.querySelectorAll("script, iframe, base").length).toBe(0);
    expect(doc.querySelectorAll("meta[http-equiv]").length).toBe(1);
    expect(doc.querySelector("a")!.hasAttribute("href")).toBe(false);
  });

  it("allows scripts from the repository and inline, and still no network", () => {
    const csp = previewCsp(true);
    expect(csp).toContain(`script-src http://wvfile.localhost 'unsafe-inline' 'unsafe-eval'`);
    for (const d of ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "worker-src 'none'"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/https?:\/\/(?!wvfile\.localhost)/);
    expect(previewCsp(false)).toBe(PREVIEW_CSP);
    const { doc } = run("<p>x</p>");
    expect(doc.head.firstElementChild!.getAttribute("content")).toBe(csp);
  });
});
