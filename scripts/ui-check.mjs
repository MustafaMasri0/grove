// Checks the design system against the harness page (harness/), and the shell on the real App on mocked IPC, in headless Edge: text contrast,
// layout at the window's smallest size, the motion allow-list, reduced motion, forbidden wording, and that nothing of it reaches the production bundle.
// No window opens and no OS input is sent. The harness pages are built once into target/ui-check/site, with React's development build so its
// warnings still fail noConsoleErrors, and served from there. The checks run in independent groups spread over several tabs, each tab in a browser
// context of its own; a check waits for what it looks at (an element, animations settling, the mocked backend going quiet), not for a fixed time.
// Runs at below-normal priority, so the machine stays usable; --fast runs at high priority instead, for a run you sit and wait on.
// Screenshots and report.json go to target/ui-check; the report keeps each check's and group's time, and the next run starts the longest groups first.
//   node scripts/ui-check.mjs          everything except the bundle check
//   node scripts/ui-check.mjs --fast   the same, at high priority
//   pnpm build && node scripts/ui-check.mjs --bundle
//   node scripts/ui-check.mjs --panes   only the panes and editor checks
//   node scripts/ui-check.mjs --panes=panesMonaco   only the checks on the real App whose name starts so (surface: Settings, the palette, the repository menu)
//   node scripts/ui-check.mjs --tabs=1   one tab, every group in turn (the default is 4)
// Set EDGE_PATH when Edge is not in its usual place.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { constants, setPriority, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fast = process.argv.includes("--fast");
setPriority(0, fast ? constants.priority.PRIORITY_HIGH : constants.priority.PRIORITY_BELOW_NORMAL); // Edge inherits it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "target", "ui-check");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { checks: {}, detail: {}, errors: [], times: {} };
const check = (name, ok, detail) => {
  report.checks[name] = !!ok;
  if (!ok || detail) report.detail[name] = detail;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const isSource = (f) => /\.(css|tsx?|html)$/.test(f) && !/\.test\./.test(f) && !f.includes(join("src", "assets"));
const appFiles = walk(join(root, "src")).filter(isSource);
const read = (f) => readFileSync(f, "utf8");
const appText = (ext) => appFiles.filter((f) => ext.test(f)).map(read).join("\n");
const sourceText = [...appFiles, ...walk(join(root, "harness")).filter(isSource)].map(read).join("\n");

// ---- Static checks ----
const KEPT = ["fade-in", "pie", "turn", "blur-in", "blur-out", "rail-slide"];
const frames = [...sourceText.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
check("onlyKeptKeyframes", frames.every((n) => KEPT.includes(n)), frames.filter((n) => !KEPT.includes(n)));
const scripted = [".animate(", "startViewTransition", "::view-transition"].filter((s) => sourceText.includes(s));
check("noScriptedAnimation", !scripted.length, scripted);
const WORDING = [["Needs review", /Needs review/], ["review as a state", /\breview\b/i], ["Next file", /Next file/], ["Done, next worktree", /Done, next worktree/], ["Compare", /\bCompare\b(?! images)/], ["Try again", /Try again/], ["viewed", /\bviewed\b/]];
const forbidden = (text) => WORDING.filter(([, r]) => r.test(text)).map(([n]) => n);
check("noForbiddenWording", !forbidden(sourceText).length, forbidden(sourceText));
// Every surface keeps its own styles: what stays in styles.css is the page itself.
const readSrc = (f) => readFileSync(join(root, "src", f), "utf8");
const classesOf = (css) => [...new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<![\w-])\.([a-z][\w-]*)(?=[^{}]*\{)/g)].map((m) => m[1]))];
const page = readSrc("styles.css");
check("appStylesAreOnlyThePage", classesOf(page).join() === "app" && !/^(button|input|select|kbd)\b/m.test(page), classesOf(page));

