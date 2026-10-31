// Checks the design system against the harness page (harness/) in headless Edge: text contrast, layout at the window's smallest size,
// the motion allow-list, reduced motion, forbidden wording, and that nothing of it reaches the production bundle.
// No window opens and no OS input is sent. Runs at below-normal priority. Screenshots and report.json go to target/ui-check.
//   node scripts/ui-check.mjs          everything except the bundle check
//   pnpm build && node scripts/ui-check.mjs --bundle
// Set EDGE_PATH when Edge is not in its usual place.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants, setPriority, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); // Edge inherits it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "target", "ui-check");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { checks: {}, detail: {}, errors: [] };
const check = (name, ok, detail) => {
  report.checks[name] = !!ok;
  if (!ok || detail) report.detail[name] = detail;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const sources = [...walk(join(root, "src", "ui")), ...walk(join(root, "harness"))].filter((f) => /\.(css|tsx?|html)$/.test(f) && !f.endsWith(".test.tsx"));
const sourceText = sources.map((f) => readFileSync(f, "utf8")).join("\n");

// ---- Static checks ----
const KEPT = ["fade-in", "pie", "turn", "blur-in", "blur-out", "rail-slide"];
const frames = [...sourceText.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
check("onlyKeptKeyframes", frames.every((n) => KEPT.includes(n)), frames.filter((n) => !KEPT.includes(n)));
const scripted = [".animate(", "startViewTransition", "::view-transition"].filter((s) => sourceText.includes(s));
check("noScriptedAnimation", !scripted.length, scripted);
const WORDING = [["Needs review", /Needs review/], ["review as a state", /\breview\b/i], ["Next file", /Next file/], ["Done, next worktree", /Done, next worktree/], ["Open in terminal", /Open in terminal/], ["Compare", /\bCompare\b(?! images)/], ["Try again", /Try again/], ["viewed", /\bviewed\b/]];
const forbidden = (text) => WORDING.filter(([, r]) => r.test(text)).map(([n]) => n);
check("noForbiddenWording", !forbidden(sourceText).length, forbidden(sourceText));

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
const app=document.querySelector("#app"),fails=[],sizes={};let n=0;
const w=document.createTreeWalker(app,NodeFilter.SHOW_TEXT);
while(w.nextNode()){const t=w.currentNode;if(!t.nodeValue.trim())continue;const e=t.parentElement;if(e.closest(".sr,svg"))continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;const c=getComputedStyle(e);if(c.visibility==="hidden"||c.opacity==="0")continue;
 let op=1;for(let p=e;p;p=p.parentElement)op*=+getComputedStyle(p).opacity;
 if(e.closest(':disabled,[aria-disabled="true"],.chk.off')||op<.02)continue; // inactive controls are exempt from the text contrast rule
 const bg=bgOf(e),fg=norm(c.color);fg.a*=op;const q=ratio(over(fg,bg),bg);n++;const fs=parseFloat(c.fontSize);sizes[fs]=(sizes[fs]||0)+1;
 if(q<4.5)fails.push({t:t.nodeValue.trim().slice(0,28),q:+q.toFixed(2),fs,cls:String(e.className).slice(0,24),par:String(e.parentElement.className).slice(0,24)})}
const a=app.getBoundingClientRect(),clip=[];
app.querySelectorAll("*").forEach(e=>{if(e.closest("svg,.sr,.glide,.tabs"))return;const r=e.getBoundingClientRect();if(!r.width)return;if((r.right>a.right+1||r.left<a.left-1)&&getComputedStyle(e).visibility!=="hidden")clip.push(String(e.className).slice(0,30))});
app.querySelectorAll(".badge,.badge *,.count,.btn,kbd,.tray>button").forEach(e=>{if(e.closest(".sr,svg")||!e.offsetWidth)return;if(e.scrollWidth>e.clientWidth+1)clip.push("TRUNCATED "+e.textContent.trim().slice(0,20))});
app.querySelectorAll(".btn:not(.link),.field,.row,.badge,.count,.tray>button").forEach(e=>{if(e.closest(".sr,svg")||!e.offsetWidth||!e.textContent.trim()||e.tagName==="INPUT")return;const s=document.createRange();s.selectNodeContents(e);const t=s.getBoundingClientRect();if(t.height>e.getBoundingClientRect().height+1)clip.push("TALL "+e.textContent.trim().slice(0,20))});
return{texts:n,fails:fails.slice(0,30),failCount:fails.length,sizes,overflow:[...new Set(clip)].slice(0,12),docW:app.scrollWidth,win:app.clientWidth,font:getComputedStyle(app).fontFamily.slice(0,20)}})()`;

const KEEP_ANIM = ["fade-in", "pie", "turn"], COLOUR = ["background-color", "color", "box-shadow", "opacity"];
// Timing comes from the stylesheet: a reversed transition runs shorter, so getTiming() can't tell.
const CLASSIFY = `(()=>{const out=[];for(const a of document.getAnimations()){const t=a.effect&&a.effect.target,cs=getComputedStyle(t);
 const spec=(kind,names,name)=>{const i=Math.max(0,cs[names].split(", ").indexOf(name));return{dur:Math.round(parseFloat(cs[kind+"Duration"].split(", ")[i])*1000),ease:cs[kind+"TimingFunction"].split(/, (?![^(]*[)])/)[i]}};
 const where=e=>!e?"?":(e.tagName||"")+"."+String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className).split(" ")[0];
 let key,bad=null;
 if(a instanceof CSSAnimation){const {dur,ease}=spec("animation","animationName",a.animationName);key="animation:"+a.animationName;if(!${JSON.stringify(KEEP_ANIM)}.includes(a.animationName))bad=key;else if(a.animationName==="fade-in"&&(dur!==120||ease!=="ease"))bad=key+" "+dur+" "+ease}
 else if(a instanceof CSSTransition){const p=a.transitionProperty,{dur,ease}=spec("transition","transitionProperty",p);key="transition:"+p;
  if(${JSON.stringify(COLOUR)}.includes(p)||p==="fill"){if(dur!==120||ease!=="ease")bad=key+" "+dur+" "+ease}
  else if(p==="left"||p==="right"){if(!t.matches(".tray>.glide")||dur!==160||ease!=="ease")bad=key+" "+where(t)+" "+dur}
  else if(p==="transform"){if(!t.closest(".sec")||dur!==120||ease!=="ease")bad=key+" "+where(t)+" "+dur}
  else bad=key}
 else{key="waapi";bad=key}
 out.push({key,bad,where:where(t)})}return out})()`;
const LOOPS = `document.getAnimations().filter(a=>a.playState==="running"&&a.effect.getTiming().iterations===Infinity).map(a=>a.animationName||a.transitionProperty||"?")`;

const edge = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9361, vitePort = 1431;
const profile = mkdtempSync(join(tmpdir(), "grove-ui-check-"));
const vite = await createServer({ root, server: { port: vitePort, strictPort: true, hmr: false, watch: null }, logLevel: "warn", clearScreen: false });
await vite.listen();
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, "--force-device-scale-factor=1", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "about:blank"], { stdio: "ignore", windowsHide: true });

async function stop() {
  try {
    execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    // Already gone.
  }
  await vite.close();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

try {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {
      // Still starting.
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("headless Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, x) => ((ws.onopen = r), (ws.onerror = x)));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) {
      pend.get(d.id)(d);
      pend.delete(d.id);
    }
    if (d.method === "Runtime.exceptionThrown") report.errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") report.errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const shot = async (name) => writeFileSync(join(out, `${name}.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  const size = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const open = async (q) => {
    await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/index.html?${q}` });
    for (let i = 0; i < 1200; i++) {
      if (await ev(`document.readyState==="complete"&&!!document.querySelector("#app .gal-sec")`).catch(() => false)) break;
      await sleep(100);
    }
    await ev("document.fonts.ready.then(()=>1)");
    await sleep(250);
  };
  const center = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:"center"});const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2}})()`);
  const mouse = (x, y, type = "mouseMoved") => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const hover = async (sel) => { const c = await center(sel); if (!c) throw new Error(`no ${sel}`); await mouse(c.x, c.y); return c; };
  const click = async (sel) => { const c = await hover(sel); await mouse(c.x, c.y, "mousePressed"); await mouse(c.x, c.y, "mouseReleased"); };
  const CODES = { Escape: "Escape", ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", Enter: "Enter", Tab: "Tab", F10: "F10", ContextMenu: "ContextMenu", p: "KeyP", w: "KeyW" };
  // mods: 2 is Ctrl, 8 is Shift.
  const key = async (k, vk, mods = 0) => {
    const base = { key: k, code: CODES[k], windowsVirtualKeyCode: vk, modifiers: mods };
    // Enter carries its character: a form submits on that, not on the bare key.
    await send("Input.dispatchKeyEvent", k === "Enter" ? { type: "keyDown", text: "\r", ...base } : { type: "rawKeyDown", ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await sleep(40);
  };
  const type = async (text) => { await send("Input.insertText", { text }); await sleep(60); };
  const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
  const focusIs = (sel) => ev(`!!document.activeElement?.matches?.(${JSON.stringify(sel)})`);
  const waitFor = async (sel, ms = 20000) => { for (let i = 0; i < ms / 50; i++) { if (await has(sel)) return true; await sleep(50); } return false; };
  const attempt = async (name, fn) => {
    try {
      const r = await fn();
      check(name, r === true || (r && typeof r === "object" && Object.values(r).every(Boolean)), r === true ? undefined : r);
    } catch (e) {
      check(name, false, String(e.message ?? e));
    }
    await key("Escape", 27);
    await key("Escape", 27);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // ---- Every theme at both ends of the window size, and the UI font size's limits at the smallest window. ----
  const pages = [["dark", 1440, 900, 13], ["light", 1440, 900, 13], ["dark", 800, 500, 13], ["light", 800, 500, 13], ["dark", 800, 500, 10], ["light", 800, 500, 10], ["dark", 800, 500, 18], ["light", 800, 500, 18], ["dark", 1440, 900, 18]];
  report.pages = {};
  for (const [theme, w, h, font] of pages) {
    const name = `${theme}-${w}x${h}-${font}px`;
    await size(w, h);
    await open(`theme=${theme}&font=${font}`);
    const a = await ev(AUDIT);
    report.pages[name] = a;
    const text = await ev(`document.querySelector("#app").innerText`);
    report.pages[name].wording = forbidden(text);
    await shot(name);
    for (const section of ["Actions", "Inputs", "Lists and data", "Status", "Feedback", "Structure"]) {
      await ev(`[...document.querySelectorAll(".gal-sec>h2")].find(h=>h.textContent===${JSON.stringify(section)}).scrollIntoView({block:"start"});1`);
      await sleep(60);
      if (w === 1440 || font === 13) await shot(`${name}-${section.split(" ")[0].toLowerCase()}`);
    }
    check(`page ${name}`, !a.failCount && !a.overflow.length && a.docW <= a.win && !report.pages[name].wording.length && !/segoe|arial|times/i.test(a.font.split(",")[0]), a.failCount || a.overflow.length || a.docW > a.win ? { fails: a.fails, overflow: a.overflow, docW: a.docW, win: a.win } : undefined);
  }

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
    await sleep(60);
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

  // ---- The real overlays, in the gallery. ----
  await size(1440, 900);
  await open("theme=dark");
  await attempt("galleryLiveOverlays", async () => {
    const d = {};
    for (const [k, target, sel] of [["menu", '[data-live="menu"]', "#overlays .menu"], ["picker", '[data-live="picker"]', "#overlays .picker"], ["dialog", '[data-live="dialog"]', "#overlays .dlg"], ["select", '[data-live="select"] .sel', "#overlays .picker"]]) {
      await click(target);
      await sleep(180);
      d[k] = await has(sel);
      await key("Escape", 27);
      await sleep(60);
      d[`${k}Closed`] = !(await has("#overlays > :not(.tip)"));
      d[`${k}FocusBack`] = await focusIs(target);
    }
    return d;
  });
  await attempt("tooltip", async () => {
    await hover('[data-live="tip"]');
    await sleep(700);
    const shown = await has("#overlays .tip");
    const text = await ev(`document.querySelector("#overlays .tip")?.textContent`);
    await mouse(2, 2);
    await sleep(60);
    return { shown, text: text === "A tooltip shows after a short wait", gone: !(await has("#overlays .tip")) };
  });
  await attempt("dialogFocusTrap", async () => {
    await click('[data-live="dialog"]');
    await sleep(160);
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
    await sleep(100);
    await mouse(4, 4);
    await mouse(4, 4, "mousePressed");
    await mouse(4, 4, "mouseReleased");
    d.scrimCloses = !(await has(".dlg"));
    return d;
  });
  await attempt("pickerKeyboard", async () => {
    await click('[data-live="picker"]');
    await sleep(120);
    const d = { filterFocused: await focusIs("#overlays .picker input") };
    await type("rel");
    d.filtered = (await ev(`document.querySelectorAll("#overlays .picker .mi").length`)) === 1;
    await key("ContextMenu", 93);
    await sleep(100);
    d.menuOnTop = await has("#overlays .menu");
    d.keyboardFirstItem = await has("#overlays .menu .mi.on");
    await key("Escape", 27);
    d.onlyMenuClosed = !(await has("#overlays .menu")) && (await has("#overlays .picker"));
    await key("Enter", 13);
    await sleep(60);
    d.picked = (await ev(`document.querySelector('[data-live="last"]').textContent`)) === "Picker: release/2.4";
    d.focusBack = await focusIs('[data-live="picker"]');
    await click('[data-live="picker"]');
    await sleep(100);
    await click('[data-live="picker"]');
    d.anchorToggles = !(await has("#overlays .picker"));
    return d;
  });
  await attempt("transientOverlays", async () => {
    const open = async () => { await click('[data-live="menu"]'); await sleep(100); return has("#overlays .menu"); };
    const d = {};
    d.opened = await open();
    await ev(`window.dispatchEvent(new Event("blur"));1`);
    await sleep(40);
    d.blur = !(await has("#overlays .menu"));
    await open();
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 4, y: 4, deltaX: 0, deltaY: 40 });
    await sleep(80);
    d.wheelOutside = !(await has("#overlays .menu"));
    await open();
    await ev(`window.dispatchEvent(new Event("resize"));1`);
    await sleep(40);
    d.resize = !(await has("#overlays .menu"));
    await click('[data-live="picker"]');
    await sleep(100);
    await ev(`window.dispatchEvent(new Event("resize"));1`);
    d.pickerStaysOnResize = await has("#overlays .picker");
    await mouse(4, 4);
    await mouse(4, 4, "mousePressed");
    await mouse(4, 4, "mouseReleased");
    await sleep(40);
    d.pickerClosesOutside = !(await has("#overlays .picker"));
    return d;
  });
  await attempt("selectArrowOpens", async () => {
    await ev(`document.querySelector('[data-live="select"] .sel').focus();1`);
    await key("ArrowDown", 40);
    await sleep(100);
    const opened = await has("#overlays .picker");
    await key("ArrowDown", 40);
    await key("Enter", 13);
    await sleep(60);
    return { opened, picked: (await ev(`document.querySelector('[data-live="select"] .sel').textContent`)) === "development" };
  });

  // ---- The real App on mocked IPC. ----
  const openApp = async (q = "") => {
    await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/app.html?theme=dark${q}` });
    await sleep(300);
    const ok = await waitFor(".topbar .tb-switcher", 60000);
    await sleep(500);
    return ok;
  };
  const ipc = (name) => ev(`window.__ipc.filter(c=>c.cmd===${JSON.stringify(name)}).length`);
  const switcher = (n) => `.topbar .tb-switcher:nth-of-type(${n}) .tb-button`;
  const toWork = async () => { await ev(`document.querySelectorAll(".tab-strip .tab, .left-tabs button")[0]?.click();1`); };
  await attempt("appStarts", async () => ({ opened: await openApp(), host: await has("#overlays.ui-root"), inert: !(await has(".app[inert]")) }));
  await attempt("worktreePicker", async () => {
    await click(".topbar .tb-switcher:nth-child(2) .tb-button");
    await sleep(160);
    const d = { open: await has(".picker .mi"), current: await has('.picker .mi[data-current]'), noCollisions: !(await has("#overlays .row, #overlays .tab, #overlays .banner, #overlays .setting, #overlays .avatar, #overlays .badge, #overlays .spin")) };
    const before = await ipc("status");
    await key("ArrowDown", 40);
    await key("Enter", 13);
    await sleep(400);
    d.switched = (await ipc("status")) > before;
    d.closed = !(await has(".picker"));
    d.value = (await ev(`document.querySelectorAll(".topbar .tb-value")[1].textContent`)) === "agent-02";
    return d;
  });
  await attempt("branchPicker", async () => {
    await click(".topbar .tb-switcher:nth-child(4) .tb-button");
    await sleep(160);
    const d = { sections: (await ev(`document.querySelectorAll(".picker .sec-l").length`)) === 2 };
    await type("origin/");
    d.filtered = (await ev(`document.querySelectorAll(".picker .mi").length`)) === 1;
    await key("Enter", 13);
    await sleep(300);
    d.viewOnly = await ev(`[...document.querySelectorAll(".topbar .tb-caption")].some(e=>e.textContent==="Branch (view only)")`);
    return d;
  });
  await attempt("repoPickerSshForm", async () => {
    await openApp();
    await click(".topbar .tb-switcher:nth-child(1) .tb-button");
    await sleep(160);
    const d = { listed: (await ev(`document.querySelectorAll(".picker .mi").length`)) === 1 };
    await click(".picker-f .btn:nth-of-type(2)");
    await sleep(100);
    d.hostFocused = await focusIs('.picker-f input[placeholder^="user@host"]');
    await type("user@dev-box");
    await key("Tab", 9);
    d.tabInForm = await focusIs('.picker-f input[placeholder^="path"]');
    await type("~/src/example");
    d.stillOpen = await has(".picker");
    const before = await ipc("open_repo");
    await key("Enter", 13);
    await sleep(500);
    d.connected = (await ev(`window.__ipc.filter(c=>c.cmd==="open_repo").some(c=>String(c.args.path).startsWith("ssh://user@dev-box"))`)) && (await ipc("open_repo")) > before;
    d.closedAfter = !(await has(".picker"));
    return d;
  });
  await attempt("repoRemoveButton", async () => {
    await openApp();
    await click(".topbar .tb-switcher:nth-child(1) .tb-button");
    await sleep(160);
    await hover(".picker .mi");
    const visible = await ev(`getComputedStyle(document.querySelector(".picker .mi-x")).opacity==="1"`);
    await click(".picker .mi-x");
    await sleep(160);
    return { visible, stayedOpen: await has(".picker"), removed: !(await has(".picker .mi")) };
  });
  await attempt("baseSelect", async () => {
    await openApp();
    await click(".ov-tools .sel");
    await sleep(160);
    const d = { open: await has(".picker .mi") };
    const before = await ipc("worktrees_overview");
    await key("ArrowDown", 40);
    await key("Enter", 13);
    await sleep(300);
    d.reloaded = (await ipc("worktrees_overview")) > before;
    return d;
  });
  // Every context menu, through the app's own WV_CONTEXT_MENU hook, by right-click and by key.
  const PLACES = ["changes", "changes:key", "commit", "commit:key", "commitfile", "commitfile:key", "explorer", "explorer:key", "folder", "folder:key", "search", "search:key", "quickopen", "quickopen:key", "tab", "tab:key", "repo", "repo:key", "worktree", "worktree:key", "branch", "branch:key"];
  const menus = {};
  for (const place of PLACES) {
    await openApp(`&auto=${encodeURIComponent(JSON.stringify({ contextMenu: place, ...(place.startsWith("tab") ? { openFile: "README.md" } : {}) }))}`);
    await waitFor("#overlays .menu", 8000);
    await sleep(120);
    menus[place] = {
      items: await ev(`document.querySelectorAll("#overlays .menu [role=menuitem]").length`),
      first: place.endsWith(":key") ? await has("#overlays .menu .mi.on") : true,
    };
    if (place === "repo" || place === "changes") await shot(`app-menu-${place}`);
  }
  report.menus = menus;
  const emptyMenus = Object.entries(menus).filter(([, m]) => !m.items || !m.first).map(([k]) => k);
  check("everyContextMenu", !emptyMenus.length, emptyMenus);
  await attempt("menuOptionRuns", async () => {
    await openApp(`&auto=${encodeURIComponent(JSON.stringify({ contextMenu: "changes>Copy path" }))}`);
    await sleep(1500);
    return { copied: (await ipc("copy_text")) === 1, closed: !(await has("#overlays .menu")) };
  });
  await attempt("contextMenuKeys", async () => {
    await openApp();
    await ev(`document.querySelector(".tab-strip .tab")?.click();1`);
    await ev(`[...document.querySelectorAll(".left-tabs button")][0].click();1`);
    await sleep(300);
    const d = { list: await waitFor(".left .list .row", 8000) };
    await click(".left .list .row");
    await ev(`document.querySelector(".left .list").focus();1`);
    await key("F10", 121, 8);
    await sleep(100);
    d.shiftF10 = await has("#overlays .menu .mi.on");
    d.target = await has(".left .list .row.menu-target");
    await ev(`document.querySelector(".left .list").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}));1`);
    d.echoIgnored = (await ev(`document.querySelectorAll("#overlays .menu").length`)) === 1;
    await key("ArrowDown", 40);
    d.arrow = await ev(`document.querySelector("#overlays .menu").getAttribute("aria-activedescendant")!=="mi-0"`);
    await key("Escape", 27);
    d.closed = !(await has("#overlays .menu"));
    d.targetCleared = !(await has(".left .list .row.menu-target"));
    d.focusBack = await focusIs(".left .list");
    await key("ContextMenu", 93);
    await sleep(100);
    d.menuKey = await has("#overlays .menu .mi.on");
    await key("ContextMenu", 93);
    d.menuKeyCloses = !(await has("#overlays .menu"));
    d.focusBack2 = await focusIs(".left .list");
    return d;
  });
  await attempt("keysWithMonaco", async () => {
    await openApp(`&auto=${encodeURIComponent(JSON.stringify({ openFile: "src/server/orders/create.ts" }))}`);
    const d = { editor: await waitFor(".monaco-editor textarea, .monaco-editor .native-edit-context", 15000) };
    await ev(`document.querySelector(".tab-strip .tab")?.click();1`);
    await sleep(600);
    await ev(`document.querySelector(".editor-host:not([hidden]) .monaco-editor textarea, .monaco-editor textarea, .monaco-editor .native-edit-context").focus();1`);
    d.inMonaco = await ev(`!!document.activeElement.closest(".monaco-editor")`);
    const tabs = `document.querySelectorAll(".tab-strip .tab").length`;
    const before = await ev(tabs);
    await key("p", 80, 2);
    await sleep(200);
    d.quickOpen = await has("#overlays .quick-open");
    d.inert = await has(".app[inert]");
    await key("w", 87, 2);
    await sleep(100);
    d.pageIgnoresCtrlW = (await ev(tabs)) === before;
    await ev(`document.querySelector(".qo-item")?.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:200}));1`);
    await sleep(120);
    d.menuOverQuickOpen = await has("#overlays .menu");
    d.modalStays = await has("#overlays .quick-open");
    await key("Escape", 27);
    d.escClosesMenuOnly = !(await has("#overlays .menu")) && (await has("#overlays .quick-open"));
    await key("Escape", 27);
    await sleep(60);
    d.closed = !(await has("#overlays .quick-open"));
    d.inertGone = !(await has(".app[inert]"));
    d.focusBackInMonaco = await ev(`!!document.activeElement.closest(".monaco-editor")`);
    return d;
  });

  check("noConsoleErrors", !report.errors.length, report.errors.slice(0, 5));
  ws.close();
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