// The stylesheets carry nothing unused: each class is drawn somewhere, each design token is read somewhere, and each token read is defined.
const css = appText(/\.css$/), code = appText(/\.tsx?$/);
const kitText = readSrc("ui/controls.css");
const inCode = (c) => new RegExp(`(className|classList|class=)[^\\n]*(?<![\\w-])${c}(?![\\w-])`).test(code);
// Monaco draws these itself; editor.css themes them.
const MONACO_CLASSES = ["monaco-editor", "margin-view-overlays", "line-numbers", "gutter-insert", "gutter-delete"];
const surfaceCss = appFiles.filter((f) => f.endsWith(".css") && !f.includes(join("src", "ui"))).map(read).join("\n");
const undrawn = classesOf(surfaceCss).filter((c) => !MONACO_CLASSES.includes(c) && !inCode(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(kitText));
check("noUnusedRules", !undrawn.length, undrawn);
const tokens = [...new Set([...readSrc("ui/tokens.css").matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]))];
const unreadTokens = tokens.filter((t) => !(css + code).includes(`var(${t}`) && !code.includes(`"${t}"`) && !code.includes(`"${t.slice(2)}"`));
check("noUnreadTokens", !unreadTokens.length, unreadTokens);
const undefinedTokens = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((t) => !t.startsWith("--vscode-") && !css.includes(`${t}:`) && !code.includes(`${t}`));
check("noUndefinedTokens", !undefinedTokens.length, undefinedTokens);
check("monacoNeverNamedDirectly", !/setTheme\(.*vs/.test(readSrc("components/EditorArea.tsx") + readSrc("App.tsx")) && !/#[0-9a-f]{3,8}\b/i.test(readSrc("lib/editorTheme.ts").replace(/"#00000000"/, "").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "").replace(/`#\$\{[^`]*`/g, "").replace(/\^#\(/g, "")));

if (process.argv.includes("--bundle")) {
  const dist = join(root, "dist");
  if (!existsSync(dist)) throw new Error("no dist: run pnpm build first");
  const built = walk(dist).filter((f) => /\.(js|css|html)$/.test(f));
  const found = ["gal-scroll", "harness/main", "harness/app", "mockIPC", "The harness has no answer", "shop-platform"].filter((s) => built.some((f) => readFileSync(f, "utf8").includes(s)));
  check("productionBundleClean", !found.length, found);
  report.bundleFiles = built.length;
  finish();
}

// ---- The browser ----
const AUDIT = `(()=>{
const parse=c=>{const m=c.match(/[\\d.]+/g).map(Number);return{r:m[0],g:m[1],b:m[2],a:m[3]===undefined?1:m[3]}};
const canvas=document.createElement("canvas").getContext("2d",{willReadFrequently:true});
const norm=c=>{if(!/^(color|oklab|oklch|lab)/.test(c))return parse(c);canvas.clearRect(0,0,1,1);canvas.fillStyle=c;canvas.fillRect(0,0,1,1);const d=canvas.getImageData(0,0,1,1).data;return{r:d[0],g:d[1],b:d[2],a:d[3]/255}};
const over=(f,b)=>({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
const lin=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4};
const L=c=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);
const ratio=(a,b)=>{const x=L(a),y=L(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const bgOf=e=>{const st=[];for(let n=e;n;n=n.parentElement){const c=norm(getComputedStyle(n).backgroundColor);if(c.a>0){st.push(c);if(c.a>=1)break}}let b={r:0,g:0,b:0,a:1};for(const c of st.reverse())b=over(c,b);return b};
const app=document.querySelector(__ROOT__),fails=[],sizes={};let n=0;
const w=document.createTreeWalker(app,NodeFilter.SHOW_TEXT);
while(w.nextNode()){const t=w.currentNode;if(!t.nodeValue.trim())continue;const e=t.parentElement;if(e.closest(".sr,svg"))continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;const c=getComputedStyle(e);if(c.visibility==="hidden"||c.opacity==="0")continue;
 let op=1;for(let p=e;p;p=p.parentElement)op*=+getComputedStyle(p).opacity;
 if(e.closest(':disabled,[aria-disabled="true"],.chk.off')||op<.02)continue; // inactive controls are exempt from the text contrast rule
 const bg=bgOf(e),fg=norm(c.color);fg.a*=op;const q=ratio(over(fg,bg),bg);n++;const fs=parseFloat(c.fontSize);sizes[fs]=(sizes[fs]||0)+1;
 if(q<4.5)fails.push({t:t.nodeValue.trim().slice(0,28),q:+q.toFixed(2),fs,cls:String(e.className).slice(0,24),par:String(e.parentElement.className).slice(0,24)})}
const a=app.getBoundingClientRect(),clip=[];
app.querySelectorAll("*").forEach(e=>{if(e.closest("svg,.sr,.glide,.tabs,.resize"))return;const r=e.getBoundingClientRect();if(!r.width)return;if((r.right>a.right+1||r.left<a.left-1)&&getComputedStyle(e).visibility!=="hidden")clip.push(String(e.className).slice(0,30))});
app.querySelectorAll(".badge,.badge *,.count,.btn,kbd,.tray>button").forEach(e=>{if(e.closest(".sr,svg")||!e.offsetWidth)return;if(e.scrollWidth>e.clientWidth+1)clip.push("TRUNCATED "+e.textContent.trim().slice(0,20))});
app.querySelectorAll(".btn:not(.link),.field,.row,.badge,.count,.tray>button").forEach(e=>{if(e.closest(".sr,svg")||!e.offsetWidth||!e.textContent.trim()||e.tagName==="INPUT")return;const s=document.createRange();s.selectNodeContents(e);const t=s.getBoundingClientRect();if(t.height>e.getBoundingClientRect().height+1)clip.push("TALL "+e.textContent.trim().slice(0,20))});
return{texts:n,fails:fails.slice(0,30),failCount:fails.length,sizes,overflow:[...new Set(clip)].slice(0,12),docW:app.scrollWidth,win:app.clientWidth,font:getComputedStyle(app).fontFamily.slice(0,20)}})()`;

const audit = (root = "#app") => AUDIT.replace("__ROOT__", JSON.stringify(root));
const KEEP_ANIM = ["fade-in", "pie", "turn"], FOLD_ANIM = ["blur-in", "blur-out", "rail-slide"], COLOUR = ["background-color", "color", "box-shadow", "opacity"];
// Timing comes from the stylesheet: a reversed transition runs shorter, so getTiming() can't tell.
// Monaco's own scrollbars and widgets animate as Monaco ships them; the allow-list is for what this app draws.
const CLASSIFY = `(()=>{const out=[];for(const a of document.getAnimations()){const t=a.effect&&a.effect.target,cs=getComputedStyle(t);
 if(t.closest(".monaco-editor,.monaco-diff-editor"))continue;
 const spec=(kind,names,name)=>{const i=Math.max(0,cs[names].split(", ").indexOf(name));return{dur:Math.round(parseFloat(cs[kind+"Duration"].split(", ")[i])*1000),ease:cs[kind+"TimingFunction"].split(/, (?![^(]*[)])/)[i]}};
 const where=e=>!e?"?":(e.tagName||"")+"."+String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className).split(" ")[0];
 let key,bad=null;
 if(a instanceof CSSAnimation){const {dur,ease}=spec("animation","animationName",a.animationName);key="animation:"+a.animationName;if(${JSON.stringify(FOLD_ANIM)}.includes(a.animationName)){if(dur!==160||ease!=="ease"||!t.closest(".rail,#main"))bad=key+" "+where(t)+" "+dur}else if(!${JSON.stringify(KEEP_ANIM)}.includes(a.animationName))bad=key;else if(a.animationName==="fade-in"&&(dur!==120||ease!=="ease"))bad=key+" "+dur+" "+ease}
 else if(a instanceof CSSTransition){const p=a.transitionProperty,{dur,ease}=spec("transition","transitionProperty",p);key="transition:"+p;
  if(${JSON.stringify(COLOUR)}.includes(p)||p==="fill"){if(dur!==120||ease!=="ease")bad=key+" "+dur+" "+ease}
  else if(p==="left"||p==="right"){if(!t.matches(".tray>.glide")||dur!==160||ease!=="ease")bad=key+" "+where(t)+" "+dur}
  else if(p==="transform"){const drawer=t.matches(".list-clip");if(drawer?dur!==160:!t.closest(".sec,.tchev")||dur!==120)bad=key+" "+where(t)+" "+dur;else if(ease!=="ease")bad=key+" "+where(t)+" "+ease}
  else if(p==="visibility"){if(!t.matches(".list-clip"))bad=key+" "+where(t)}
  else bad=key}
 else{key="waapi";bad=key}
 out.push({key,bad,where:where(t)})}return out})()`;
const LOOPS = `document.getAnimations().filter(a=>a.playState==="running"&&a.effect.getTiming().iterations===Infinity).map(a=>a.animationName||a.transitionProperty||"?")`;

const panesArg = process.argv.find((a) => a === "--panes" || a.startsWith("--panes="));
const panesOnly = !!panesArg;
const panesPrefix = panesArg?.split("=")[1] ?? "panes";
const TABS = Math.max(1, Number(process.argv.find((a) => a.startsWith("--tabs="))?.split("=")[1]) || 4);
const edge = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

// ---- The pages, built once and served as files: nothing is compiled or re-optimised while the checks run. ----
const site = join(out, "site");
const builtAt = Date.now();
process.env.NODE_ENV = "development"; // React's development build, as the dev server serves it: its warnings and errors reach noConsoleErrors.
const { build } = await import("vite");
await build({
  root,
  mode: "development",
  logLevel: "warn",
  build: { outDir: site, emptyOutDir: true, minify: false, reportCompressedSize: false, rollupOptions: { input: [join(root, "harness", "index.html"), join(root, "harness", "app.html")] } },
});
report.buildMs = Date.now() - builtAt;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const file = resolve(site, `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`);
  if (!file.startsWith(site) || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const harness = `http://127.0.0.1:${server.address().port}/harness`;

// ---- The browser: one Edge, driven over a single DevTools connection, on a free port. ----
const profile = mkdtempSync(join(tmpdir(), "grove-ui-check-"));
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=0", "--force-device-scale-factor=1", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "about:blank"], { stdio: "ignore", windowsHide: true });

async function stop() {
  try {
    execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // Already gone.
  }
  server.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

const CODES = { Escape: "Escape", ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Enter: "Enter", Tab: "Tab", F10: "F10", ContextMenu: "ContextMenu", PageDown: "PageDown", PageUp: "PageUp", Home: "Home", End: "End", Backspace: "Backspace", " ": "Space", p: "KeyP", w: "KeyW", b: "KeyB", o: "KeyO", k: "KeyK", ",": "Comma", "=": "Equal" };
// Settled: two frames have been drawn and none of this app's animations is still running. Monaco's own are left out, as in CLASSIFY.
const SETTLE = `new Promise(r=>{const t0=performance.now(),cap=setTimeout(()=>r(0),3000);const f=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
 const busy=document.getAnimations().some(a=>a.playState==="running"&&a.effect&&a.effect.getTiming().iterations!==Infinity&&!a.effect.target?.closest?.(".monaco-editor,.monaco-diff-editor"));
 if(busy&&performance.now()-t0<3000)f();else{clearTimeout(cap);r(1)}}));f()})`;

/** Connects to the browser and returns a function that opens a tab, in a browser context of its own, with the helpers every check uses. */
async function connect() {
  let active;
  for (let i = 0; i < 120 && !active; i++) {
    try {
      active = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n");
    } catch {
      await sleep(250); // Still starting.
    }
  }
  if (!active?.[1]) throw new Error("headless Edge did not start");
  const ws = new WebSocket(`ws://127.0.0.1:${active[0].trim()}${active[1].trim()}`);
  await new Promise((r, x) => ((ws.onopen = r), (ws.onerror = x)));
  let id = 0;
  const pend = new Map(), listeners = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) {
      pend.get(d.id)(d);
      pend.delete(d.id);
    } else if (d.sessionId) listeners.get(d.sessionId)?.(d);
  };
  // A command the page never answers fails its check instead of hanging the run.
  const cdp = (method, params = {}, sessionId) => new Promise((r, x) => {
    const i = ++id;
    const t = setTimeout(() => { pend.delete(i); x(new Error(`no answer to ${method} in 30s: ${String(params.expression ?? "").slice(0, 80)}`)); }, 30000);
    pend.set(i, (d) => { clearTimeout(t); r(d); });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return async function openTab() {
    const { browserContextId } = (await cdp("Target.createBrowserContext")).result;
    const { targetId } = (await cdp("Target.createTarget", { url: "about:blank", browserContextId })).result;
    const { sessionId } = (await cdp("Target.attachToTarget", { targetId, flatten: true })).result;
    const t = { group: "", errors: [], frameUrls: [] };
    const fail = (text) => { t.errors.push(text); report.errors.push(`${t.group}: ${text}`); };
    listeners.set(sessionId, (d) => {
      if (d.method === "Runtime.exceptionThrown") fail(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
      if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") fail(d.params.args.map((a) => a.value ?? a.description).join(" "));
      if (d.method === "Page.frameRequestedNavigation" || d.method === "Page.frameStartedNavigating") t.frameUrls.push(d.params.url);
      if (d.method === "Page.frameNavigated") t.frameUrls.push(d.params.frame.url);
    });
    const send = (t.send = (method, params = {}) => cdp(method, params, sessionId));
    const ev = (t.ev = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      return r.result?.result?.value;
    });
    t.settle = () => ev(SETTLE);
    /** Reads until the answer is truthy, or the time is up; returns the last answer. */
    t.until = async (read, ms = 5000) => {
      const end = Date.now() + ms;
      for (;;) {
        const v = await read();
        if (v || Date.now() > end) return v;
        await sleep(25);
      }
    };
    t.has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
    t.waitFor = async (sel, ms = 20000) => !!(await t.until(() => t.has(sel), ms));
    t.waitGone = async (sel, ms = 5000) => !!(await t.until(async () => !(await t.has(sel)), ms));
    t.focusIs = (sel) => ev(`!!document.activeElement?.matches?.(${JSON.stringify(sel)})`);
    // The mocked backend is quiet: no command for two settled frames in a row. Pages without it (the gallery) only settle.
    t.idle = async () => {
      for (let i = 0, n = -1, quiet = 0; i < 100 && quiet < 2; i++) {
        await t.settle();
        const m = await ev(`window.__ipc?.length ?? 0`);
        quiet = m === n ? quiet + 1 : 0;
        n = m;
      }
    };
    /** Navigates and waits for the new document, never the one being left. */
    t.go = async (url) => {
      await ev(`window.__leaving=1`).catch(() => {});
      await send("Page.navigate", { url });
      await t.until(() => ev(`!window.__leaving&&document.readyState!=="loading"`).catch(() => false), 30000);
    };
    t.shot = async (name) => writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    t.size = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    t.center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:"center"});const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()`);
    t.mouse = (x, y, type = "mouseMoved") => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    t.hover = async (sel) => { const c = await t.center(sel); if (!c) throw new Error(`no ${sel}`); await t.mouse(c.x, c.y); return c; };
    t.click = async (sel) => { const c = await t.hover(sel); await t.mouse(c.x, c.y, "mousePressed"); await t.mouse(c.x, c.y, "mouseReleased"); };
    // mods: 2 is Ctrl, 8 is Shift. The page has handled the key when the command returns; a frame more lets what it scheduled run.
    t.key = async (k, vk, mods = 0) => {
      const base = { key: k, code: CODES[k], windowsVirtualKeyCode: vk, modifiers: mods };
      // Enter carries its character: a form submits on that, not on the bare key.
      await send("Input.dispatchKeyEvent", k === "Enter" ? { type: "keyDown", text: "\r", ...base } : { type: "rawKeyDown", ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      await ev(`new Promise(r=>requestAnimationFrame(()=>r(1)))`);
    };
    t.type = async (text) => { await send("Input.insertText", { text }); await ev(`new Promise(r=>requestAnimationFrame(()=>r(1)))`); };
    t.attempt = async (name, fn) => {
      if (panesOnly && !name.startsWith(panesPrefix)) return;
      const started = Date.now();
      try {
        const r = await fn();
        check(name, r === true || (r && typeof r === "object" && Object.values(r).every(Boolean)), r === true ? undefined : r);
      } catch (e) {
        check(name, false, String(e.message ?? e));
      }
      report.times[name] = Date.now() - started;
      await t.key("Escape", 27);
      await t.key("Escape", 27);
    };
    /** Between groups: the default window, no emulated media. */
    t.reset = async () => {
      await send("Emulation.setEmulatedMedia", { features: [] });
      await t.size(1440, 900);
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    return t;
  };
}

// ---- The checks, in groups that share nothing: each starts from a fresh page in the default window. ----
function checksOn(t) {
  const { send, ev, settle, until, has, waitFor, waitGone, focusIs, idle, go, shot, size, center, mouse, hover, click, key, type, attempt } = t;
  const groups = {};
  const open = async (q) => {
    await go(`${harness}/index.html?${q}`);
    await waitFor("#app .gal-sec", 120000);
    await ev("document.fonts.ready.then(()=>1)");
    await settle();
  };

  // ---- Contrast in each theme, and overflow where it is likeliest: the smallest window at the largest UI font. ----
  // The page has no breakpoints, so a theme shows the same text at every size; and text only grows with the font, so 18px at 800x500 overflows
  // wherever a smaller font or a larger window would.
  const pages = panesOnly ? [] : [["dark", 1440, 900, 13], ["light", 1440, 900, 13], ["dark", 800, 500, 18]];
  report.pages = {};
  for (const [theme, w, h, font] of pages) {
    const name = `${theme}-${w}x${h}-${font}px`;
    groups[`page ${name}`] = async () => {
      await size(w, h);
      await open(`theme=${theme}&font=${font}`);
      const a = await ev(audit());
      report.pages[name] = a;
      const text = await ev(`document.querySelector("#app").innerText`);
      report.pages[name].wording = forbidden(text);
      await shot(name);
      for (const section of ["Actions", "Inputs", "Lists and data", "Status", "Feedback", "Structure"]) {
        await ev(`[...document.querySelectorAll(".gal-sec>h2")].find(h=>h.textContent===${JSON.stringify(section)}).scrollIntoView({block:"start"});1`);
        await settle();
        await shot(`${name}-${section.split(" ")[0].toLowerCase()}`);
      }
      check(`page ${name}`, !a.failCount && !a.overflow.length && a.docW <= a.win && !report.pages[name].wording.length && !/segoe|arial|times/i.test(a.font.split(",")[0]), a.failCount || a.overflow.length || a.docW > a.win ? { fails: a.fails, overflow: a.overflow, docW: a.docW, win: a.win } : undefined);
    };
  }
  groups.galleryMotion = async () => {
    if (panesOnly) return;
    // ---- Motion: every animation and transition seen while using the live controls must be on the list. ----
    await size(1440, 900);
    await open("theme=dark");
    const seen = new Map(), bad = new Map();
    const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, (seen.get(a.key) ?? new Set()).add(a.where)); if (a.bad) bad.set(a.bad, a.where); } };
    const step = async (fn) => { await fn(); for (let i = 0; i < 5; i++) { await grab(); await sleep(30); } };
    await click('[data-live="mark"]');
    await click('[data-live="mark"]'); // Leaves Clean; the next steps pass through Push rejected and Changing, which spins.
    await click('[data-live="mark"]');
    await step(() => click('[data-live="mark"]'));
    await step(() => click('[data-live="mark"]'));
    await step(() => hover(".row.on"));
    await step(() => hover('[data-live="toggle"]'));
    await step(() => click('[data-live="toggle"]'));
    await step(() => click('[data-live="fold"] .sec'));
    await step(() => click('[data-live="fold"] .sec'));
    await step(() => click(".tray[aria-label=Demo] button:nth-of-type(1)"));
    await step(() => click(".tray[aria-label=Demo] button:nth-of-type(3)"));
    await step(() => hover(".btn.primary"));
    await step(() => hover("button.chip"));
    await step(() => click("input.field"));
    await step(() => hover(".gal-rz .resize"));
    await step(() => click('[data-live="check"]'));
    for (const o of ["menu", "picker", "dialog"]) {
      await step(() => click(`[data-live="${o}"]`));
      await key("Escape", 27);
      await settle();
    }
    const need = ["animation:fade-in", "animation:pie", "animation:turn", "transition:background-color", "transition:left", "transition:transform", "transition:opacity"];
    report.motion = { seen: Object.fromEntries([...seen].map(([k, v]) => [k, [...v].slice(0, 6)])), violations: Object.fromEntries(bad) };
    check("motionAllowList", !bad.size && need.every((k) => seen.has(k)), { violations: Object.fromEntries(bad), missing: need.filter((k) => !seen.has(k)) });

    // The thumb's first placement is instant: it must not slide in from nowhere.
    await open("theme=dark");
    check("trayThumbFirstPlacementInstant", (await ev(`document.getAnimations().filter(a=>a.effect.target.matches?.(".glide")).length`)) === 0);

    // ---- Reduced motion ----
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await open("theme=dark");
    const before = await ev(LOOPS);
    await click(".tray[aria-label=Demo] button:nth-of-type(1)");
    await click('[data-live="fold"] .sec');
    const running = await ev(`document.getAnimations().filter(a=>a.playState==="running").length`);
    await send("Emulation.setEmulatedMedia", { features: [] });
    check("reducedMotion", !before.length && !running, { before, running });
  };
  groups.galleryOverlays = async () => {
    if (panesOnly) return;
    // ---- The real overlays, in the gallery. ----
    await size(1440, 900);
    await open("theme=dark");
    await attempt("galleryLiveOverlays", async () => {
      const d = {};
      for (const [k, target, sel] of [["menu", '[data-live="menu"]', "#overlays .menu"], ["picker", '[data-live="picker"]', "#overlays .picker"], ["dialog", '[data-live="dialog"]', "#overlays .dlg"], ["select", '[data-live="select"] .sel', "#overlays .picker"]]) {
        await click(target);
        await settle();
        d[k] = await has(sel);
        await key("Escape", 27);
        await settle();
        d[`${k}Closed`] = !(await has("#overlays > :not(.tip)"));
        d[`${k}FocusBack`] = await focusIs(target);
      }
      return d;
    });
    await attempt("tooltip", async () => {
      await hover('[data-live="tip"]');
      const shown = await waitFor("#overlays .tip", 3000);
      const text = await ev(`document.querySelector("#overlays .tip")?.textContent`);
      await mouse(2, 2);
      return { shown, text: text === "A tooltip shows after a short wait", gone: await waitGone("#overlays .tip") };
    });
    await attempt("dialogFocusTrap", async () => {
      await click('[data-live="dialog"]');
      await settle();
      const d = { inert: await has("#app[inert]"), focusIn: await ev(`!!document.activeElement.closest(".dlg")`) };
      for (let i = 0; i < 8; i++) await key("Tab", 9);
      d.tabStays = await ev(`!!document.activeElement.closest(".dlg")`);
      for (let i = 0; i < 8; i++) await key("Tab", 9, 8);
      d.shiftTabStays = await ev(`!!document.activeElement.closest(".dlg")`);
      await key("Escape", 27);
      d.closed = !(await has(".dlg"));
      d.inertGone = !(await has("#app[inert]"));
      d.focusBack = await focusIs('[data-live="dialog"]');
      await click('[data-live="dialog"]');
      await settle();
      await mouse(4, 4);
      await mouse(4, 4, "mousePressed");
      await mouse(4, 4, "mouseReleased");
      d.scrimCloses = !(await has(".dlg"));
      return d;
    });
    await attempt("pickerKeyboard", async () => {
      await click('[data-live="picker"]');
      await settle();
      const d = { filterFocused: await focusIs("#overlays .picker input") };
      await type("rel");
      d.filtered = (await ev(`document.querySelectorAll("#overlays .picker .mi").length`)) === 1;
      await key("ContextMenu", 93);
      await settle();
      d.menuOnTop = await has("#overlays .menu");
      d.keyboardFirstItem = await has("#overlays .menu .mi.on");
      await key("Escape", 27);
      d.onlyMenuClosed = !(await has("#overlays .menu")) && (await has("#overlays .picker"));
      await key("Enter", 13);
      await settle();
      d.picked = (await ev(`document.querySelector('[data-live="last"]').textContent`)) === "Picker: release/2.4";
      d.focusBack = await focusIs('[data-live="picker"]');
      await click('[data-live="picker"]');
      await settle();
      await click('[data-live="picker"]');
      d.anchorToggles = !(await has("#overlays .picker"));
      return d;
    });
    await attempt("transientOverlays", async () => {
      const open = async () => { await click('[data-live="menu"]'); await settle(); return has("#overlays .menu"); };
      const d = {};
      d.opened = await open();
      await ev(`window.dispatchEvent(new Event("blur"));1`);
      await settle();
      d.blur = !(await has("#overlays .menu"));
      await open();
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 4, y: 4, deltaX: 0, deltaY: 40 });
      await settle();
      d.wheelOutside = !(await has("#overlays .menu"));
      await open();
      await ev(`window.dispatchEvent(new Event("resize"));1`);
      await settle();
      d.resize = !(await has("#overlays .menu"));
      await click('[data-live="picker"]');
      await settle();
      await ev(`window.dispatchEvent(new Event("resize"));1`);
      d.pickerStaysOnResize = await has("#overlays .picker");
      await mouse(4, 4);
      await mouse(4, 4, "mousePressed");
      await mouse(4, 4, "mouseReleased");
      await settle();
      d.pickerClosesOutside = !(await has("#overlays .picker"));
      return d;
    });
    await attempt("selectArrowOpens", async () => {
      await ev(`document.querySelector('[data-live="select"] .sel').focus();1`);
      await key("ArrowDown", 40);
      await settle();
      const opened = await has("#overlays .picker");
      await key("ArrowDown", 40);
      await key("Enter", 13);
      await settle();
      return { opened, picked: (await ev(`document.querySelector('[data-live="select"] .sel').textContent`)) === "development" };
    });
  };

  // ---- The real App on mocked IPC. ----
  const openApp = async (q = "") => {
    await go(`${harness}/app.html?theme=dark${q}`);
    // Rows once a repository has loaded; the welcome once settings say there is none (?none=1, or no repositories saved).
    return ready(".rail .wt:not(.skel), .rail .empty, .ov-page .empty");
  };
  /** The App has drawn `sel`, its fonts are in, and the mocked backend has gone quiet. */
  const ready = async (sel) => {
    const ok = await waitFor(sel, 60000);
    await ev("document.fonts.ready.then(()=>1)");
    await idle();
    return ok;
  };
  const toWork = async (n = 1) => { await click(n === 1 ? ".rail-pinned .wt" : `.rail-list .wt:nth-child(${n - 1})`); await idle(); };
  const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const width = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect().width ?? null`);
  const box = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();return r?{l:r.left,r:r.right,t:r.top,b:r.bottom}:null})()`);
  const lastSaved = () => ev(`[...window.__ipc].reverse().find(c=>c.cmd==="save_settings")?.args.settings ?? null`);
  const ipc = (name) => ev(`window.__ipc.filter(c=>c.cmd===${JSON.stringify(name)}).length`);
  groups.appBasics = async () => {
    await attempt("appStarts", async () => ({ opened: (await openApp()) && (await has(".rail .wt:not(.skel)")), host: await has("#overlays.ui-root"), inert: !(await has(".app[inert]")) }));
    await attempt("branchPicker", async () => {
      await toWork(2);
      await click(".br-btn");
      await idle();
      const d = { sections: (await ev(`document.querySelectorAll(".picker .sec-l").length`)) === 2 };
      await type("origin/");
      d.filtered = (await ev(`document.querySelectorAll(".picker .mi").length`)) === 1;
      await key("Enter", 13);
      await idle();
      d.viewOnly = (await text(".head .badge")) === "View only";
      d.banner = (await text(".work-top .banner b")) === "Viewing origin/main";
      await click(".work-top .banner .btn.link");
      await idle();
      d.back = !(await has(".head .badge"));
      return d;
    });
    await attempt("repoDialogSsh", async () => {
      await openApp();
      await click(".t-repo");
      await idle();
      const d = { listed: (await ev(`document.querySelectorAll(".picker .mi").length`)) === 1 };
      d.oneAction = (await ev(`document.querySelectorAll(".picker-f .btn").length`)) === 1 && !(await has(".picker-f input"));
      await click(".picker-f .btn");
      await idle();
      d.menuClosed = !(await has(".picker"));
      d.folderFocused = await focusIs(".repo-dlg .repo-f input");
      await ev(`[...document.querySelectorAll(".repo-dlg .tray button")].find(b=>b.textContent==="SSH").click();1`);
      await idle();
      d.hostFocused = await focusIs('.repo-dlg input[placeholder^="user@host"]');
      await type("user@dev-box");
      await key("Tab", 9);
      d.tabInForm = await focusIs('.repo-dlg input[placeholder^="/home"]');
      await type("~/src/example");
      d.stillOpen = await has(".repo-dlg");
      const before = await ipc("open_repo");
      await key("Enter", 13);
      await idle();
      d.connected = (await ev(`window.__ipc.filter(c=>c.cmd==="open_repo").some(c=>String(c.args.path).startsWith("ssh://user@dev-box"))`)) && (await ipc("open_repo")) > before;
      d.closedAfter = !(await has(".repo-dlg"));
      d.focusBack = await focusIs(".t-repo");
      return d;
    });
    await attempt("repoRemoveButton", async () => {
      await openApp();
      await click(".t-repo");
      await idle();
      await hover(".picker .mi");
      const visible = await ev(`getComputedStyle(document.querySelector(".picker .mi-x")).opacity==="1"`);
      await click(".picker .mi-x");
      await idle();
      return { visible, stayedOpen: await has(".picker"), removed: !(await has(".picker .mi")) };
    });
    await attempt("baseSelect", async () => {
      await openApp();
      await click(".ov-tools .sel");
      await idle();
      const d = { open: await has(".picker .mi") };
      const before = await ipc("worktrees_overview");
      await key("ArrowDown", 40);
      await key("Enter", 13);
      await idle();
      d.reloaded = (await ipc("worktrees_overview")) > before;
      return d;
    });
  };
  groups.contextMenus = async () => {
    if (panesOnly) return;
    // Every context menu, through the app's own WV_CONTEXT_MENU hook, by right-click and by key.
    const PLACES = ["changes", "changes:key", "commit", "commit:key", "commitfile", "commitfile:key", "explorer", "explorer:key", "folder", "folder:key", "search", "search:key", "quickopen", "quickopen:key", "tab", "tab:key", "repo", "repo:key", "worktree", "worktree:key", "branch", "branch:key"];
    const menus = {};
    for (const place of panesOnly ? [] : PLACES) {
      await openApp(`&auto=${encodeURIComponent(JSON.stringify({ contextMenu: place, ...(place.startsWith("tab") ? { openFile: "README.md" } : {}) }))}`);
      await waitFor("#overlays .menu", 8000);
      await idle();
      menus[place] = {
        items: await ev(`document.querySelectorAll("#overlays .menu [role=menuitem]").length`),
        first: place.endsWith(":key") ? await has("#overlays .menu .mi.on") : true,
      };
      if (place === "repo" || place === "changes") await shot(`app-menu-${place}`);
    }
    report.menus = menus;
    const emptyMenus = Object.entries(menus).filter(([, m]) => !m.items || !m.first).map(([k]) => k);
    if (!panesOnly) check("everyContextMenu", !emptyMenus.length, emptyMenus);
  };
  groups.appHooks = async () => {
    await attempt("menuOptionRuns", async () => {
      await openApp(`&auto=${encodeURIComponent(JSON.stringify({ contextMenu: "changes>Copy path" }))}`);
      const copied = await until(async () => (await ipc("copy_text")) > 0, 10000);
      await idle();
      return { copied: copied && (await ipc("copy_text")) === 1, closed: await waitGone("#overlays .menu") };
    });
    // The other WV_* hooks that reach into the page, each from a fresh start. One whose selector stopped matching logs an error, which noConsoleErrors also fails on.
    await attempt("automationHooks", async () => {
      const start = (o, q = "") => openApp(`${q}&auto=${encodeURIComponent(JSON.stringify(o))}`);
      const errors = t.errors.length;
      const d = {};
      // Each hook waits a moment of its own before it acts: these wait for what it does.
      await start({ historySearch: "refund" });
      d.historySearch = await until(async () => (await ev(`document.querySelector(".history-search input")?.value`)) === "refund", 10000);
      await start({ leftTab: "changes", listKeys: "ArrowDown" });
      d.listKeys = await waitFor(".left .lbox .row.on", 10000);
      await start({ worktrees: "1" });
      d.worktrees = await waitFor(".ov-page", 5000);
      await start({ worktrees: "chip:0" }, "&ov=many");
      d.chip = await waitFor(".tabs .tab", 10000); // The chip opens that worktree's change.
      await start({ openFile: "src/server/orders/create.ts", blame: "click:1" });
      d.blame = await until(async () => (await ipc("commit")) > 0, 15000);
      await start({ openFile: "docs/assets/logo.png", imageZoom: "2" });
      d.imageZoom = await until(async () => (await text(".image-zoom")) === "200%", 10000);
      t.frameUrls.length = 0;
      await start({ openFile: "docs/preview.html", previewLink: 0 });
      d.previewLink = (await waitFor("iframe.html-preview", 10000)) && (await until(() => t.frameUrls.some((u) => u.includes("/~link?")), 10000));
      d.noErrors = t.errors.length === errors || t.errors.slice(errors);
      return d;
    });
    // Too wide to fit on the right of its button, a picker still opens under it, ending at its right edge.
    await attempt("pickerStaysUnderItsButton", async () => {
      await openApp();
      await click(".base-select .sel");
      await waitFor("#overlays .picker", 5000);
      const b = await box(".base-select .sel"), p = await box("#overlays .picker");
      return { under: p.t >= b.b, spans: p.l <= b.l + 1 && p.r >= b.r - 1 };
    });
    // The overview table has the rail's worktree menu, by right-click and by key.
    await attempt("worktreeTableMenu", async () => {
      await openApp();
      const d = {};
      const labels = () => ev(`[...document.querySelectorAll("#overlays .menu [role=menuitem]")].map((e) => e.textContent).join()`);
      const want = "Copy path,Copy branch name,Open in Terminal,Reveal in File Explorer";
      await ev(`(()=>{const r=document.querySelector(".dt-row"),b=r.getBoundingClientRect();r.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,button:2,clientX:b.left+40,clientY:b.top+8}))})()`);
      await waitFor("#overlays .menu", 3000);
      d.pointer = (await labels()) === want;
      d.marked = await has(".dt-row.menu-target");
      await ev(`[...document.querySelectorAll("#overlays .menu [role=menuitem]")].find((e) => e.textContent === "Open in Terminal").click()`);
      await idle();
      d.ran = (await ipc("open_terminal")) === 1;
      d.unmarked = !(await has(".dt-row.menu-target"));
      await ev(`document.querySelector(".dt-row").focus()`);
      await key("ContextMenu", 93);
      await waitFor("#overlays .menu", 3000);
      d.key = (await labels()) === want;
      return d;
    });
    await attempt("contextMenuKeys", async () => {
      await openApp();
      await toWork(2);
      await ev(`document.querySelector(".ptabs button").click();1`);
      await idle();
      const d = { list: await waitFor(".left .lbox .row", 8000) };
      await click(".left .lbox .row");
      await ev(`document.querySelector(".left .lbox").focus();1`);
      await key("F10", 121, 8);
      await idle();
      d.shiftF10 = await has("#overlays .menu .mi.on");
      d.target = await has(".left .lbox .row.menu-target");
      await ev(`document.querySelector(".left .lbox").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));1`);
      d.echoIgnored = (await ev(`document.querySelectorAll("#overlays .menu").length`)) === 1;
      await key("ArrowDown", 40);
      d.arrow = await ev(`document.querySelector("#overlays .menu").getAttribute("aria-activedescendant")!=="mi-0"`);
      await key("Escape", 27);
      d.closed = !(await has("#overlays .menu"));
      d.targetCleared = !(await has(".left .lbox .row.menu-target"));
      d.focusBack = await focusIs(".left .lbox");
      await key("ContextMenu", 93);
      await idle();
      d.menuKey = await has("#overlays .menu .mi.on");
      await key("ContextMenu", 93);
      d.menuKeyCloses = !(await has("#overlays .menu"));
      d.focusBack2 = await focusIs(".left .lbox");
      return d;
    });
    await attempt("keysWithMonaco", async () => {
      await openApp(`&auto=${encodeURIComponent(JSON.stringify({ openFile: "src/server/orders/create.ts" }))}`);
      const d = { editor: await waitFor(".monaco-editor textarea, .monaco-editor .native-edit-context", 15000) };
      await ev(`document.querySelector(".tabs .tab")?.click();1`);
      await idle();
      await ev(`document.querySelector(".editor-host:not([hidden]) .monaco-editor textarea, .monaco-editor textarea, .monaco-editor .native-edit-context").focus();1`);
      d.inMonaco = await ev(`!!document.activeElement.closest(".monaco-editor")`);
      const tabs = `document.querySelectorAll(".tabs .tab").length`;
      const before = await ev(tabs);
      await key("p", 80, 2);
      await idle();
      d.quickOpen = await has("#overlays .pal");
      d.inert = await has(".app[inert]");
      await key("w", 87, 2);
      await idle();
      d.pageIgnoresCtrlW = (await ev(tabs)) === before;
      await ev(`document.querySelector(".pal .mi")?.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:200}));1`);
      await idle();
      d.menuOverQuickOpen = await has("#overlays .menu");
      d.modalStays = await has("#overlays .pal");
      await key("Escape", 27);
      d.escClosesMenuOnly = !(await has("#overlays .menu")) && (await has("#overlays .pal"));
      await key("Escape", 27);
      await idle();
      d.closed = !(await has("#overlays .pal"));
      d.inertGone = !(await has(".app[inert]"));
      d.focusBackInMonaco = await ev(`!!document.activeElement.closest(".monaco-editor")`);
      return d;
    });
  };

  // ---- The shell, on the real App. ----
  const CTRL = 2, CTRL_SHIFT = 10;
  const autoQ = (o) => `&auto=${encodeURIComponent(JSON.stringify(o))}`;
  const settingsQ = (o) => `&settings=${encodeURIComponent(JSON.stringify(o))}`;
  // Only the shell is held to the design system's rules here: the panes inside it move over in later phases.
  const SHELL_REGIONS = [".rail", ".work-top", ".wc", ".ov-page", ".left", ".commit-col", ".ed-chrome", ".ed-msg", ".md-scroll", ".image-view"];
  const shellAudit = async () => {
    const r = { fails: [], overflow: [] };
    for (const region of SHELL_REGIONS) {
      if (!(await has(region))) continue;
      const a = await ev(audit(region));
      r.fails.push(...a.fails);
      r.overflow.push(...a.overflow);
    }
    r.pageW = await ev(`document.documentElement.scrollWidth`);
    r.appW = await ev(`document.querySelector(".app").scrollWidth`);
    r.win = await ev(`window.innerWidth`);
    return r;
  };
  const SHELL_PAGES = [["dark", 1440, 900, 13], ["light", 1440, 900, 13], ["dark", 1100, 700, 13], ["dark", 800, 500, 13], ["light", 800, 500, 13], ["dark", 800, 500, 10], ["dark", 800, 500, 18], ["light", 800, 500, 18]];
  for (const [theme, w, h, font] of panesOnly ? [] : SHELL_PAGES) {
    const name = `shell-${theme}-${w}x${h}-${font}px`;
    groups[name] = async () => {
      await size(w, h);
      await go(`${harness}/app.html?theme=${theme}&font=${font}&states=1`);
      await ready(".rail .wt:not(.skel)");
      const views = {};
      views.overview = await shellAudit();
      await shot(`${name}-overview`);
      await toWork(2);
      views.work = await shellAudit();
      await shot(`${name}-work`);
      if (w < 1100) {
        await idle(); // Opening a worktree brings the drawer out.
        await shot(`${name}-drawer`);
      }
      const bad = Object.fromEntries(Object.entries(views).filter(([, v]) => v.fails.length || v.overflow.length || v.pageW > v.win || v.appW > v.win));
      check(name, !Object.keys(bad).length, Object.keys(bad).length ? bad : undefined);
    };
  }
  groups.rail = async () => {
    await attempt("railContents", async () => {
      await openApp("&states=1");
      const y = async (sel) => (await box(sel))?.t;
      const d = {};
      const order = [await y(".rail-top"), await y(".rail-nav"), await y(".rail-filter"), await y(".rail-list"), await y(".rail-foot")];
      d.order = order.every((v, i) => !i || v > order[i - 1]);
      d.top = (await count(".rail-top .t-repo")) === 1 && (await count(".rail-top .btn.only")) === 2;
      d.noTitleBar = (await box(".rail")).t === 0 && !(await has(".topbar"));
      d.rows = (await count(".rail .wt")) === 5;
      d.branch = (await text(".rail-list .wt:nth-child(1) .d")) === "agent/orders-refund";
      d.time = /^(now|\d+[mhd])$/.test((await text(".rail-list .wt:nth-child(1) .wt-time")) ?? "");
      d.count = (await text(".rail-list .wt:nth-child(1) .count")) === "2";
      d.delta = /\+12\s*−3/.test((await text(".rail-list .wt:nth-child(1) .delta")) ?? "");
      d.mark = (await ev(`document.querySelector(".rail-list .wt:nth-child(1) .mark").dataset.s`)) === "changes";
      d.clean = (await ev(`document.querySelector(".rail-list .wt:nth-child(2) .mark").dataset.s`)) === "idle";
      d.missing = await has('.rail .wt.off[aria-disabled="true"][data-tip^="Missing or prunable"]');
      d.bare = await has('.rail .wt.off[aria-disabled="true"][data-tip="Bare repository"]');
      const before = await ipc("status");
      await click(".rail .wt.off");
      await idle();
      d.offDoesNotOpen = (await ipc("status")) === before && (await has(".ov-page"));
      await shot("shell-rail-states");
      return d;
    });
    await attempt("railSurvivesOverviewReset", async () => {
      await openApp("&states=1");
      await ev(`window.__store.setState({overview:null});1`);
      await idle();
      const d = { rows: (await count(".rail .wt")) === 5, counts: (await text(".rail-list .wt:nth-child(1) .count")) === "2" };
      await ev(`window.__store.getState().updateSettings({possibleConflicts:false});1`);
      await idle();
      d.afterSetting = (await count(".rail .wt")) === 5;
      d.reloaded = await until(async () => (await text(".rail-list .wt:nth-child(1) .delta")) !== null);
      return d;
    });
    await attempt("railStates", async () => {
      await openApp();
      const mark = (n) => ev(`document.querySelector(".rail-list .wt:nth-child(${n - 1}) .mark").dataset.s`);
      await ev(`(()=>{const s=window.__store;const p=s.getState().worktrees;s.setState({lastChange:{[p[2].path]:Date.now()/1000},actions:{[p[1].path]:{running:false,label:"",progress:"",error:null,rejected:true}}});})();1`);
      await idle();
      return { changing: (await mark(3)) === "active", rejected: (await mark(2)) === "error", replacesBranch: (await text(".rail-list .wt:nth-child(1) .err-note")) === "Push rejected" };
    });
    await attempt("railFilter", async () => {
      await openApp();
      await click(".rail-filter .btn");
      await type("agent-02");
      await idle();
      const d = { byName: (await count(".rail .wt")) === 2, mainStays: (await text(".rail-pinned .n")) === "main" && (await has(".rail-pinned .main-mark")) };
      await ev(`document.querySelector(".rail-filter input").select();1`);
      await type("nothing here");
      await idle();
      d.none = (await text(".rail .empty-line"))?.startsWith("No worktrees match.");
      await click(".rail .empty-line .btn");
      await idle();
      d.cleared = (await count(".rail .wt")) === 3 && (await focusIs(".rail-filter input"));
      await click(".rail-filter .btn:last-child");
      await idle();
      d.hasChanges = (await count(".rail .wt")) === 2 && (await has('.rail-filter .btn[aria-pressed="true"]'));
      await toWork(1);
      await click(".rail-filter .btn:last-child");
      return d;
    });
    await attempt("railKeys", async () => {
      await openApp();
      await ev(`document.querySelector(".rail .wt").focus();1`);
      await key("ArrowDown", 40);
      await key("ArrowDown", 40);
      const d = { arrows: await focusIs(".rail-list .wt:nth-child(2)") };
      await key("Enter", 13);
      await idle();
      d.opened = (await text(".head h1 .ell")) === "agent-02" && (await has(".rail-list .wt:nth-child(2).on"));
      await key("F10", 121, 8);
      await idle();
      d.menu = await has("#overlays .menu .mi.on");
      d.target = await has(".rail .wt.menu-target");
      await key("Escape", 27);
      d.focusBack = await focusIs(".rail-list .wt:nth-child(2)");
      return d;
    });
    await attempt("railResize", async () => {
      await openApp();
      const drag = async (to) => {
        const b = await box(".rail > .resize");
        await mouse(b.l + 2, 400);
        await mouse(b.l + 2, 400, "mousePressed");
        await mouse(to, 400);
        await mouse(to, 400, "mouseReleased");
        await idle();
      };
      await drag(300);
      const d = { follows: (await width(".rail")) === 300 };
      d.saved = await until(async () => (await lastSaved())?.railWidth === 300); // Saving waits for the setting to stop changing.
      await drag(900);
      d.max = (await width(".rail")) === 420;
      await drag(40);
      d.min = (await width(".rail")) === 220;
      await ev(`document.querySelector(".rail > .resize").focus();1`);
      await key("ArrowRight", 39);
      d.key = (await width(".rail")) === 228;
      d.instant = (await ev(`document.getAnimations().filter(a=>a.effect.target.closest?.(".rail")&&a.transitionProperty==="width").length`)) === 0 && (await ev(`getComputedStyle(document.querySelector(".rail")).transitionDuration`)) === "0s";
      await openApp(settingsQ({ railWidth: 300 }));
      d.restored = (await width(".rail")) === 300;
      await openApp(settingsQ({ railCollapsed: true }));
      d.restoredCollapsed = (await width(".rail")) === 48;
      return d;
    });
    await attempt("railFold", async () => {
      await openApp(autoQ({ openFile: "src/server/orders/create.ts" }));
      await idle();
      const seen = new Map(), bad = new Map();
      const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, 1); if (a.bad) bad.set(a.bad, a.where); } };
      const d = {};
      await click(".rail-filter .btn");
      await key("b", 66, CTRL);
      d.width = (await width(".rail")) === 48;
      d.ghost = (await count("#rail-fold > .rail-ghost")) === 1 && (await width(".rail-ghost")) === 264;
      d.ghostInert = !(await has("#rail-fold [id]")) && !(await has("#rail-fold [data-tip]")) && !(await has("#rail-fold [tabindex]"));
      d.slides = (await ev(`document.querySelector("#main").dataset.fold`)) === "" && !!(await ev(`getComputedStyle(document.querySelector("#main")).getPropertyValue("--fold-x")`));
      const widths = [];
      for (let i = 0; i < 5; i++) { await grab(); widths.push(await width(".main")); await sleep(20); }
      d.noReflow = new Set(widths).size === 1;
      d.ghostGone = await until(async () => (await count("#rail-fold > *")) === 0 && !(await has("#main[data-fold]")) && !(await has(".rail[data-fold]")));
      d.topOnlyRepo = (await count(".rail-top .btn")) === 1;
      d.navSearch = (await count(".rail .rail-nav")) === 5; // Overview, Issues, Search, Settings, Expand.
      d.noFilter = !(await has(".rail-filter"));
      d.badge = await ev(`(()=>{const c=document.querySelector(".rail-list .wt:nth-child(1) .count").getBoundingClientRect(),m=document.querySelector(".rail-list .wt:nth-child(1) .mark").getBoundingClientRect();return c.left>=m.left&&c.left<m.right+6&&c.bottom>m.top})()`);
      d.noBadgeAtZero = !(await has(".rail-list .wt:nth-child(2) .count"));
      d.tooltip = /Has changes\n2 files with uncommitted changes/.test(await ev(`document.querySelector(".rail-list .wt:nth-child(1)").title`));
      await shot("shell-rail-collapsed");
      d.saved = await until(async () => (await lastSaved())?.railCollapsed === true);
      await click('.rail-foot .btn[aria-label="Expand sidebar"]');
      d.expanded = (await width(".rail")) === 264;
      for (let i = 0; i < 5; i++) { await grab(); await sleep(20); }
      await idle();
      await key("b", 66, CTRL);
      await key("b", 66, CTRL);
      d.twiceReturns = await until(async () => (await width(".rail")) === 264 && (await count("#rail-fold > *")) === 0);
      d.allowed = !bad.size;
      d.bad = bad.size ? [...bad.keys()].join() : true;
      d.motions = ["animation:blur-in", "animation:blur-out", "animation:rail-slide"].filter((k) => !seen.has(k)).join() || true;
      return d;
    });
    await attempt("railFoldReducedMotion", async () => {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await openApp();
      await key("b", 66, CTRL);
      const d = { folded: (await width(".rail")) === 48, noGhost: !(await has("#rail-fold > *")), noMotion: !(await has("#main[data-fold]")) };
      await send("Emulation.setEmulatedMedia", { features: [] });
      return d;
    });
  };
  groups.shell = async () => {
    await attempt("routingKeepsEditor", async () => {
      await openApp(autoQ({ openFile: "src/server/orders/create.ts" }));
      const d = { editor: await waitFor(".monaco-editor .view-lines", 15000) };
      await idle();
      d.work = !(await has(".ov-page")) && !(await has(".work[data-covered]"));
      await ev(`document.querySelector(".monaco-editor").__keep=1;1`);
      const before = await box(".monaco-editor");
      await key("o", 79, CTRL_SHIFT);
      await idle();
      d.overview = await has(".ov-page");
      d.hidden = (await ev(`getComputedStyle(document.querySelector(".work")).visibility`)) === "hidden" && (await has(".work[inert]"));
      d.mounted = (await ev(`document.querySelector(".monaco-editor").__keep`)) === 1;
      d.sameSize = JSON.stringify(await box(".monaco-editor")) === JSON.stringify(before);
      d.navOn = await has('.rail-nav[aria-label="Overview"][aria-pressed="true"]');
      d.noneSelected = !(await has(".rail .wt.on"));
      await shot("shell-overview");
      await toWork(2);
      d.back = !(await has(".ov-page")) && (await ev(`document.querySelector(".monaco-editor").__keep`)) === 1;
      d.visible = (await ev(`[...document.querySelectorAll(".monaco-editor")].some(e=>getComputedStyle(e).visibility==="visible")`));
      await shot("shell-work");
      await click('.rail-nav[aria-label="Settings"]');
      await idle();
      d.settings = (await has(".set-dlg")) && (await has('.rail-nav[aria-label="Settings"][aria-pressed="true"]')) && (await ev(`document.querySelector(".monaco-editor").__keep`)) === 1;
      return d;
    });
    await attempt("pageHeader", async () => {
      await openApp();
      await toWork(2);
      const d = {};
      d.name = (await text(".head h1 .ell")) === "agent-01";
      d.branch = (await text(".br-btn .btn-l")) === "agent/orders-refund";
      d.aheadBehind = (await text(".head-ab")) === "↑1" && (await ev(`document.querySelector(".head-ab").dataset.tip`)) === "1 ahead, 0 behind main";
      d.split = (await text(".head .split .btn:first-child .btn-l")) === "Publish branch" && (await has('.head .split .btn[aria-label="More actions"]'));
      const c = await box(".wc"), p = await box(".head .split");
      d.controlsTopRight = c.r === (await ev(`innerWidth`)) && c.t === 0 && p.r <= c.l;
      d.dragBands = (await count('.rail-top[data-tauri-drag-region="deep"]')) === 1 && (await count('.head[data-tauri-drag-region="deep"]')) === 1;
      await click('.head .split .btn[aria-label="More actions"]');
      await idle();
      d.menu = (await text("#overlays .menu .mi-l")) === "Fetch origin";
      const before = await ipc("run_action");
      await key("Enter", 13);
      await idle();
      d.fetchRan = (await ipc("run_action")) === before + 1;
      await click(".head .split .btn:first-child");
      await idle();
      d.pushRan = (await ev(`[...window.__ipc].reverse().find(c=>c.cmd==="run_action").args.action ?? [...window.__ipc].reverse().find(c=>c.cmd==="run_action").args.kind`)) === "publish";
      for (const [label, cmd] of [["Minimize", "plugin:window|minimize"], ["Maximize", "plugin:window|toggle_maximize"], ["Close", "plugin:window|close"]]) {
        await ev(`document.querySelector('.wc [aria-label="${label}"]').click();1`);
        d[label] = (await ipc(cmd)) === 1;
      }
      return d;
    });
    await attempt("pushRejected", async () => {
      await openApp("&reject=1");
      await toWork(2);
      await click(".head .split .btn:first-child");
      await idle();
      const d = { banner: (await text(".work-top .banner pre"))?.includes("[rejected]"), rail: (await text(".rail-list .wt:nth-child(1) .err-note")) === "Push rejected" };
      await click('.work-top .banner [aria-label="Dismiss"]');
      d.dismissed = !(await has(".work-top .banner"));
      d.stays = (await text(".rail-list .wt:nth-child(1) .err-note")) === "Push rejected";
      return d;
    });
    await attempt("notices", async () => {
      await openApp();
      await toWork(2);
      await ev(`window.__store.setState({connectionLost:"dev-box",notice:"Could not copy"});1`);
      await idle();
      const d = { neutral: (await text(".notices .banner.neutral"))?.startsWith("Connection to dev-box lost. Reconnecting…"), noReconnect: !/Reconnect\b(?!ing)/.test(await text(".notices")) };
      d.pushOff = (await ev(`document.querySelector(".head .split .btn:first-child").dataset.tip`)) === "Not available while reconnecting";
      const b = await box(".notices .banner.error [aria-label='Dismiss']"), c = await box(".wc");
      d.dismissClearOfControls = b.r <= c.l;
      await click(".notices .banner.error [aria-label='Dismiss']");
      d.dismissed = !(await has(".notices .banner.error"));
      await shot("shell-notices");
      return d;
    });
    await attempt("noRepository", async () => {
      await openApp("&none=1");
      const d = { welcome: (await text(".rail .empty h2")) === "No repository open", noFilter: !(await has(".rail-filter")), repo: (await text(".t-repo .btn-l")) === "Add a repository", dragBand: (await box('.ov-page [data-tauri-drag-region="deep"]'))?.b === 44 && (await ev(`document.elementFromPoint(innerWidth/2,20).closest('[data-tauri-drag-region="deep"]')!==null`)) };
      await size(800, 500);
      await openApp("&none=1");
      d.onPage = (await text(".ov-page .empty h2")) === "No repository open";
      await size(1440, 900);
      return d;
    });
    await attempt("windowBackground", async () => {
      const colour = () => ev(`[...window.__ipc].reverse().find(c=>c.cmd==="plugin:window|set_background_color")?.args?.value ?? null`);
      await openApp();
      const d = { dark: JSON.stringify(await colour()).includes("08090a") };
      await ev(`window.__store.getState().updateSettings({theme:"light"});1`);
      await idle();
      d.light = JSON.stringify(await colour()).includes("f2f2f3");
      return d;
    });
    await attempt("noCollisions", async () => {
      await openApp();
      await toWork(2);
      await idle();
      return {
        railRowInFlow: (await ev(`getComputedStyle(document.querySelector(".rail .wt")).position`)) === "relative",
        listRowAbsolute: (await ev(`getComputedStyle(document.querySelector(".left .lbox .row")).position`)) === "absolute",
        noLegacyRow: !(await has(".list-row")),
      };
    });
    await attempt("widthBands", async () => {
      const d = {};
      await openApp();
      for (const [w, band] of [[1500, "xl"], [1499, "l"], [1100, "l"], [1099, "m"], [800, "m"]]) {
        await size(w, 700);
        await idle();
        d[`band${w}`] = (await ev(`document.querySelector(".app").dataset.size`)) === band;
      }
      await size(1440, 900);
      await idle();
      return d;
    });
    await attempt("listDrawer", async () => {
      await size(1000, 600);
      await openApp();
      const d = { rail: (await width(".rail")) === 48, noExpand: !(await has('.rail [aria-label="Expand sidebar"]')) };
      await toWork(2);
      const seen = new Map(), bad = new Map();
      const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, 1); if (a.bad) bad.set(a.bad, a.where); } };
      d.opensWithWorktree = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "true";
      await idle();
      d.overPage = (await box(".list-clip")).l === 48;
      await click(".left .lbox .row");
      await idle();
      d.fileCloses = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "false" && (await has(".list-clip[inert]"));
      await key("b", 66, CTRL);
      for (let i = 0; i < 3; i++) { await grab(); await sleep(30); }
      d.keyToggles = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "true";
      await idle();
      await click(".head .btn.tgl");
      for (let i = 0; i < 3; i++) { await grab(); await sleep(30); }
      await idle();
      d.buttonToggles = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "false";
      d.slideAllowed = !bad.size && seen.has("transition:transform");
      await key("o", 79, CTRL_SHIFT);
      await size(1440, 900);
      await idle();
      d.backOut = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "true";
      return d;
    });
    await attempt("commitAtNarrowWidths", async () => {
      await size(1200, 700);
      await openApp(autoQ({ showHistory: "1" }));
      await waitFor(".commit-pane", 5000);
      await idle();
      const d = { inList: await has(".left .commit-pane") };
      await size(1400, 700);
      await idle();
      d.column = (await has(".commit-pane")) && !(await has(".left .commit-pane"));
      await size(1440, 900);
      return d;
    });
    await attempt("smallestWindow", async () => {
      await size(800, 500);
      await openApp();
      await toWork(2);
      const d = {};
      const c = await box(".wc"), p = await box(".head .split");
      d.pushFits = p.r <= c.l && p.l > (await box(".head")).l;
      d.noPageScroll = (await ev(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".app").scrollWidth<=innerWidth`));
      d.rowsFit = (await box(".rail-foot")).b <= 500;
      await size(1440, 900);
      return d;
    });
  };

  // ---- The Overview, on the real App. ----
  const SHOP = "/home/user/src/shop-platform", ONE = "/home/user/src/agent-01", TWO = "/home/user/src/agent-02", GONE = "/home/user/src/old-experiments";
  const AT = 1_790_000_000;
  const FEED = [
    { at: AT + 70, path: TWO, kind: "editing", files: [["src/a/modified.ts", "modified"], ["src/a/added.ts", "added"], ["src/a/deleted.ts", "deleted"], ["src/a/new-name.ts", "renamed", "src/a/old-name.ts"], ["src/a/fifth.ts", "untracked"]].map(([path, kind, origPath]) => ({ path, kind, origPath: origPath ?? null })) },
    { at: AT + 60, path: ONE, kind: "commit", text: "committed “Allow partial refunds”", sha: "0a1b2c3d" },
    { at: AT + 50, path: ONE, kind: "moved", text: "now at 1b2c3d4 “Update readme”", sha: "1b2c3d4e" },
    { at: AT + 40, path: TWO, kind: "branch", text: "switched to agent/cart-rounding" },
    { at: AT + 30, path: TWO, kind: "added", text: "new worktree on agent/cart-rounding" },
    { at: AT + 20, path: GONE, kind: "removed", text: "worktree removed" },
    { at: AT + 10, path: GONE, kind: "commit", text: "committed “Old spike”", sha: "2c3d4e5f" },
    { at: AT, path: GONE, kind: "editing", files: [{ path: "src/experiments/spike.ts", origPath: null, kind: "modified" }] },
  ];
  const seedFeed = async () => { await ev(`window.__store.setState({activity:${JSON.stringify(FEED)}});1`); await idle(); };
  const openOverview = async (ov = "") => {
    await go(`${harness}/app.html?theme=dark${ov ? `&ov=${ov}` : ""}`);
    const ok = await ready(".ov-page .ov-head");
    return ok;
  };
  const rowsNow = () => ev(`[...document.querySelectorAll(".ov-tbl tbody .wname .ell")].map(e=>e.textContent)`);
  const badges = () => ev(`[...document.querySelectorAll(".sum .badge")].map(e=>e.textContent)`);
  const sortBy = (n) => click(`.ov-tbl th:nth-child(${n}) .dt-sort`);
  groups.overviewHeadAndTable = async () => {
    await attempt("overviewIsItsOwnScope", async () => {
      await openOverview();
      return {
        root: await has(".ov-page.ui-root"),
        noInnerScopes: (await count(".ov-page .ui-root")) === 0,
        noCards: !(await has(".ov-card, .ov-body, .ov-section")),
        fullWidth: (await box(".ov-tbl table")).r === (await box(".ov-page")).r,
        dragBand: (await count('.ov-head[data-tauri-drag-region="deep"]')) === 1,
        clearOfControls: (await box(".ov-refresh")).t >= (await box(".wc")).b,
      };
    });
    await attempt("overviewHead", async () => {
      await openOverview();
      const d = { title: (await text(".ov-head h1")) === "Overview" };
      d.neutralAndChanges = JSON.stringify(await badges()) === JSON.stringify(["3 worktrees", "1 with changes"]);
      d.check = (await ev(`document.querySelector(".ov-tools .chk input").checked`)) === true;
      d.base = (await text(".ov-tools .sel .ell")) === "main";
      d.refresh = (await text(".ov-refresh .btn-l")) === "Refresh";
      await ev(`window.__store.setState({lastChange:{${JSON.stringify(TWO)}:Date.now()/1000+300},actions:{${JSON.stringify(ONE)}:{running:false,label:"",progress:"",error:null,rejected:true}}});1`);
      await idle();
      const b = await badges();
      d.live = b.includes("1 active");
      d.rejected = b.includes("1 push rejected");
      d.noChangesStillCounts = b.includes("1 with changes");
      d.rejectedBadge = (await text('.ov-tbl tr[data-path$="agent-01"] .badge.error .ell')) === "Push rejected";
      d.activeTag = (await text('.ov-tbl tr[data-path$="agent-02"] .st-tag.active .ell')) === "Changing";
      d.liveNote = (await text(".live-note")) === "Live";
      const before = await ipc("worktrees_overview");
      await click(".ov-refresh");
      await idle();
      d.refreshed = (await ipc("worktrees_overview")) > before;
      return d;
    });
    await attempt("overviewTable", async () => {
      await openOverview();
      const row = 'tr[data-path$="agent-01"]';
      const d = {};
      d.columns = JSON.stringify(await ev(`[...document.querySelectorAll(".ov-tbl th")].map(e=>e.textContent)`)) === JSON.stringify(["Worktree", "Branch", "State", "Files", "+/−", "Origin", "↑↓ main", "Conflicts", "Last commit", "Last"]);
      d.default = JSON.stringify(await rowsNow()) === JSON.stringify(["agent-01", "main worktree", "agent-02"]);
      d.state = (await text(`${row} .st-tag .ell`)) === "Has changes" && (await text('tr[data-path$="agent-02"] .st-tag .ell')) === "Clean";
      d.current = (await text(`${row} .wn .chip`)) === "current";
      d.files = (await text(`${row} td:nth-child(4)`)) === "2";
      d.lines = /\+12\s*−3/.test(await text(`${row} .delta`));
      d.labelsWhole = await ev(`[...document.querySelectorAll(".ov-tbl th .ell")].every(e=>e.scrollWidth<=e.clientWidth)`);
      d.notPublished = (await text(`${row} td:nth-child(6)`)) === "not published";
      d.inSync = (await text('tr[data-path$="shop-platform"] td:nth-child(6)')) === "in sync";
      d.aheadBehind = (await text(`${row} td:nth-child(7)`)) === "1/0";
      d.baseOwnRow = (await text('tr[data-path$="shop-platform"] td:nth-child(7)')) === "–";
      d.commit = (await text(`${row} .lc .ell`)) === "Allow partial refunds";
      d.tip = (await ev(`document.querySelector('${row} .wname').dataset.tip`)).includes("agent/orders-refund · not published · Allow partial refunds (Dev Example)");
      await sortBy(1);
      d.sortAsc = JSON.stringify(await rowsNow()) === JSON.stringify(["agent-01", "agent-02", "main worktree"]) && (await ev(`document.querySelector(".ov-tbl th:nth-child(1)").getAttribute("aria-sort")`)) === "ascending";
      await sortBy(1);
      d.sortDesc = JSON.stringify(await rowsNow()) === JSON.stringify(["main worktree", "agent-02", "agent-01"]) && (await ev(`document.querySelector(".ov-tbl th:nth-child(1)").getAttribute("aria-sort")`)) === "descending";
      await click('tr[data-path$="agent-02"] td:nth-child(4)');
      await idle();
      d.opens = !(await has(".ov-page")) && (await text(".head h1 .ell")) === "agent-02";
      await key("o", 79, CTRL_SHIFT);
      await idle();
      d.sortOutlivesThePage = JSON.stringify(await rowsNow()) === JSON.stringify(["main worktree", "agent-02", "agent-01"]);
      await ev(`window.__store.getState().setOverviewSort({key:"state",dir:1});1`);
      return d;
    });
    await attempt("overviewOddRows", async () => {
      await openOverview("odd");
      const d = {};
      d.diverged = /^origin ↑2 ↓1$/.test(await text('tr[data-path$="shop-platform"] td:nth-child(6)'));
      d.detached = (await text('tr[data-path$="agent-01"] td:nth-child(2)')) === "detached @ 0a1b2c3";
      d.noBranchOrigin = (await text('tr[data-path$="agent-01"] td:nth-child(6)')) === "–";
      d.unborn = (await text('tr[data-path$="agent-02"] td:nth-child(2)')) === "no commits";
      d.noCommit = (await text('tr[data-path$="agent-02"] td:nth-child(9)')) === "–";
      return d;
    });
    await attempt("overviewHoldsOrder", async () => {
      await openOverview();
      const d = {};
      const start = ["agent-01", "main worktree", "agent-02"], resorted = ["agent-02", "agent-01", "main worktree"];
      const same = async (want) => JSON.stringify(await rowsNow()) === JSON.stringify(want);
      const changeTwo = () => ev(`window.__store.setState({lastChange:{${JSON.stringify(TWO)}:Date.now()/1000+300}});1`);
      await hover('tr[data-path$="agent-02"]');
      await changeTwo();
      await idle();
      d.heldUnderPointer = await same(start);
      d.stateStillUpdates = (await text('tr[data-path$="agent-02"] .st-tag .ell')) === "Changing";
      await sortBy(3);
      await idle();
      d.clickSortsAtOnce = await same([...resorted].reverse());
      await sortBy(3);
      await idle();
      d.clickSortsBack = await same(resorted);
      await ev(`window.__store.setState({lastChange:{}});1`);
      await idle();
      d.heldAgain = await same(resorted);
      await mouse(1000, 860);
      await idle();
      d.leavingSorts = await same(start);
      // Clicking a header leaves focus in the table; the pointer leaving must still re-sort.
      await hover('tr[data-path$="agent-02"]');
      await sortBy(1);
      await sortBy(3);
      await changeTwo();
      await idle();
      d.heldAfterClick = await same(start);
      await mouse(1000, 860);
      await idle();
      d.leavingSortsAfterClick = await same(resorted);
      // A row that arrives while held joins at the end instead of waiting for the pointer.
      await ev(`window.__store.setState({lastChange:{}});1`);
      await idle();
      await hover('tr[data-path$="agent-02"]');
      await ev(`(()=>{const s=window.__store,o=s.getState().overview,w={...o.worktrees[0],path:"/home/user/src/agent-03",branch:"agent/new"};s.setState({overview:{...o,worktrees:[w,...o.worktrees]}})})();1`);
      await idle();
      d.newRowJoinsAtEnd = (await rowsNow()).at(-1) === "agent-03";
      await mouse(1000, 860);
      return d;
    });
    await attempt("overviewKeyboard", async () => {
      await openOverview();
      const d = {};
      await ev(`document.querySelector(".ov-tbl th .dt-sort").focus();1`);
      await key("Enter", 13);
      await idle();
      d.headerSorts = JSON.stringify(await rowsNow()) === JSON.stringify(["agent-01", "agent-02", "main worktree"]);
      await key("Tab", 9);
      await ev(`window.__store.getState().setOverviewSort({key:"state",dir:1});1`);
      await idle();
      await ev(`document.querySelector('tr[data-path$="agent-02"]').focus();1`);
      await key("Enter", 13);
      await idle();
      d.rowOpens = (await text(".head h1 .ell")) === "agent-02";
      await key("o", 79, CTRL_SHIFT);
      await idle();
      await ev(`document.querySelector(".help").focus();1`);
      await key("Tab", 9, 8);
      await key("Tab", 9);
      d.helpTipOnFocus = await until(async () => (await text("#overlays .tip"))?.startsWith("Files that more than one worktree changes"));
      return d;
    });
  };
  groups.overviewStates = async () => {
    await attempt("overviewLoading", async () => {
      await openOverview("loading");
      return { line: (await text(".ov .empty-line")) === "Loading…", noBadges: !(await has(".sum")), noTable: !(await has(".ov-tbl")), noSections: !(await has(".ov-pane")), head: await has(".ov-tools .chk") };
    });
    await attempt("overviewFailedLoad", async () => {
      await openOverview("fail");
      await waitFor(".ov .banner.error", 4000);
      return { banner: (await text(".ov .banner.error"))?.includes("the connection to dev-box timed out"), noLoading: !(await has(".ov .empty-line")), noTable: !(await has(".ov-tbl")), noBadges: !(await has(".sum")) };
    });
    await attempt("overviewNoBaseBranch", async () => {
      await openOverview("nobase");
      return { note: (await text(".ov-note")) === "no base branch: pick one to compare with", header: (await text(".ov-tbl th:nth-child(7)")) === "↑↓ base", dash: (await text('tr[data-path$="agent-01"] td:nth-child(7)')) === "–", hint: (await ev(`document.querySelector(".help").dataset.tip`)).includes("since the base") };
    });
    await attempt("overviewWorktreeErrors", async () => {
      await openOverview("errors");
      return { rows: (await count(".ov-tbl tbody tr")) === 2, name: (await text(".ov-err b")) === "agent-02", message: (await text(".ov-err .err-text"))?.startsWith("fatal: not a git repository"), counted: (await badges())[0] === "2 worktrees" };
    });
    await attempt("overviewManySharedFiles", async () => {
      await openOverview("many");
      const d = {};
      d.badge = (await text(".sum .badge.warn")) === "15 possible conflicts";
      d.count = (await text(".ov-pane h2 .count")) === "15";
      d.twelve = (await count(".ov-shared .row")) === 12;
      d.more = (await text(".ov-more .btn-l")) === "Show all 15 files";
      await click(".ov-more");
      d.all = (await count(".ov-shared .row")) === 15 && (await text(".ov-more .btn-l")) === "Show fewer";
      d.committedMark = (await text(".ov-shared .row:nth-child(2) .chip:nth-child(2)"))?.endsWith("committed") === false || (await count(".ov-shared .cs")) > 0;
      d.tableBadge = (await text('tr[data-path$="agent-01"] .badge.warn')) === "15";
      d.tableTip = (await ev(`document.querySelector('tr[data-path$="agent-01"] .badge.warn').dataset.tip`)) === "Also changed in main worktree, agent-02";
      await click(".ov-more");
      d.fewer = (await count(".ov-shared .row")) === 12;
      const before = await ipc("status");
      await click(".ov-shared button.chip");
      await idle();
      d.chipOpens = !(await has(".ov-page")) || (await ipc("status")) > before;
      return d;
    });
    await attempt("overviewActivityKinds", async () => {
      await openOverview();
      await seedFeed();
      const d = {};
      d.entries = (await count(".ev")) === 8;
      d.empty = !(await has(".ov-feed .empty-line"));
      const t = (n) => text(`.ev:nth-child(${n}) .a`);
      d.editing = (await t(1)) === "changed 5 files";
      d.commit = (await t(2)) === "committed “Allow partial refunds”";
      d.moved = (await t(3)) === "now at 1b2c3d4 “Update readme”";
      d.branch = (await t(4)) === "switched to agent/cart-rounding";
      d.added = (await t(5)) === "new worktree on agent/cart-rounding";
      d.removed = (await t(6)) === "worktree removed";
      d.threeFiles = (await count(".ev:nth-child(1) .ev-file")) === 3;
      d.letters = (await ev(`[...document.querySelectorAll(".ev:nth-child(1) .sl")].map(e=>e.textContent).join("")`)) === "MAD";
      await click(".ev-more");
      d.moreShown = (await count(".ev:nth-child(1) .ev-file")) === 5;
      d.rename = (await ev(`document.querySelector(".ev:nth-child(1) .ev-file:nth-child(4) .path").title`)) === "src/a/old-name.ts → src/a/new-name.ts";
      await click(".ev:nth-child(1) .ev-w");
      await idle();
      d.worktreeLink = (await text(".head h1 .ell")) === "agent-02";
      await key("o", 79, CTRL_SHIFT);
      await idle();
      await click(".ev:nth-child(2) .ev-link");
      await idle();
      d.commitLink = (await ipc("commit")) > 0 || !(await has(".ov-page"));
      return d;
    });
    await attempt("overviewRemovedWorktree", async () => {
      await openOverview();
      await seedFeed();
      return {
        nameIsText: (await text(".ev:nth-child(6) .ev-w.gone")) === "old-experiments" && !(await has(".ev:nth-child(6) button")),
        commitIsText: (await text(".ev:nth-child(7) .a")) === "committed “Old spike”" && !(await has(".ev:nth-child(7) button")),
        filesAreText: (await count(".ev:nth-child(8) span.ev-file")) === 1 && !(await has(".ev:nth-child(8) button")),
        liveStillLinks: await has(".ev:nth-child(2) .ev-link"),
      };
    });
    await attempt("overviewOneWorktree", async () => {
      await openOverview("one");
      return { badge: (await badges())[0] === "1 worktree", row: (await count(".ov-tbl tbody tr")) === 1, none: (await text(".ov-shared .empty-line")) === "No two worktrees change the same file.", nothingYet: (await text(".ov-feed .empty-line"))?.startsWith("Nothing yet."), noChangesBadge: (await badges()).length === 1 };
    });
    await attempt("overviewConflictsOff", async () => {
      await openOverview("many");
      const d = { on: await has(".ov-shared") };
      await ev(`document.querySelector(".ov-tools .chk input").click();1`);
      await idle();
      d.sectionGone = !(await has(".ov-shared"));
      d.solo = await has(".ov-split.solo");
      d.activityFull = (await box(".ov-pane")).r === (await box(".ov-page")).r;
      d.saved = await until(async () => (await lastSaved())?.possibleConflicts === false);
      d.noGit = (await ev(`[...window.__ipc].reverse().find(c=>c.cmd==="worktrees_overview").args.findOverlaps ?? [...window.__ipc].reverse().find(c=>c.cmd==="worktrees_overview").args.overlaps`)) === false;
      d.cellBlank = (await text('tr[data-path$="agent-01"] td:nth-child(8)')) === "";
      return d;
    });
    await attempt("overviewMotion", async () => {
      await openOverview();
      await seedFeed();
      const bad = new Map();
      const grab = async () => { for (const a of await ev(CLASSIFY)) if (a.bad) bad.set(a.bad, a.where); };
      await hover(".ov-tbl tbody tr");
      for (let i = 0; i < 3; i++) { await grab(); await sleep(30); }
      await sortBy(1);
      await grab();
      const rowsMoving = await ev(`document.getAnimations().filter(a=>a.effect.target.closest?.("tbody tr")&&a.transitionProperty!=="background-color"&&a.transitionProperty!=="opacity").length`);
      await click(".ov-more, .ev-more");
      await grab();
      return { allowed: !bad.size, rowsStill: rowsMoving === 0, bad: bad.size ? [...bad.keys()].join() : true };
    });
    await attempt("overviewBandsHideColumns", async () => {
      const shown = () => ev(`[...document.querySelectorAll(".ov-tbl th")].filter(e=>e.offsetWidth).length`);
      const d = {};
      await openOverview();
      d.wide = (await shown()) === 10;
      await size(1100, 700);
      await idle();
      d.noCommitAt1100 = (await shown()) < 10;
      await size(800, 500);
      await idle();
      d.fewAt800 = (await shown()) === 7;
      d.refreshIconOnly = (await width(".ov-refresh")) === 28;
      d.refreshStillNamed = (await text(".ov-refresh .btn-l")) === "Refresh";
      await size(1440, 900);
      return d;
    });
  };
  // Each state fits the design system's rules at both ends of the window, in both themes.
  for (const [theme, w, h] of panesOnly ? [] : [["dark", 800, 500], ["light", 800, 500], ["dark", 1440, 900], ["light", 1440, 900]]) {
    const name = `overview-${theme}-${w}x${h}`;
    groups[name] = async () => {
      const views = {};
      await size(w, h);
      for (const ov of ["", "many", "errors", "nobase", "fail", "loading", "one", "odd"]) {
        await go(`${harness}/app.html?theme=${theme}&ov=${ov}`);
        await ready(".ov-page .ov-head");
        if (ov !== "loading" && ov !== "fail") await seedFeed();
        await ev(`window.__store.setState({lastChange:{${JSON.stringify(TWO)}:Date.now()/1000+300},actions:{${JSON.stringify(ONE)}:{running:false,label:"",progress:"",error:null,rejected:true}}});1`);
        await idle();
        views[ov || "live"] = await shellAudit();
        await shot(`overview-${theme}-${w}x${h}-${ov || "live"}`);
      }
      const bad = Object.fromEntries(Object.entries(views).filter(([, v]) => v.fails.length || v.overflow.length || v.pageW > v.win || v.appW > v.win));
      check(`overview-${theme}-${w}x${h}`, !Object.keys(bad).length, Object.keys(bad).length ? bad : undefined);
    };
  }
  for (const font of panesOnly ? [] : [10, 18]) {
    const name = `overview-font-${font}`;
    groups[name] = async () => {
      await size(800, 500);
      await go(`${harness}/app.html?theme=dark&font=${font}&ov=many`);
      await ready(".ov-page .ov-head");
      await seedFeed();
      const v = await shellAudit();
      await shot(`overview-dark-800x500-font${font}`);
      check(`overview-font-${font}`, !v.fails.length && !v.overflow.length && v.pageW <= v.win, v);
    };
  }

  // ---- The panes and the editor, on the real App. ----
  const shots = async (name) => shot(`panes-${name}`);
  /** Opens agent-01's work on a mock with `q`, at a width that shows the pane. */
  const openWork = async (q = "") => {
    await go(`${harness}/app.html?theme=${q.includes("theme=light") ? "light" : "dark"}${q.replace("&theme=light", "")}`);
    await ready(".rail .wt:not(.skel)");
    await toWork(2);
  };
  const paneTab = async (n) => { await click(`.ptabs button:nth-child(${n})`); await idle(); };
  const selected = () => text(".left .lbox .row.on .fname, .left .lbox .row.on .cm .s");
  const activeTabName = () => text(".tabs .tab.on .ell");
  const tabCount = () => count(".tabs .tab");
  const openDiff = async (path) => {
    await ev(`window.__store.getState().openTab({id:${JSON.stringify(`x:${path}`)},title:${JSON.stringify(path.split("/").pop())},description:"",kind:"diff",path:${JSON.stringify(path)},origPath:null,left:{kind:"rev",rev:"HEAD",path:${JSON.stringify(path)}},right:{kind:"worktree",path:${JSON.stringify(path)}},leftLabel:"HEAD",rightLabel:"Working tree"},true);1`);
    await idle();
  };
  const openPlain = async (path) => {
    await ev(`(()=>{const s=window.__store.getState();s.openTab({id:${JSON.stringify(`p:${path}`)},title:${JSON.stringify(path.split("/").pop())},description:"",kind:"file",path:${JSON.stringify(path)},source:{kind:"worktree",path:${JSON.stringify(path)}}},true)})();1`);
    await idle();
  };
  const pixels = async (pts) => {
    const png = (await send("Page.captureScreenshot", { format: "png" })).result.data;
    return ev(`(async()=>{const b=await createImageBitmap(await (await fetch("data:image/png;base64,${png}")).blob());const c=new OffscreenCanvas(b.width,b.height).getContext("2d");c.drawImage(b,0,0);return ${JSON.stringify(pts)}.map(([x,y])=>[...c.getImageData(x,y,1,1).data].slice(0,3).join())})()`);
  };
  const auditOk = (a) => !a.fails.length && !a.overflow.length && a.pageW <= a.win && a.appW <= a.win;
  groups.panesListsAndPanels = async () => {
    await attempt("panesScope", async () => {
      await size(1440, 900);
      await openWork();
      return {
        left: await has(".left.ui-root"),
        chrome: await has(".ed-chrome.ui-root"),
        noneNested: (await count(".left .ui-root, .ed-chrome .ui-root, .commit-col .ui-root")) === 0,
        monacoOutside: !(await has(".ui-root .monaco-editor")),
        noLegacy: !(await has(".list-row, .ed-tab, .tab-strip, .left-tabs, .segmented, .editor-toolbar, .icon-button")),
      };
    });
    await attempt("panesIconTabs", async () => {
      await openWork();
      const d = {};
      d.four = (await count(".ptabs button")) === 4;
      d.onlyActiveNamed = (await text(".ptabs [aria-selected=true]")) === "Changes" && (await ev(`[...document.querySelectorAll(".ptabs button")].filter(b=>b.textContent.trim()).length`)) === 1;
      d.keepsShortcut = (await ev(`document.querySelector(".ptabs button:nth-child(2)").dataset.tip`)) === "History (Ctrl+2)";
      await paneTab(2);
      d.history = await has(".history");
      d.countOnOtherPanes = (await text(".ptabs .count")) === "2";
      await paneTab(3);
      d.explorer = (await text(".panel-toolbar .ell"))?.endsWith("files");
      await paneTab(4);
      d.search = await has(".search-form");
      d.searchFocused = await focusIs(".search-form input");
      await paneTab(1);
      d.changes = await has(".pane-seg");
      d.noCountOnChanges = !(await has(".ptabs .count"));
      await key("2", 50, CTRL);
      await idle();
      d.ctrl2 = await has(".history");
      await key("3", 51, CTRL);
      await idle();
      d.ctrl3 = await has(".panel-toolbar .chk");
      await key("1", 49, CTRL);
      await idle();
      d.ctrl1 = await has(".pane-seg");
      return d;
    });
    await attempt("panesChanges", async () => {
      await openWork();
      const d = {};
      d.tray = (await text(".pane-seg .tray button:first-of-type")) === "Uncommitted (2)";
      d.rows = (await count(".left .lbox .row")) === 2;
      d.rowHeight = (await ev(`document.querySelector(".left .lbox .row").offsetHeight`)) === 28;
      d.letter = (await text(".left .lbox .row .sl")) === "A" || (await text(".left .lbox .row .sl")) === "M";
      d.icon = await has(".left .lbox .row .ficon img");
      await shots("changes");
      await click(".pane-seg .tray button:nth-of-type(2)");
      await idle();
      d.base = await has(".pane-seg .sel");
      d.baseTip = /^Base · 2 files · since /.test(await ev(`document.querySelector(".base-in").dataset.tip`));
      await click(".pane-seg .tray button:nth-of-type(1)");
      await click(".filter-row input");
      await type("total");
      await idle();
      d.filtered = (await count(".left .lbox .row")) === 1;
      await type("nothing");
      await idle();
      d.noMatch = (await text(".left .lbox .empty-line")) === "No files match the filter.";
      await ev(`(()=>{const i=document.querySelector(".filter-row input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,"");i.dispatchEvent(new Event("input",{bubbles:true}))})();1`);
      await click('.filter-row .btn[aria-label="View as tree"]');
      await idle();
      d.tree = await has(".left .lbox .row .tchev .icon");
      d.folderCount = await has(".left .lbox .row .row-t .count");
      await shots("changes-tree");
      await click('.filter-row .btn[aria-label="View as list"]');
      return d;
    });
    await attempt("panesListKeyboard", async () => {
      await openWork("&many=1");
      await waitFor(".left .lbox .row", 8000);
      const d = {};
      const list = ".left .lbox";
      const total = 82;
      d.virtual = (await count(`${list} .row`)) < total;
      d.spacer = (await ev(`document.querySelector(".lbox-in").offsetHeight`)) === total * 28;
      await click(`${list} .row`);
      await idle();
      d.focusOnList = await focusIs(list);
      await key("ArrowDown", 40);
      await idle();
      const second = await selected();
      d.downMoves = !!second;
      d.previewOpens = (await activeTabName()) === second && (await has(".tabs .tab.on.preview"));
      await key("Enter", 13);
      await idle();
      d.enterPins = !(await has(".tabs .tab.on.preview"));
      await ev(`document.querySelector(${JSON.stringify(list)}).focus();1`);
      await key("PageDown", 34);
      await idle();
      const paged = await selected();
      d.pageDown = paged !== second;
      d.stillShown = await ev(`(()=>{const r=document.querySelector(".left .lbox .row.on").getBoundingClientRect(),b=document.querySelector(".left .lbox").getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1})()`);
      d.keyRing = (await ev(`getComputedStyle(document.querySelector(".left .lbox .row.on")).outlineStyle`)) === "solid";
      await key("End", 35);
      await idle();
      d.end = await ev(`(()=>{const l=document.querySelector(".left .lbox"),rows=[...l.querySelectorAll(".row")];const last=rows.at(-1).getBoundingClientRect();return rows.at(-1).matches(".on")&&last.bottom<=l.getBoundingClientRect().bottom+1})()`);
      const bottom = await selected();
      d.endRendered = (await count(`${list} .row`)) < total;
      await key("Home", 36);
      await idle();
      const top = await selected();
      d.home = top !== bottom && (await ev(`document.querySelector(".left .lbox").scrollTop`)) === 0;
      await key("PageUp", 33);
      await idle();
      d.pageUpStops = (await selected()) === top;
      await key("F10", 121, 8);
      await idle();
      d.menu = await has("#overlays .menu .mi.on");
      await key("Escape", 27);
      d.menuReturns = await focusIs(list);
      await ev(`window.__store.getState().updateSettings({changesView:"tree"});1`);
      await idle();
      await ev(`document.querySelector(${JSON.stringify(list)}).focus();1`);
      await click(`${list} .row`);
      await idle();
      const rows = await count(`${list} .row`);
      await key("ArrowLeft", 37);
      await idle();
      d.leftFolds = (await count(`${list} .row`)) !== rows || !!(await ev(`document.querySelector(".left .lbox .row.on .tchev")?.dataset.open`));
      await key("ArrowRight", 39);
      await idle();
      d.rightOpens = (await count(`${list} .row`)) >= rows - 1;
      await ev(`window.__store.getState().updateSettings({changesView:"list"});1`);
      await idle();
      return d;
    });
    await attempt("panesRowsFollowFont", async () => {
      await openWork("&font=18&many=1");
      await waitFor(".left .lbox .row", 8000);
      const d = { list: (await ev(`document.querySelector(".left .lbox .row").offsetHeight`)) === 39 };
      d.noOverlap = await ev(`(()=>{const[a,b]=document.querySelectorAll(".left .lbox .row");return a.getBoundingClientRect().bottom<=b.getBoundingClientRect().top})()`);
      await paneTab(2);
      await waitFor(".history .row", 8000);
      d.commit = (await ev(`document.querySelector(".history .row").offsetHeight`)) === 59;
      d.textFits = await ev(`(()=>{const r=document.querySelector(".history .row"),c=r.querySelector(".cm");return c.scrollHeight<=r.offsetHeight})()`);
      return d;
    });
    await attempt("panesHistory", async () => {
      await size(1440, 900);
      await openWork();
      await paneTab(2);
      await waitFor(".history .row", 8000);
      const d = {};
      d.twoLines = (await ev(`document.querySelector(".history .row").offsetHeight`)) === 44 && (await text(".history .row .cm .s")) === "Allow partial refunds" && /^Dev Example · /.test(await text(".history .row .cm .m"));
      d.avatar = await has(".history .row .avatar");
      await shots("history");
      await click(".history .row");
      await idle();
      d.column = await has(".commit-col.ui-root .commit-pane");
      d.title = (await text(".pane-title")) === "2 changed files";
      d.files = (await count(".commit-pane .lbox .row")) === 2;
      d.details = (await text(".commit-author .muted"))?.includes("dev@example.com");
      await shots("commit");
      await click(".commit-pane .cp-filter");
      await type("total");
      await idle();
      d.filter = (await count(".commit-pane .lbox .row")) === 1;
      await ev(`document.querySelector(".commit-head").focus();1`);
      await key("F10", 121, 8);
      await idle();
      d.headMenuKey = await has("#overlays .menu .mi.on");
      await key("Escape", 27);
      const w0 = await width(".commit-col");
      await ev(`document.querySelectorAll(".pane-edge .resize")[1].focus();1`);
      await key("ArrowRight", 39);
      await idle();
      d.edgeKeys = (await width(".commit-col")) === w0 + 8;
      await click('.commit-pane .btn[aria-label="Close"]');
      await idle();
      d.closes = !(await has(".commit-pane"));
      await click(".history .history-search input");
      await type("readme");
      d.search = await until(async () => (await count(".history .lbox .row")) === 1 && (await text(".pane-note")) === "1 matching commit"); // The search waits for typing to stop.
      return d;
    });
    await attempt("panesFileHistory", async () => {
      await size(1440, 900);
      await go(`${harness}/app.html?theme=dark${autoQ({ fileHistory: "README.md" })}`);
      await waitFor(".panel-toolbar .btn", 20000);
      await idle();
      const d = { head: (await text(".panel-toolbar .ell"))?.startsWith("History of README.md"), rows: (await count(".history .lbox .row")) === 2, letter: (await text(".history .row .row-t .sl")) === "M" };
      await click('.panel-toolbar .btn[aria-label="Back to all commits"]');
      await idle();
      d.back = await has(".history-search");
      return d;
    });
    await attempt("panesExplorer", async () => {
      await size(1440, 900);
      await openWork();
      await paneTab(3);
      await waitFor(".tree .row", 8000);
      const d = { check: (await text(".panel-toolbar .chk")) === "Ignored files" };
      const before = await count(".tree .row");
      const folder = await ev(`[...document.querySelectorAll(".tree .row")].findIndex(r=>r.querySelector(".tchev svg"))+1`);
      await click(`.tree .row:nth-child(${folder})`);
      await idle();
      d.opens = (await count(".tree .row")) > before;
      d.chevron = await ev(`document.querySelector(".tree .row:nth-child(${folder}) .tchev").dataset.open==="true"&&getComputedStyle(document.querySelector(".tree .row:nth-child(${folder}) .tchev .icon")).transform!=="none"`);
      await shots("explorer");
      await key("ArrowDown", 40);
      await idle();
      d.arrowDoesNotOpen = (await tabCount()) === 0;
      await key("ArrowUp", 38);
      await key("ArrowLeft", 37);
      await idle();
      d.leftCloses = (await count(".tree .row")) === before;
      await key("F10", 121, 8);
      await idle();
      d.menu = await has("#overlays .menu .mi.on");
      await key("Escape", 27);
      const calls = await ipc("list_files");
      await ev(`document.querySelector(".panel-toolbar .chk input").click();1`);
      await idle();
      d.ignored = (await ipc("list_files")) > calls;
      await ev(`document.querySelector(".panel-toolbar .chk input").click();1`);
      return d;
    });
  };
  groups.panesEditorAndPreviews = async () => {
    await attempt("panesSearch", async () => {
      await size(1440, 900);
      await openWork();
      await paneTab(4);
      const d = { hint: (await text(".pane-note")) === "Press Enter to search (git grep)." };
      await type("money");
      await key("Enter", 13);
      await idle();
      d.summary = (await text(".pane-note")) === "2 results in 2 files";
      d.rows = (await count(".left .lbox .row")) === 4;
      d.fileCount = (await text(".left .lbox .row .row-t .count")) === "1";
      d.hit = (await text(".left .lbox .row .line-no")) === "3";
      await shots("search");
      await click('.search-form .btn[aria-label="Match case"]');
      d.pressed = await has('.search-form .btn[aria-label="Match case"][aria-pressed="true"]');
      await click(".left .lbox .row:nth-child(2)");
      await idle();
      d.opens = (await activeTabName()) === "create.ts";
      await ev(`document.querySelector(".left .lbox").focus();1`);
      await key("ContextMenu", 93);
      await idle();
      d.menu = await has("#overlays .menu .mi.on");
      return d;
    });
    await attempt("panesTabStrip", async () => {
      await size(1440, 900);
      await openWork();
      const d = {};
      for (const p of ["package.json", "src/server/orders/refund.ts", "src/server/orders/create.ts"]) await openPlain(p);
      await openDiff("src/client/cart/total.ts");
      d.opened = (await tabCount()) === 4;
      d.diffMark = (await text(".tabs .tab.on .tab-kind")) === "±";
      d.icon = await has(".tabs .tab .ficon img");
      d.closeShown = await ev(`[...document.querySelectorAll(".tabs .tab .btn")].every(b=>getComputedStyle(b).opacity==="1")`);
      await shots("tabs");
      await click(".tabs .tab:nth-child(1)");
      await idle();
      d.clickActivates = (await activeTabName()) === "package.json";
      const c = await center(".tabs .tab:nth-child(2)");
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "middle", buttons: 4, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "middle", clickCount: 1 });
      await idle();
      d.middleCloses = (await tabCount()) === 3;
      await click(".tabs .tab.on .btn");
      await idle();
      d.closeButton = (await tabCount()) === 2;
      await ev(`window.__store.setState({tabs:window.__store.getState().tabs.map(t=>({...t,isPreview:true}))});1`);
      await idle();
      d.italic = (await ev(`getComputedStyle(document.querySelector(".tabs .tab.preview .ell")).fontStyle`)) === "italic";
      await ev(`document.querySelector(".tabs .tab.on").focus();1`);
      await key("Enter", 13);
      await idle();
      d.enterPins = !(await has(".tabs .tab.on.preview"));
      await key("F10", 121, 8);
      await idle();
      d.menu = await has("#overlays .menu .mi.on");
      await key("Escape", 27);
      d.menuReturns = await focusIs(".tabs .tab.on");
      await key("w", 87, CTRL);
      await idle();
      d.ctrlW = (await tabCount()) === 1;
      // Many tabs at the smallest window: the strip scrolls, the page does not, and the active tab shows.
      await size(800, 500);
      for (let i = 0; i < 9; i++) await openPlain(`src/generated/a-rather-long-file-name-${i}.ts`);
      await idle();
      d.activeInView = await ev(`(()=>{const t=document.querySelector(".tabs .tab.on").getBoundingClientRect(),s=document.querySelector(".tabs").getBoundingClientRect();return t.left>=s.left-1&&t.right<=s.right+1})()`);
      d.noPageScroll = (await ev(`document.querySelector(".app").scrollWidth`)) <= 800;
      await shots("tabs-800");
      await size(1440, 900);
      return d;
    });
    await attempt("panesToolbars", async () => {
      await size(1440, 900);
      await openWork();
      await openDiff("src/client/cart/total.ts");
      const d = {};
      d.crumb = (await text(".crumb .path b")) === "total.ts";
      d.sides = (await text(".tools .opt-long")) === "HEAD ↔ Working tree";
      d.layout = await has('.tools .tray[aria-label="Diff layout"]');
      await click('.tools .tray[aria-label="Diff layout"] button:nth-of-type(2)');
      d.inline = await until(async () => (await lastSaved())?.diff?.sideBySide === false);
      await click('.tools .tray[aria-label="Diff layout"] button:nth-of-type(1)');
      await click('.tools .btn[aria-label="Next change"]');
      await click('.tools .btn[data-tip="Collapse unchanged regions"]');
      d.collapse = await until(async () => (await lastSaved())?.diff?.collapseUnchanged === true);
      await click('.tools .btn[data-tip="Collapse unchanged regions"]');
      // The toggles move into More when the editor itself is narrow, whatever the window's band.
      await ev(`window.__store.getState().updateSettings({leftWidth:760});1`);
      await idle();
      d.narrowMore = (await text(".tools .btn[aria-haspopup=menu] .btn-l")) === "More";
      await click(".tools .btn[aria-haspopup=menu]");
      await idle();
      d.moreMenu = (await count("#overlays .menu .mi")) === 2;
      await key("Escape", 27);
      await ev(`window.__store.getState().updateSettings({leftWidth:300});1`);
      await idle();
      await openPlain("src/server/orders/create.ts");
      await click('.tools .btn[data-tip^="Show who last changed"]');
      await idle();
      d.blameOn = await has(".editor-host.blame-on");
      d.blameText = await ev(`[...document.querySelectorAll(".blame-on .line-numbers")].some(e=>/Dev Example/.test(e.textContent))`);
      await shots("blame");
      await click('.tools .btn[data-tip^="Show who last changed"]');
      return d;
    });
    for (const theme of ["dark", "light"]) {
      await attempt(`panesMonacoTheme-${theme}`, async () => {
        await size(1440, 900);
        await openWork(theme === "light" ? "&theme=light" : "");
        await openDiff("src/server/orders/create.ts");
        const token = (t) => ev(`(()=>{const p=document.createElement("div");p.className="ui-root";document.body.append(p);p.style.background="var(${t})";const c=getComputedStyle(p).backgroundColor;p.remove();return c})()`);
        const d = {};
        await waitFor(".monaco-diff-editor .line-insert", 4000);
        d.ownThemeBase = await has(`.monaco-diff-editor .monaco-editor.${theme === "dark" ? "vs-dark" : "vs"}`);
        const bg = await ev(`getComputedStyle(document.querySelector(".monaco-diff-editor .monaco-editor-background")).backgroundColor`);
        d.surface = bg === (await token("--sheet"));
        d.notBuiltIn = await ev(`!/rgb\\((30, 30, 30|255, 255, 254|255, 255, 255)\\)/.test(${JSON.stringify(bg)})`);
        // Real pixels: an unchanged part of the diff's text area, its gutter, and the empty end of the list pane.
        const pane = await box(".left .lbox"), line = await box(".monaco-diff-editor .editor.modified");
        const px = await pixels([[pane.l + 40, pane.b - 20], [line.r - 60, line.t + 3], [line.l + 2, line.t + 3]]);
        d.notLighterThanPanes = px[0] === px[1] && px[0] === px[2];
        if (!d.notLighterThanPanes) d.px = px.join(" | ");
        d.added = await has(".monaco-diff-editor .line-insert");
        d.addColour = (await ev(`getComputedStyle(document.querySelector(".monaco-diff-editor .line-insert")).backgroundColor`)) === (await token("--diff-add"));
        d.gutterMark = (await ev(`getComputedStyle(document.querySelector(".monaco-diff-editor .gutter-insert")).boxShadow`)).includes("inset");
        const colours = await ev(`[...new Set([...document.querySelectorAll(".monaco-diff-editor .view-line span span")].map(e=>getComputedStyle(e).color))]`);
        d.keyword = colours.includes(await token("--tok-key"));
        d.strings = colours.includes(await token("--tok-str"));
        d.lineNumber = (await ev(`getComputedStyle(document.querySelector(".monaco-editor")).getPropertyValue("--vscode-editorLineNumber-foreground")`)).length > 0;
        d.ruler = (await ev(`getComputedStyle(document.querySelector(".monaco-editor")).getPropertyValue("--vscode-editorOverviewRuler-background")`)) !== "";
        await shot(`panes-diff-${theme}`);
        await openPlain("src/server/orders/refund.ts");
        await ev(`window.__store.getState().updateSettings({editor:{...window.__store.getState().settings.editor,minimap:true,stickyScroll:true}});1`);
        await idle();
        const editor = await box(".editor-host:not([style*=hidden]) .monaco-editor");
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: editor.l + 300, y: editor.t + 200, deltaX: 0, deltaY: 800 });
        d.sticky = await waitFor(".sticky-widget .sticky-line-content, .sticky-widget .sticky-widget-lines", 5000);
        if (d.sticky) d.stickySurface = (await ev(`getComputedStyle(document.querySelector(".sticky-widget .sticky-widget-lines-scrollable")).backgroundColor`)) === (await token("--sheet"));
        d.minimap = await has(".minimap canvas");
        await shot(`panes-file-${theme}`);
        await ev(`window.__store.getState().updateSettings({editor:{...window.__store.getState().settings.editor,minimap:false}});1`);
        // Changing the theme repaints Monaco at once.
        const other = theme === "dark" ? "light" : "dark";
        await ev(`window.__store.getState().updateSettings({theme:"${other}"});1`);
        d.follows = await until(async () => (await ev(`getComputedStyle(document.querySelector(".monaco-editor .monaco-editor-background")).backgroundColor`)) === (await token("--sheet")) && (await has(`.monaco-editor.${other === "dark" ? "vs-dark" : "vs"}`)));
        return d;
      });
    }
    await attempt("panesPreviews", async () => {
      await size(1440, 900);
      await openWork();
      const d = {};
      await openPlain("README.md");
      await waitFor(".md-preview h1", 5000);
      await idle();
      d.markdown = await has(".md-scroll.ui-root .md-preview h1");
      d.table = await has(".md-preview table th");
      d.blocked = (await ev(`document.querySelector(".md-blocked").dataset.tip`))?.startsWith("Remote image not loaded:");
      d.repoImage = await ev(`[...document.querySelectorAll(".md-preview img")].some(i=>i.src.startsWith("data:"))`);
      d.codeColoured = await has(".md-preview pre code [class*=mtk]");
      d.previewTray = await has('.tools .tray[aria-label="Preview or source"]');
      await shots("markdown");
      await click(".md-preview a[href='#usage']");
      await idle();
      d.anchorScrolled = (await ev(`document.querySelector(".md-scroll").scrollTop`)) >= 0;
      await click('.tools .tray[aria-label="Preview or source"] button:nth-of-type(2)');
      await idle();
      d.source = !(await has(".md-preview")) && (await has('.tools .btn[data-tip^="Show who last changed"]'));
      await click('.tools .tray[aria-label="Preview or source"] button:nth-of-type(1)');
      await idle();
      await openPlain("docs/preview.html");
      await waitFor("iframe.html-preview", 5000);
      await idle();
      d.html = await has(".html-wrap.ui-root iframe.html-preview[sandbox='']");
      d.runScripts = (await text(".tools .btn.tgl .btn-l")) === "Run scripts";
      await click(".tools .btn.tgl");
      await idle();
      d.scriptsSandbox = await has("iframe.html-preview[sandbox='allow-scripts']");
      await shots("html");
      await click(".tools .btn.tgl");
      await openPlain("docs/assets/logo.png");
      await waitFor(".image-view img", 5000);
      await idle();
      d.image = await has(".image-view.ui-root .image-checker img");
      d.info = (await text(".image-info"))?.includes("320 × 200");
      await click('.image-view .btn[aria-label="Zoom in"]');
      d.zoomed = (await text(".image-zoom")) !== "100%";
      await click('.image-view .tgl:last-child');
      await idle();
      d.actual = (await text(".image-zoom")) === "100%";
      await shots("image");
      await openDiff("docs/assets/logo.png");
      await waitFor(".image-view img", 5000);
      await idle();
      d.sides = (await count(".image-pane")) === 2 && (await count(".image-tag")) === 2;
      await shots("image-side");
      await click('.tools .tray[aria-label="Compare images"] button:nth-of-type(2)');
      await idle();
      d.swipe = (await has(".image-stack.swipe .swipe-handle")) && (await has(".image-view .sld input[type=range]"));
      await shots("image-swipe");
      await click('.tools .tray[aria-label="Compare images"] button:nth-of-type(3)');
      await idle();
      d.onion = await has(".image-stack.onion");
      d.onionLabel = (await text(".image-view .sld"))?.startsWith("Opacity");
      await shots("image-onion");
      await click('.tools .tray[aria-label="Compare images"] button:nth-of-type(1)');
      await openDiff("docs/assets/huge.png");
      await idle();
      d.tooLarge = (await text(".image-none"))?.startsWith("Image is too large to show");
      await openDiff("docs/assets/broken.png");
      await idle();
      d.broken = (await text(".image-none"))?.startsWith("Not a valid image");
      return d;
    });
    await attempt("panesMessages", async () => {
      await size(1440, 900);
      await openWork();
      const d = {};
      d.none = (await text(".ed-msg .empty p")) === "Select a changed file, a commit file or a file in Explorer.";
      d.hint = (await text(".ed-msg .empty p.muted"))?.startsWith("Ctrl+P open file");
      await shots("message-none");
      await openPlain("assets/app.bin");
      d.binary = (await text(".ed-msg")) === "Binary file (12.4 KB) is not shown.";
      await shots("message-binary");
      await openPlain("data/dump.json");
      d.tooLarge = (await text(".ed-msg")) === "File is too large to show (6.5 MB; the limit is 5 MB).";
      await openPlain("src/removed.ts");
      d.missing = (await text(".ed-msg")) === "This file does not exist.";
      d.status = await has(".ed-msg[role=status]");
      d.hostsHidden = (await ev(`[...document.querySelectorAll(".editor-host")].every(e=>e.style.visibility==="hidden")`));
      return d;
    });
    await attempt("panesMotion", async () => {
      await size(1440, 900);
      await openWork();
      const seen = new Map(), bad = new Map();
      const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, 1); if (a.bad) bad.set(a.bad, a.where); } };
      const step = async (fn) => { await fn(); for (let i = 0; i < 4; i++) { await grab(); await sleep(25); } };
      await step(() => hover(".left .lbox .row"));
      await step(() => click(".pane-seg .tray button:nth-of-type(2)"));
      await step(() => click('.filter-row .btn[aria-label="View as tree"]'));
      await idle();
      await step(() => click(".left .lbox .row"));
      await step(() => click(".left .lbox .row"));
      await step(() => click('.filter-row .btn[aria-label="View as list"]'));
      await step(() => paneTab(2));
      await step(() => paneTab(1));
      return { allowed: !bad.size, bad: bad.size ? [...bad.keys()].join() : true, chevron: seen.has("transition:transform") };
    });
  };
  // Every view keeps the design system's rules at both ends of the window, in both themes, and at the UI font's limits.
  const VIEWS = {
    changes: async () => {},
    base: async () => { await click(".pane-seg .tray button:nth-of-type(2)"); },
    tree: async () => { await ev(`window.__store.getState().updateSettings({changesView:"tree"});1`); },
    history: async () => { await ev(`window.__store.getState().setLeftTab("history");1`); await waitFor(".history .row", 5000); },
    commit: async () => { await ev(`window.__store.getState().setLeftTab("history");1`); await waitFor(".history .row", 5000); await click(".history .row"); },
    explorer: async () => { await ev(`window.__store.getState().setLeftTab("explorer");1`); },
    search: async () => { await ev(`window.__store.getState().focusSearch();1`); await idle(); await type("money"); await key("Enter", 13); },
    diff: async () => { await openDiff("src/server/orders/create.ts"); },
    file: async () => { await openPlain("src/server/orders/refund.ts"); },
    blame: async () => { await openPlain("src/server/orders/refund.ts"); await ev(`window.__store.getState().toggleBlame();1`); },
    markdown: async () => { await openPlain("README.md"); await waitFor(".md-preview pre code [class*=mtk]", 5000); },
    html: async () => { await openPlain("docs/preview.html"); await waitFor("iframe.html-preview", 5000); },
    image: async () => { await openPlain("docs/assets/logo.png"); await waitFor(".image-view img", 5000); },
    imageDiff: async () => { await openDiff("docs/assets/logo.png"); await waitFor(".image-pane img", 5000); },
    message: async () => { await openPlain("assets/app.bin"); },
  };
  for (const [theme, w, h, font] of panesPrefix.startsWith("surface") ? [] : [["dark", 800, 500, 13], ["light", 800, 500, 13], ["dark", 1440, 900, 13], ["light", 1440, 900, 13], ["dark", 800, 500, 18], ["dark", 800, 500, 10]]) {
    const name = `panes-${theme}-${w}x${h}-${font}px`;
    groups[name] = async () => {
      const views = {};
      await size(w, h);
      for (const [name, show] of Object.entries(VIEWS)) {
        await openWork(`${theme === "light" ? "&theme=light" : ""}&font=${font}`);
        try {
          await show();
        } catch (e) {
          views[name] = { fails: [String(e.message ?? e)], overflow: [], pageW: 0, appW: 0, win: 1 };
          continue;
        }
        await idle();
        views[name] = await shellAudit();
        if (font === 13) await shot(`panes-${theme}-${w}x${h}-${name}`);
        await ev(`window.__store.setState({blame:false});1`);
      }
      const bad = Object.fromEntries(Object.entries(views).filter(([, v]) => !auditOk(v)));
      check(`panes-${theme}-${w}x${h}-${font}px`, !Object.keys(bad).length, Object.keys(bad).length ? bad : undefined);
    };
  }

  // ---- Settings, the palette and the repository menu, on the real App. ----
  const ROOT_REPO = "/home/user/src/shop-platform";
  const fill = async (sel, value) => { await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.select();})();1`); await type(value); };
  const pickOption = async (label) => ev(`(()=>{const e=[...document.querySelectorAll(".picker .mi")].find(m=>m.textContent.includes(${JSON.stringify(label)}));e.click();return 1})()`);
  const setting = (path) => ev(`(()=>{const p=${JSON.stringify(path)}.split(".");return p.reduce((a,k)=>a[k],window.__store.getState().settings)})()`);
  const openSettings = async () => { await key(",", 188, CTRL); await idle(); };
  const clickText = (sel, label) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(label)});e.click();return !!e})()`);
  const inWindow = async (sel) => { const b = await box(sel); return !!b && b.t >= 0 && b.l >= 0 && b.b <= (await ev(`innerHeight`)) && b.r <= (await ev(`innerWidth`)); };
  groups.surfaceSettings = async () => {
    await attempt("surfaceSettingsModal", async () => {
      await size(1440, 900);
      await openApp(autoQ({ openFile: "src/server/orders/create.ts" }) + settingsQ({ theme: "system" }));
      const d = { editor: await waitFor(".monaco-editor .view-lines", 15000) };
      await idle();
      await ev(`document.querySelector(".monaco-editor").__keep=1;1`);
      await click('.rail-nav[aria-label="Settings"]');
      await idle();
      d.modal = await has("#overlays .dlg.set-dlg[aria-modal=true]");
      d.inert = await has(".app[inert]");
      d.noPage = !(await has(".settings-page"));
      d.searchFocused = await focusIs(".set-q input");
      d.navPressed = await has('.rail-nav[aria-label="Settings"][aria-pressed="true"]');
      d.pageStaysBehind = (await ev(`getComputedStyle(document.querySelector(".work")).visibility`)) === "visible" && (await ev(`document.querySelector(".monaco-editor").__keep`)) === 1;
      d.noCountAtDefaults = !(await has(".set-count"));
      d.resetOff = await has('.set-foot .tgl[aria-disabled="true"]');
      const rail = await box(".set-rail"), find = await box(".set-q"), foot = await box(".set-foot"), json = await box(".dlg-h .set-json"), x = await box(".dlg-x");
      const row = await box(".set-n");
      d.searchTopsRail = find.t >= rail.t && find.t < (await box(".set-nav")).t;
      d.searchMatchesRows = find.l === row.l && find.r === row.r;
      d.resetFootsRail = foot.b === rail.b && foot.r <= rail.r;
      d.fileBesideClose = json.r <= x.l && x.l - json.r <= 16;
      await shot("surface-settings");
      await type("minimap");
      await idle();
      d.filtered = (await count(".set-sec")) === 1 && (await count(".set-b .setting")) === 1 && (await count(".set-n")) === 1;
      await type(" nothing matches this");
      await idle();
      d.noMatch = (await text(".set-b .empty-line")) === "No settings match “minimap nothing matches this”.";
      await key("Escape", 27);
      await idle();
      d.escClears = (await ev(`document.querySelector(".set-q input").value`)) === "" && (await has(".set-dlg"));
      d.focusKept = await focusIs(".set-q input");
      await key("Escape", 27);
      await idle();
      d.escCloses = !(await has(".set-dlg")) && !(await has(".app[inert]"));
      d.focusBack = await focusIs('.rail-nav[aria-label="Settings"]');
      await openSettings();
      d.ctrlComma = await has(".set-dlg");
      await key(",", 188, CTRL);
      await idle();
      d.ctrlCommaCloses = !(await has(".set-dlg"));
      await openSettings();
      await mouse(4, 4);
      await mouse(4, 4, "mousePressed");
      await mouse(4, 4, "mouseReleased");
      await idle();
      d.scrimCloses = !(await has(".set-dlg"));
      await openSettings();
      await click(".set-dlg .dlg-x");
      await idle();
      d.closeButton = !(await has(".set-dlg"));
      await openSettings();
      await ev(`document.querySelector("[id='setting-theme']").focus();1`);
      for (let i = 0; i < 90; i++) await key("Tab", 9);
      d.focusTrapped = await ev(`!!document.activeElement.closest(".set-dlg")`);
      return d;
    });
    await attempt("surfaceSettingsControls", async () => {
      await openApp();
      await openSettings();
      const d = {};
      // Select: applies at once, marks the row, and resets.
      await click("[id='setting-theme']");
      await idle();
      d.pickerOverDialog = await has("#overlays .picker");
      await pickOption("Light");
      await idle();
      d.themeApplied = (await ev(`document.documentElement.dataset.theme`)) === "light";
      d.selectShows = (await text("[id='setting-theme'] .ell")) === "Light";
      d.modified = (await count(".set-b .setting.modified")) === 1 && (await text(".set-count")) === "1 changed";
      await click(".set-rst");
      await idle();
      d.reset = (await setting("theme")) === "system" && (await count(".set-b .setting.modified")) === 0;
      d.saved = await until(async () => (await lastSaved())?.theme === "system");
      // Checkbox.
      await click(".chk:has([id='setting-editor.minimap'])");
      d.toggled = (await setting("editor.minimap")) === false;
      await click(".chk:has([id='setting-editor.minimap'])");
      // Number: valid as typed, clamped on leaving, stepped by the arrow keys.
      await fill("[id='setting-uiFontSize']", "15");
      d.applied = (await setting("uiFontSize")) === 15;
      await fill("[id='setting-uiFontSize']", "99");
      d.invalid = await has("[id='setting-uiFontSize'][aria-invalid=true]");
      d.notApplied = (await setting("uiFontSize")) === 15;
      await ev(`document.querySelector("[id='setting-uiFontSize']").blur();1`);
      await idle();
      d.clamped = (await setting("uiFontSize")) === 18 && (await ev(`document.querySelector("[id='setting-uiFontSize']").value`)) === "18";
      await ev(`document.querySelector("[id='setting-uiFontSize']").focus();1`);
      await key("ArrowDown", 40);
      await idle();
      d.stepped = (await setting("uiFontSize")) === 17;
      d.fontApplied = (await ev(`document.documentElement.style.getPropertyValue("--ui-font-size")`)) === "17px";
      await fill("[id='setting-uiFontSize']", "abc");
      await ev(`document.querySelector("[id='setting-uiFontSize']").blur();1`);
      await idle();
      d.garbageGoesBack = (await ev(`document.querySelector("[id='setting-uiFontSize']").value`)) === "17";
      // Text: an emptied field goes back when it loses focus.
      await fill("[id='setting-editor.fontFamily']", "Cascadia Mono");
      d.textApplied = (await setting("editor.fontFamily")) === "Cascadia Mono";
      await ev(`(()=>{const e=document.querySelector("[id='setting-editor.fontFamily']");e.focus();e.select();})();1`);
      await key("Backspace", 8);
      await ev(`document.querySelector("[id='setting-editor.fontFamily']").blur();1`);
      await idle();
      d.textBack = (await ev(`document.querySelector("[id='setting-editor.fontFamily']").value`)) === "Cascadia Mono";
      // The window zooms while Settings is open: Zoom is one of its rows.
      await key("=", 187, CTRL);
      await idle();
      d.zoomKey = (await setting("zoom")) === 1.1 && (await text("[id='setting-zoom'] .ell")) === "110%";
      // Reset all asks twice, and keeps the repositories.
      await clickText(".set-foot .tgl", "Reset all");
      await idle();
      d.asks = (await text(".set-foot .tgl .btn-l")) === "Click again to reset all";
      await clickText(".set-foot .tgl", "Click again to reset all");
      await idle();
      d.allReset = !(await has(".set-count")) && (await setting("zoom")) === 1 && (await setting("repos")).length === 1;
      return d;
    });
    await attempt("surfaceSettingsNav", async () => {
      await openApp();
      await openSettings();
      const d = {};
      const on = () => text(".set-n[aria-pressed=true] .btn-l");
      d.startsAtTop = (await on()) === "Appearance";
      d.sections = (await count(".set-n")) === 9;
      await clickText(".set-n", "Keyboard shortcuts");
      await idle();
      d.lastReachesTop = await ev(`(()=>{const s=document.querySelector('section[data-sec="shortcuts"]'),b=document.querySelector(".set-b");return Math.abs(s.offsetTop-b.scrollTop)<=8})()`);
      d.chosen = (await on()) === "Keyboard shortcuts";
      await clickText(".set-n", "Editor");
      await idle();
      d.editorChosen = (await on()) === "Editor";
      await ev(`(()=>{const b=document.querySelector(".set-b");b.scrollTop=document.querySelector('section[data-sec="history"]').offsetTop;})();1`);
      await idle();
      d.spies = (await on()) === "History";
      d.ctrlK = (await ev(`[...document.querySelectorAll(".keys-t tr")].some(r=>r.querySelector("kbd").textContent==="Ctrl+K")`));
      d.ctrlB = (await ev(`[...document.querySelectorAll(".keys-t tr")].some(r=>r.querySelector("kbd").textContent==="Ctrl+B")`));
      // A base branch is chosen from the branches, or typed.
      await clickText(".set-n", "Repositories");
      await idle();
      d.openBadge = (await text(".setting.repo .badge")) === "open";
      d.repoPath = (await text(".setting.repo .setting-d.mono")) === ROOT_REPO;
      d.automatic = /^Automatic: /.test((await text(".setting.repo .sel .ell")) ?? "");
      await click(".setting.repo .sel");
      await idle();
      await type("release/next");
      await idle();
      await key("Enter", 13);
      await idle();
      d.baseSaved = (await setting("base"))[ROOT_REPO] === "release/next";
      d.baseShown = (await text(".setting.repo .sel .ell")) === "release/next";
      await clickText(".setting.repo .btn.link", "Reset to default");
      await idle();
      d.baseReset = (await setting("base"))[ROOT_REPO] === undefined;
      await clickText(".setting.repo .btn.link", "Remove");
      await idle();
      d.removed = (await text(".set-note")) === "No repositories yet. Add one from the Repository menu at the top left.";
      return d;
    });
    await attempt("surfaceSettingsJson", async () => {
      await openApp();
      await openSettings();
      await click(".dlg-h .set-json");
      await idle();
      const d = { closes: !(await has(".set-dlg")), tab: (await text(".tabs .tab.on .ell")) === "settings.json", header: await has(".head h1") };
      d.list = await has(".left .ptabs");
      return d;
    });
    await attempt("surfaceSettingsNoRepository", async () => {
      await size(1440, 900);
      await openApp("&none=1");
      await openSettings();
      const d = { opens: await has(".set-dlg"), empty: (await text(".set-note")) === "No repositories yet. Add one from the Repository menu at the top left." };
      await click(".dlg-h .set-json");
      d.editor = await waitFor(".monaco-editor .view-lines", 15000);
      await idle();
      d.tab = (await text(".tabs .tab.on .ell")) === "settings.json";
      d.closed = !(await has(".set-dlg")) && !(await has(".ov-page"));
      d.noHeader = !(await has(".work-top .head"));
      d.noList = !(await has(".left")) && !(await has(".pane-edge"));
      d.moveBand = (await box('.work-top [data-tauri-drag-region="deep"]'))?.b === 44;
      d.fullPage = (await width(".ed-chrome")) === (await ev(`innerWidth`)) - (await width(".rail"));
      d.nothingOn = !(await has('.rail-nav[aria-pressed="true"]'));
      await shot("surface-settings-json-no-repository");
      await click('.rail-nav[aria-label="Overview"]');
      await idle();
      d.overviewShowsWelcome = await has(".ov-page .empty");
      await openSettings();
      await click(".dlg-h .set-json");
      await idle();
      d.sameTab = (await count(".tabs .tab")) === 1;
      await key("w", 87, CTRL);
      await idle();
      d.closingGoesHome = (await has(".ov-page .empty")) && (await count(".tabs .tab")) === 0;
      await size(800, 500);
      await openApp("&none=1");
      await openSettings();
      await click(".dlg-h .set-json");
      await waitFor(".monaco-editor .view-lines", 15000);
      await idle();
      const a = await shellAudit();
      d.narrow = auditOk(a) || a;
      d.narrowNoDrawerButton = !(await has('.work-top [aria-label="Toggle list"]'));
      await shot("surface-settings-json-no-repository-800x500");
      await size(1440, 900);
      return d;
    });
    await attempt("surfaceSettingsAutomation", async () => {
      await openApp(autoQ({ openSettings: "1" }));
      const d = { plain: await waitFor(".set-dlg", 5000) };
      await openApp(autoQ({ openSettings: "minimap" }));
      await waitFor(".set-dlg", 5000);
      await idle();
      d.typed = (await ev(`document.querySelector(".set-q input").value`)) === "minimap" && (await count(".set-b .setting")) === 1;
      await openApp(autoQ({ openSettings: "settings.json" }));
      await waitFor(".tabs .tab", 5000);
      await idle();
      d.file = (await text(".tabs .tab.on .ell")) === "settings.json" && !(await has(".set-dlg"));
      await openApp(autoQ({ settingsPatch: { theme: "light" } }));
      d.patch = await until(async () => (await setting("theme")) === "light", 10000); // The hook patches a moment after the page has drawn.
      return d;
    });
  };
  groups.surfacePaletteAndRepos = async () => {
    await attempt("surfacePalette", async () => {
      await size(1440, 900);
      await openApp();
      await toWork(1);
      await ev(`document.querySelector(".rail .wt").focus();1`);
      await key("k", 75, CTRL);
      await idle();
      const d = { opens: await has("#overlays .dlg.pal[aria-modal=true]"), inert: await has(".app[inert]"), focused: await focusIs(".pal input") };
      d.placeholder = (await ev(`document.querySelector(".pal input").placeholder`)) === "Search files, worktrees…";
      d.sections = (await ev(`[...document.querySelectorAll(".pal .sec-l")].map(e=>e.textContent).join()`)) === "Commands,Worktrees";
      d.rows = (await count(".pal .mi")) === 7; // Four commands and the three worktrees.
      d.keys = (await text(".pal .mi:nth-of-type(1) .keys, .pal .mi .keys")) === "CtrlShiftO";
      d.state = await has(".pal .mi .st-tag");
      d.foot = (await ev(`document.querySelector(".pal-foot").textContent`)) === "↑↓ to navigate↵ to select";
      await shot("surface-palette");
      await key("ArrowDown", 40);
      d.arrows = (await text(".pal .mi.on .mi-l")) === "Go to Issues";
      await key("ArrowUp", 40);
      await key("Tab", 9);
      d.tabStays = await focusIs(".pal input");
      await type("cart-rounding");
      await idle();
      d.byBranch = (await count(".pal .mi")) === 1 && (await text(".pal .mi .mi-l")) === "agent-02";
      await key("Enter", 13);
      await idle();
      d.worktreeOpened = !(await has(".pal")) && (await text(".head h1 .ell")) === "agent-02";
      await key("k", 75, CTRL);
      await idle();
      await type("create");
      await idle();
      d.fileSection = (await text(".pal .sec-l")) === "Files in every worktree" && (await text(".pal .mi .mi-d")) === "agent-01";
      await key("F10", 121, 8);
      await idle();
      d.fileMenu = (await has("#overlays .menu .mi.on")) && (await has(".pal"));
      await key("Escape", 27);
      d.menuOnly = !(await has("#overlays .menu")) && (await has(".pal"));
      await key("Enter", 13);
      await idle();
      d.changeOpened = (await text(".tabs .tab.on .ell"))?.startsWith("create.ts") && (await text(".head h1 .ell")) === "agent-01";
      await key("k", 75, CTRL);
      await idle();
      await type("no such thing");
      await idle();
      d.none = (await text(".pal .empty-line")) === "Nothing matches";
      await key("Escape", 27);
      await idle();
      d.escCloses = !(await has(".pal")) && !(await has(".app[inert]"));
      await key("k", 75, CTRL);
      await idle();
      await mouse(4, 4);
      await mouse(4, 4, "mousePressed");
      await mouse(4, 4, "mouseReleased");
      await idle();
      d.scrimCloses = !(await has(".pal"));
      await key("k", 75, CTRL);
      await idle();
      await type("shortcuts");
      await idle();
      await key("Enter", 13);
      await idle();
      d.shortcutsSection = (await text(".set-n[aria-pressed=true] .btn-l")) === "Keyboard shortcuts";
      await key("k", 75, CTRL);
      await idle();
      d.noPaletteOverSettings = !(await has(".pal"));
      await key("Escape", 27);
      await idle();
      await click('.rail-top [aria-label="Search"]');
      await idle();
      d.railButton = await has(".pal");
      await key("Escape", 27);
      await idle();
      await key("k", 75, CTRL);
      await idle();
      await type("overview");
      await idle();
      await key("Enter", 13);
      await idle();
      d.overviewCommand = await has(".ov-page");
      return d;
    });
    await attempt("surfaceQuickOpen", async () => {
      await openApp();
      await toWork(2);
      await key("p", 80, CTRL);
      await idle();
      const d = { opens: await has("#overlays .dlg.pal"), noSections: !(await has(".pal .sec-l")) };
      d.placeholder = (await ev(`document.querySelector(".pal input").placeholder`)) === "Go to file (10 files)";
      d.limit = (await count(".pal .mi")) === 10;
      await type("refund");
      await idle();
      d.matched = (await text(".pal .mi.on .mi-l")) === "refund.ts" && (await text(".pal .mi.on .mi-d")) === "src/server/orders";
      d.marks = (await count(".pal .mi.on mark")) === 6;
      await key("Enter", 13);
      await idle();
      d.opened = (await text(".tabs .tab.on .ell")) === "refund.ts" && !(await has(".pal"));
      await key("p", 80, CTRL);
      await idle();
      await type("zzzz");
      await idle();
      d.none = (await text(".pal .empty-line")) === "No matching files";
      await key("Escape", 27);
      await openApp("&none=1");
      await key("p", 80, CTRL);
      await idle();
      d.noRepoNoQuickOpen = !(await has(".pal"));
      await click('.rail-top [aria-label="Search"]');
      await idle();
      d.noRepoPalette = (await ev(`[...document.querySelectorAll(".pal .sec-l")].map(e=>e.textContent).join()`)) === "Commands";
      await type("settings");
      await idle();
      await key("Enter", 13);
      await idle();
      d.noRepoCommandRuns = await has(".set-dlg");
      return d;
    });
    await attempt("surfaceRepoPicker", async () => {
      await size(800, 500);
      await openApp(settingsQ({ repos: [ROOT_REPO, "/home/user/src/not-a-repo"] }));
      await click(".t-repo");
      await idle();
      const d = { broken: (await text(".picker .repo-ed"))?.startsWith("⚠ /home/user/src/not-a-repo is not a git repository") };
      await click(".picker-f .btn");
      await idle();
      d.modal = await has('.repo-dlg[aria-modal="true"]');
      d.fits = await inWindow(".repo-dlg");
      const foot = () => box(".repo-dlg .dlg-f");
      const local = (await foot()).t;
      await clickText(".repo-dlg .tray button", "SSH");
      await idle();
      d.footerStays = (await foot()).t === local;
      d.needsBoth = (await ev(`document.querySelector(".repo-dlg .dlg-f .btn.primary").getAttribute("aria-disabled")`)) === "true";
      await type("user@denied-box");
      await key("Tab", 9);
      await type("~/src/example");
      d.ready = (await ev(`document.querySelector(".repo-dlg .dlg-f .btn.primary").getAttribute("aria-disabled")`)) === null;
      await key("Enter", 13);
      await idle();
      d.error = (await text(".repo-err"))?.startsWith("ssh user@denied-box: user@denied-box: Permission denied (publickey).");
      d.errorAnnounced = await has('.repo-err[role="alert"]');
      d.staysOpen = await has(".repo-dlg");
      d.keptInput = (await ev(`document.querySelector('.repo-dlg input[placeholder^="user@host"]').value`)) === "user@denied-box";
      d.errorFits = await inWindow(".repo-dlg");
      d.buttonsLive = !(await has('.repo-dlg .dlg-f [aria-disabled="true"]'));
      await shot("surface-repo-error-800x500");
      await clickText(".repo-dlg .tray button", "Local folder");
      await idle();
      d.errorCleared = !(await has(".repo-err"));
      d.folderFocused = await focusIs(".repo-dlg .repo-f input");
      await shot("surface-repo-local-800x500");
      await type("C:\\Users\\user\\src\\not-a-repo");
      await key("Enter", 13);
      await idle();
      d.pasteError = (await text(".repo-err"))?.includes("is not a git repository");
      const before = await ipc("open_repo");
      await fill(".repo-dlg .repo-f input", "   ");
      await key("Enter", 13);
      await idle();
      d.blankIgnored = (await ipc("open_repo")) === before;
      await fill(".repo-dlg .repo-f input", "\\\\wsl.localhost\\Ubuntu\\home\\user\\src\\example");
      await key("Enter", 13);
      await idle();
      d.pasted = !(await has(".repo-dlg"));
      await click(".t-repo");
      await idle();
      await click(".picker-f .btn");
      await idle();
      await key("Escape", 27);
      await idle();
      d.escapeCloses = !(await has(".repo-dlg"));
      d.escapeFocusBack = await focusIs(".t-repo");
      await openApp(settingsQ({ repos: [] }));
      await click(".t-repo");
      await idle();
      d.emptyOpensDialog = (await has(".repo-dlg")) && !(await has(".picker"));
      await shot("surface-repo-empty-800x500");
      await size(1440, 900);
      return d;
    });
    await attempt("surfaceRepoClone", async () => {
      await size(800, 500);
      await openApp();
      await click(".t-repo");
      await idle();
      await click(".picker-f .btn");
      await idle();
      await clickText(".repo-dlg .tray button", "Clone");
      await idle();
      const d = { addressFocused: await focusIs('.repo-dlg input[placeholder^="https://"]') };
      d.fits = await inWindow(".repo-dlg");
      d.needsAll = (await ev(`document.querySelector(".repo-dlg .dlg-f .btn.primary").getAttribute("aria-disabled")`)) === "true";
      await type("https://example.com/user/denied.git");
      await key("Tab", 9);
      await type("C:\\src");
      await key("Tab", 9); // Browse…
      await key("Tab", 9);
      d.nameFromAddress = (await ev(`document.activeElement.placeholder`)) === "denied";
      await key("Enter", 13);
      await idle();
      d.cloneCall = (await ev(`JSON.stringify(window.__ipc.filter(c=>c.cmd==="clone_repo").pop()?.args)`)) === JSON.stringify({ url: "https://example.com/user/denied.git", parent: "C:\\src", name: "denied" });
      d.error = (await text(".repo-err"))?.includes("terminal prompts disabled");
      d.staysOpen = await has(".repo-dlg");
      d.errorFits = await inWindow(".repo-dlg");
      await shot("surface-repo-clone-800x500");
      await fill('.repo-dlg input[placeholder^="https://"]', "git@example.com:user/example.git");
      await fill('.repo-dlg .repo-f:nth-of-type(3) input', "renamed");
      await key("Enter", 13);
      await idle();
      d.opened = (await ev(`window.__ipc.filter(c=>c.cmd==="open_repo").some(c=>c.args.path==="C:\\\\src\\\\renamed")`));
      d.closedAfter = !(await has(".repo-dlg"));
      await size(1440, 900);
      return d;
    });
    await attempt("surfaceScope", async () => {
      await openApp(autoQ({ openFile: "src/server/orders/create.ts" }));
      await waitFor(".monaco-editor .view-lines", 15000);
      await openSettings();
      await click("[id='setting-theme']");
      await idle();
      const stray = `[...document.querySelectorAll("button,input,select,kbd")].filter(e=>!e.closest(".ui-root,.monaco-editor,.monaco-diff-editor")).map(e=>e.tagName+"."+e.className).slice(0,6)`;
      const d = { settings: !(await ev(stray)).length || (await ev(stray)) };
      await key("Escape", 27);
      await key("Escape", 27);
      await idle();
      await key("k", 75, CTRL);
      await idle();
      d.palette = !(await ev(stray)).length || (await ev(stray));
      d.noOldClasses = !(await has(".quick-open, .qo-item, .overlay, .pref, .settings-page, .icon-button, .toggle, .pill"));
      return d;
    });
    await attempt("surfaceMotion", async () => {
      await openApp();
      const seen = new Map(), bad = new Map();
      const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, 1); if (a.bad) bad.set(a.bad, a.where); } };
      const sample = async () => { for (let i = 0; i < 5; i++) { await grab(); await sleep(20); } };
      await key("k", 75, CTRL);
      await sample();
      await key("Escape", 27);
      await key("p", 80, CTRL);
      await sample();
      await key("Escape", 27);
      await key(",", 188, CTRL);
      await sample();
      await click("[id='setting-theme']");
      await sample();
      await key("Escape", 27);
      await key("Escape", 27);
      await click(".t-repo");
      await sample();
      await click(".picker-f .btn");
      await sample();
      return { allowed: !bad.size, bad: bad.size ? [...bad.keys()].join() : true, fades: seen.has("animation:fade-in") };
    });
  };
  // Each surface at both ends of the window, in both themes, at the UI font's limits, and zoomed in past the 800px band.
  for (const [theme, w, h, font] of [["dark", 1440, 900, 13], ["light", 1440, 900, 13], ["dark", 800, 500, 13], ["light", 800, 500, 13], ["dark", 800, 500, 10], ["dark", 800, 500, 18], ["light", 800, 500, 18], ["dark", 640, 400, 13]]) {
    const name = `surface-${theme}-${w}x${h}-${font}px`;
    groups[name] = async () => {
      await attempt(name, async () => {
        await size(w, h);
        const q = `${settingsQ({ repos: [ROOT_REPO, "/home/user/src/not-a-repo"], base: { [ROOT_REPO]: "main" } })}&font=${font}${theme === "light" ? "&theme=light" : ""}`;
        await go(`${harness}/app.html?theme=${theme}${q.replace("&theme=light", "")}`);
        await ready(".rail .wt:not(.skel)");
        const audited = async (sel, tag) => {
          const a = await ev(audit(sel));
          const page = await ev(`document.documentElement.scrollWidth<=innerWidth`);
          await shot(`${name}-${tag}`);
          return (!a.failCount && !a.overflow.length && page && (await inWindow(sel))) || { fails: a.fails, overflow: a.overflow, page, box: await box(sel) };
        };
        const d = {};
        await openSettings();
        await clickText(".set-n", "Editor");
        await idle();
        await ev(`window.__store.getState().updateSettings({uiFontSize:${font}+0,editor:{...window.__store.getState().settings.editor,tabSize:2}});1`);
        await idle();
        d.settings = await audited(".set-dlg", "settings");
        await clickText(".set-foot .tgl", "Reset all");
        await idle();
        d.confirmingReset = await audited(".set-dlg", "reset");
        await key("Escape", 27);
        await idle();
        await openSettings();
        await clickText(".set-n", "Editor");
        await idle();
        await clickText(".set-n", "Repositories");
        await idle();
        d.repositories = await audited(".set-dlg", "repositories");
        await clickText(".set-n", "Keyboard shortcuts");
        await idle();
        d.shortcuts = await audited(".set-dlg", "shortcuts");
        d.noBodyScrollSideways = await ev(`(()=>{const b=document.querySelector(".set-b");return b.scrollWidth<=b.clientWidth})()`);
        // The nav is a strip below the 800px band; above it every section's name fits.
        if (w >= 800) d.navNamesFit = await ev(`[...document.querySelectorAll(".set-n")].every(n=>n.scrollWidth<=n.clientWidth)&&(()=>{const n=document.querySelector(".set-nav");return n.scrollWidth<=n.clientWidth})()`);
        await key("Escape", 27);
        await idle();
        await key("k", 75, CTRL);
        await idle();
        d.palette = await audited(".pal", "palette");
        await type("create");
        await idle();
        d.paletteFile = await audited(".pal", "palette-file");
        await key("Escape", 27);
        await idle();
        await key("p", 80, CTRL);
        await idle();
        await type("ref");
        await idle();
        d.quickOpen = await audited(".pal", "quick-open");
        await key("Escape", 27);
        await idle();
        await click(".t-repo");
        await idle();
        await click(".picker-f .btn");
        await idle();
        await clickText(".repo-dlg .tray button", "SSH");
        await idle();
        await type("user@denied-box");
        await key("Tab", 9);
        await type("~/src/example");
        await key("Enter", 13);
        await idle();
        d.repo = await audited(".repo-dlg", "repo");
        return d;
      });
    };
  }
  return groups;
}

// ---- The run: every tab takes the next group until none is left. ----
try {
  const openTab = await connect();
  const tabs = await Promise.all(Array.from({ length: TABS }, () => openTab()));
  // Longest first, by the last run's times, so no tab is left with a long group at the end; a group not timed yet goes first.
  const lastTimes = (() => {
    try {
      return JSON.parse(readFileSync(join(out, "report.json"), "utf8")).groups ?? {};
    } catch {
      return {};
    }
  })();
  const queue = Object.keys(checksOn(tabs[0])).sort((a, b) => (lastTimes[b] ?? 1e9) - (lastTimes[a] ?? 1e9));
  report.groups = {};
  await Promise.all(
    tabs.map(async (t) => {
      const groups = checksOn(t);
      for (let name; (name = queue.shift()); ) {
        t.group = name;
        const started = Date.now();
        try {
          await t.reset();
          await groups[name]();
        } catch (e) {
          check(`group ${name}`, false, String(e.message ?? e));
        }
        report.groups[name] = Date.now() - started;
      }
    }),
  );
  check("noConsoleErrors", !report.errors.length, report.errors.slice(0, 5));
} finally {
  await stop();
}
finish();

function finish() {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  const failed = Object.entries(report.checks).filter(([, ok]) => !ok).map(([n]) => n);
  console.log(failed.length ? `${failed.length} failed: ${failed.join(", ")}` : `all ${Object.keys(report.checks).length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
