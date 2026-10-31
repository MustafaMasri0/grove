// Checks the design system against the harness page (harness/), and the shell on the real App on mocked IPC, in headless Edge: text contrast,
// layout at the window's smallest size, the motion allow-list, reduced motion, forbidden wording, and that nothing of it reaches the production bundle.
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
const SHELL = ["src/shell.css", "src/overview.css", "src/panes.css", "src/components/LeftPane.tsx", "src/components/ListView.tsx", "src/components/FileRow.tsx", "src/components/ChangedFilesView.tsx", "src/components/ChangesPanel.tsx", "src/components/HistoryPanel.tsx", "src/components/CommitPane.tsx", "src/components/ExplorerPanel.tsx", "src/components/SearchPanel.tsx", "src/components/WorktreesPage.tsx", "src/components/Rail.tsx", "src/components/RepoPicker.tsx", "src/components/WorkHeader.tsx", "src/components/WindowControls.tsx", "src/components/foldRail.ts", "src/lib/rail.ts", "src/lib/branchAction.ts"].map((f) => join(root, f));
const sources = [...walk(join(root, "src", "ui")), ...walk(join(root, "harness")), ...SHELL].filter((f) => /\.(css|tsx?|html)$/.test(f) && !f.endsWith(".test.tsx"));
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
// The kit's class names belong to the kit: a bare rule for one in the app's stylesheet would reach every control that mounts.
const legacy = readFileSync(join(root, "src", "styles.css"), "utf8");
const collisions = [...legacy.matchAll(/(?<![\w-])\.(row|tab|badge|banner|spin|setting|avatar)(?![\w-])/g)].map((m) => m[0]);
check("noKitClassesInAppStyles", !collisions.length, [...new Set(collisions)]);

// Overview's styles live in src/overview.css, and each rule there is for something the page draws.
check("noOverviewRulesInAppStyles", !/\.ov-|\.base-select select/.test(legacy));
const pageText = ["src/components/WorktreesPage.tsx", "src/components/BaseSelect.tsx"].map((f) => readFileSync(join(root, f), "utf8")).join("\n");
const overviewClasses = [...new Set([...readFileSync(join(root, "src", "overview.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(?<![\w-])\.([a-z][\w-]*)(?=[^{}]*\{)/g)].map((m) => m[1]))];
const kitText = readFileSync(join(root, "src", "ui", "controls.css"), "utf8");
const unused = overviewClasses.filter((c) => c !== "app" && !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(pageText) && !new RegExp(`\\.${c}(?![\\w-])`).test(kitText));
check("noUnusedOverviewRules", !unused.length, unused);

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
const CLASSIFY = `(()=>{const out=[];for(const a of document.getAnimations()){const t=a.effect&&a.effect.target,cs=getComputedStyle(t);
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
  // A command the page never answers fails its check instead of hanging the run.
  const send = (method, params = {}) => new Promise((r, x) => {
    const i = ++id;
    const t = setTimeout(() => { pend.delete(i); x(new Error(`no answer to ${method} in 30s: ${String(params.expression ?? "").slice(0, 80)}`)); }, 30000);
    pend.set(i, (d) => { clearTimeout(t); r(d); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
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
  const CODES = { Escape: "Escape", ArrowDown: "ArrowDown", ArrowUp: "ArrowUp", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Enter: "Enter", Tab: "Tab", F10: "F10", ContextMenu: "ContextMenu", p: "KeyP", w: "KeyW", b: "KeyB", o: "KeyO" };
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
    const a = await ev(audit());
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
    const ok = await waitFor(q.includes("none=1") ? ".rail .empty, .ov-page .empty" : ".rail .wt:not(.skel)", 60000);
    await sleep(500);
    return ok;
  };
  const toWork = async (n = 1) => { await click(`.rail .wt:nth-child(${n})`); await sleep(250); };
  const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const width = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect().width ?? null`);
  const box = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();return r?{l:r.left,r:r.right,t:r.top,b:r.bottom}:null})()`);
  const lastSaved = () => ev(`[...window.__ipc].reverse().find(c=>c.cmd==="save_settings")?.args.settings ?? null`);
  const ipc = (name) => ev(`window.__ipc.filter(c=>c.cmd===${JSON.stringify(name)}).length`);
  await attempt("appStarts", async () => ({ opened: await openApp(), host: await has("#overlays.ui-root"), inert: !(await has(".app[inert]")) }));
  await attempt("branchPicker", async () => {
    await toWork(2);
    await click(".br-btn");
    await sleep(160);
    const d = { sections: (await ev(`document.querySelectorAll(".picker .sec-l").length`)) === 2 };
    await type("origin/");
    d.filtered = (await ev(`document.querySelectorAll(".picker .mi").length`)) === 1;
    await key("Enter", 13);
    await sleep(300);
    d.viewOnly = (await text(".head .badge")) === "View only";
    d.banner = (await text(".work-top .banner b")) === "Viewing origin/main";
    await click(".work-top .banner .btn.link");
    await sleep(300);
    d.back = !(await has(".head .badge"));
    return d;
  });
  await attempt("repoPickerSshForm", async () => {
    await openApp();
    await click(".t-repo");
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
    await click(".t-repo");
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
    await toWork(2);
    await ev(`document.querySelector(".ptabs button").click();1`);
    await sleep(300);
    const d = { list: await waitFor(".left .lbox .row", 8000) };
    await click(".left .lbox .row");
    await ev(`document.querySelector(".left .lbox").focus();1`);
    await key("F10", 121, 8);
    await sleep(100);
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
    await sleep(100);
    d.menuKey = await has("#overlays .menu .mi.on");
    await key("ContextMenu", 93);
    d.menuKeyCloses = !(await has("#overlays .menu"));
    d.focusBack2 = await focusIs(".left .lbox");
    return d;
  });
  await attempt("keysWithMonaco", async () => {
    await openApp(`&auto=${encodeURIComponent(JSON.stringify({ openFile: "src/server/orders/create.ts" }))}`);
    const d = { editor: await waitFor(".monaco-editor textarea, .monaco-editor .native-edit-context", 15000) };
    await ev(`document.querySelector(".tab-strip .ed-tab")?.click();1`);
    await sleep(600);
    await ev(`document.querySelector(".editor-host:not([hidden]) .monaco-editor textarea, .monaco-editor textarea, .monaco-editor .native-edit-context").focus();1`);
    d.inMonaco = await ev(`!!document.activeElement.closest(".monaco-editor")`);
    const tabs = `document.querySelectorAll(".tab-strip .ed-tab").length`;
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

  // ---- The shell, on the real App. ----
  const CTRL = 2, CTRL_SHIFT = 10;
  const autoQ = (o) => `&auto=${encodeURIComponent(JSON.stringify(o))}`;
  const settingsQ = (o) => `&settings=${encodeURIComponent(JSON.stringify(o))}`;
  // Only the shell is held to the design system's rules here: the panes inside it move over in later phases.
  const SHELL_REGIONS = [".rail", ".work-top", ".wc", ".ov-page", ".left", ".commit-col"];
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
  for (const [theme, w, h, font] of SHELL_PAGES) {
    const name = `shell-${theme}-${w}x${h}-${font}px`;
    await size(w, h);
    await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/app.html?theme=${theme}&font=${font}&states=1` });
    await waitFor(".rail .wt:not(.skel)", 60000);
    await sleep(500);
    const views = {};
    views.overview = await shellAudit();
    await shot(`${name}-overview`);
    await toWork(2);
    views.work = await shellAudit();
    await shot(`${name}-work`);
    if (w < 1100) {
      await sleep(260); // Opening a worktree brings the drawer out.
      await shot(`${name}-drawer`);
    }
    const bad = Object.fromEntries(Object.entries(views).filter(([, v]) => v.fails.length || v.overflow.length || v.pageW > v.win || v.appW > v.win));
    check(name, !Object.keys(bad).length, Object.keys(bad).length ? bad : undefined);
  }
  await size(1440, 900);

  await attempt("railContents", async () => {
    await openApp("&states=1");
    const y = async (sel) => (await box(sel))?.t;
    const d = {};
    const order = [await y(".rail-top"), await y(".rail-nav"), await y(".rail-filter"), await y(".rail-list"), await y(".rail-foot")];
    d.order = order.every((v, i) => !i || v > order[i - 1]);
    d.top = (await count(".rail-top .t-repo")) === 1 && (await count(".rail-top .btn.only")) === 2;
    d.noTitleBar = (await box(".rail")).t === 0 && !(await has(".topbar"));
    d.rows = (await count(".rail .wt")) === 5;
    d.branch = (await text(".rail .wt:nth-child(2) .d")) === "agent/orders-refund";
    d.time = /^(now|\d+[mhd])$/.test((await text(".rail .wt:nth-child(2) .wt-time")) ?? "");
    d.count = (await text(".rail .wt:nth-child(2) .count")) === "2";
    d.delta = /\+12\s*−3/.test((await text(".rail .wt:nth-child(2) .delta")) ?? "");
    d.mark = (await ev(`document.querySelector(".rail .wt:nth-child(2) .mark").dataset.s`)) === "changes";
    d.clean = (await ev(`document.querySelector(".rail .wt:nth-child(3) .mark").dataset.s`)) === "idle";
    d.missing = await has('.rail .wt.off[aria-disabled="true"][data-tip^="Missing or prunable"]');
    d.bare = await has('.rail .wt.off[aria-disabled="true"][data-tip="Bare repository"]');
    const before = await ipc("status");
    await click(".rail .wt.off");
    await sleep(200);
    d.offDoesNotOpen = (await ipc("status")) === before && (await has(".ov-page"));
    await shot("shell-rail-states");
    return d;
  });
  await attempt("railSurvivesOverviewReset", async () => {
    await openApp("&states=1");
    await ev(`window.__store.setState({overview:null});1`);
    await sleep(100);
    const d = { rows: (await count(".rail .wt")) === 5, counts: (await text(".rail .wt:nth-child(2) .count")) === "2" };
    await ev(`window.__store.getState().updateSettings({possibleConflicts:false});1`);
    await sleep(60);
    d.afterSetting = (await count(".rail .wt")) === 5;
    await sleep(400);
    d.reloaded = (await text(".rail .wt:nth-child(2) .delta")) !== null;
    return d;
  });
  await attempt("railStates", async () => {
    await openApp();
    const mark = (n) => ev(`document.querySelector(".rail .wt:nth-child(${n}) .mark").dataset.s`);
    await ev(`(()=>{const s=window.__store;const p=s.getState().worktrees;s.setState({lastChange:{[p[2].path]:Date.now()/1000},actions:{[p[1].path]:{running:false,label:"",progress:"",error:null,rejected:true}}});})();1`);
    await sleep(100);
    return { changing: (await mark(3)) === "active", rejected: (await mark(2)) === "error", replacesBranch: (await text(".rail .wt:nth-child(2) .err-note")) === "Push rejected" };
  });
  await attempt("railFilter", async () => {
    await openApp();
    await click(".rail-filter input");
    await type("agent-02");
    await sleep(60);
    const d = { byName: (await count(".rail .wt")) === 1 };
    await ev(`document.querySelector(".rail-filter input").select();1`);
    await type("nothing here");
    await sleep(60);
    d.none = (await text(".rail .empty-line"))?.startsWith("No worktrees match.");
    await click(".rail .empty-line .btn");
    await sleep(60);
    d.cleared = (await count(".rail .wt")) === 3 && (await focusIs(".rail-filter input"));
    await click(".rail-filter .btn");
    await sleep(60);
    d.hasChanges = (await count(".rail .wt")) === 1 && (await has('.rail-filter .btn[aria-pressed="true"]'));
    await toWork(1);
    await click(".rail-filter .btn");
    return d;
  });
  await attempt("railKeys", async () => {
    await openApp();
    await ev(`document.querySelector(".rail .wt").focus();1`);
    await key("ArrowDown", 40);
    await key("ArrowDown", 40);
    const d = { arrows: await focusIs(".rail .wt:nth-child(3)") };
    await key("Enter", 13);
    await sleep(300);
    d.opened = (await text(".head h1 .ell")) === "agent-02" && (await has(".rail .wt:nth-child(3).on"));
    await key("F10", 121, 8);
    await sleep(120);
    d.menu = await has("#overlays .menu .mi.on");
    d.target = await has(".rail .wt.menu-target");
    await key("Escape", 27);
    d.focusBack = await focusIs(".rail .wt:nth-child(3)");
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
      await sleep(40);
    };
    await drag(300);
    const d = { follows: (await width(".rail")) === 300 };
    await sleep(400);
    d.saved = (await lastSaved())?.railWidth === 300;
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
    await sleep(800);
    const seen = new Map(), bad = new Map();
    const grab = async () => { for (const a of await ev(CLASSIFY)) { seen.set(a.key, 1); if (a.bad) bad.set(a.bad, a.where); } };
    const d = {};
    await ev(`document.querySelector(".rail-filter input").focus();1`);
    await key("b", 66, CTRL);
    d.width = (await width(".rail")) === 48;
    d.ghost = (await count("#rail-fold > .rail-ghost")) === 1 && (await width(".rail-ghost")) === 264;
    d.ghostInert = !(await has("#rail-fold [id]")) && !(await has("#rail-fold [data-tip]")) && !(await has("#rail-fold [tabindex]"));
    d.slides = (await ev(`document.querySelector("#main").dataset.fold`)) === "" && !!(await ev(`getComputedStyle(document.querySelector("#main")).getPropertyValue("--fold-x")`));
    const widths = [];
    for (let i = 0; i < 5; i++) { await grab(); widths.push(await width(".main")); await sleep(20); }
    d.noReflow = new Set(widths).size === 1;
    await sleep(280);
    d.ghostGone = (await count("#rail-fold > *")) === 0 && !(await has("#main[data-fold]")) && !(await has(".rail[data-fold]"));
    d.topOnlyRepo = (await count(".rail-top .btn")) === 1;
    d.navSearch = (await count(".rail .rail-nav")) === 4;
    d.noFilter = (await width(".rail-filter")) === 0;
    d.badge = await ev(`(()=>{const c=document.querySelector(".rail .wt:nth-child(2) .count").getBoundingClientRect(),m=document.querySelector(".rail .wt:nth-child(2) .mark").getBoundingClientRect();return c.left>=m.left&&c.left<m.right+6&&c.bottom>m.top})()`);
    d.noBadgeAtZero = !(await has(".rail .wt:nth-child(3) .count"));
    d.tooltip = /Has changes\n2 changed files/.test(await ev(`document.querySelector(".rail .wt:nth-child(2)").title`));
    await shot("shell-rail-collapsed");
    await sleep(400);
    d.saved = (await lastSaved())?.railCollapsed === true;
    await click('.rail-foot .btn[aria-label="Expand sidebar"]');
    d.expanded = (await width(".rail")) === 264;
    for (let i = 0; i < 5; i++) { await grab(); await sleep(20); }
    await sleep(280);
    await key("b", 66, CTRL);
    await key("b", 66, CTRL);
    await sleep(320);
    d.twiceReturns = (await width(".rail")) === 264 && (await count("#rail-fold > *")) === 0;
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
  await attempt("routingKeepsEditor", async () => {
    await openApp(autoQ({ openFile: "src/server/orders/create.ts" }));
    const d = { editor: await waitFor(".monaco-editor .view-lines", 15000) };
    await sleep(600);
    d.work = !(await has(".ov-page")) && !(await has(".work[data-covered]"));
    await ev(`document.querySelector(".monaco-editor").__keep=1;1`);
    const before = await box(".monaco-editor");
    await key("o", 79, CTRL_SHIFT);
    await sleep(200);
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
    await sleep(160);
    d.settings = (await has(".settings-page")) && (await has('.rail-nav[aria-label="Settings"][aria-pressed="true"]')) && (await ev(`document.querySelector(".monaco-editor").__keep`)) === 1;
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
    await sleep(140);
    d.menu = (await text("#overlays .menu .mi-l")) === "Fetch origin";
    const before = await ipc("run_action");
    await key("Enter", 13);
    await sleep(200);
    d.fetchRan = (await ipc("run_action")) === before + 1;
    await click(".head .split .btn:first-child");
    await sleep(200);
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
    await sleep(250);
    const d = { banner: (await text(".work-top .banner pre"))?.includes("[rejected]"), rail: (await text(".rail .wt:nth-child(2) .err-note")) === "Push rejected" };
    await click('.work-top .banner [aria-label="Dismiss"]');
    d.dismissed = !(await has(".work-top .banner"));
    d.stays = (await text(".rail .wt:nth-child(2) .err-note")) === "Push rejected";
    return d;
  });
  await attempt("notices", async () => {
    await openApp();
    await toWork(2);
    await ev(`window.__store.setState({connectionLost:"dev-box",notice:"Could not copy"});1`);
    await sleep(120);
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
    const d = { welcome: (await text(".rail .empty h2")) === "No repository open", noFilter: !(await has(".rail[data-bare]")) ? false : (await width(".rail-filter")) === 0, repo: (await text(".t-repo .btn-l")) === "Add a repository", dragBand: (await box('.ov-page [data-tauri-drag-region="deep"]'))?.b === 44 && (await ev(`document.elementFromPoint(innerWidth/2,20).closest('[data-tauri-drag-region="deep"]')!==null`)) };
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
    await sleep(120);
    d.light = JSON.stringify(await colour()).includes("f2f2f3");
    return d;
  });
  await attempt("noCollisions", async () => {
    await openApp();
    await toWork(2);
    await sleep(200);
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
      await sleep(120);
      d[`band${w}`] = (await ev(`document.querySelector(".app").dataset.size`)) === band;
    }
    await size(1440, 900);
    await sleep(120);
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
    await sleep(240);
    d.overPage = (await box(".list-clip")).l === 48;
    await click(".left .lbox .row");
    await sleep(240);
    d.fileCloses = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "false" && (await has(".list-clip[inert]"));
    await key("b", 66, CTRL);
    for (let i = 0; i < 3; i++) { await grab(); await sleep(30); }
    d.keyToggles = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "true";
    await sleep(240);
    await click(".head .btn.tgl");
    for (let i = 0; i < 3; i++) { await grab(); await sleep(30); }
    await sleep(240);
    d.buttonToggles = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "false";
    d.slideAllowed = !bad.size && seen.has("transition:transform");
    await key("o", 79, CTRL_SHIFT);
    await size(1440, 900);
    await sleep(160);
    d.backOut = (await ev(`document.querySelector(".list-clip").dataset.open`)) === "true";
    return d;
  });
  await attempt("commitAtNarrowWidths", async () => {
    await size(1200, 700);
    await openApp(autoQ({ showHistory: "1" }));
    await waitFor(".commit-pane", 5000);
    await sleep(200);
    const d = { inList: await has(".left .commit-pane") };
    await size(1400, 700);
    await sleep(200);
    d.column = (await has(".commit-pane")) && !(await has(".left .commit-pane"));
    await size(1440, 900);
    return d;
  });
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
  const seedFeed = async () => { await ev(`window.__store.setState({activity:${JSON.stringify(FEED)}});1`); await sleep(120); };
  const openOverview = async (ov = "") => {
    await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/app.html?theme=dark${ov ? `&ov=${ov}` : ""}` });
    const ok = await waitFor(".ov-page .ov-head", 60000);
    await sleep(500);
    return ok;
  };
  const rowsNow = () => ev(`[...document.querySelectorAll(".ov-tbl tbody .wname .ell")].map(e=>e.textContent)`);
  const badges = () => ev(`[...document.querySelectorAll(".sum .badge")].map(e=>e.textContent)`);
  const sortBy = (n) => click(`.ov-tbl th:nth-child(${n}) .dt-sort`);

  await attempt("overviewIsItsOwnScope", async () => {
    await openOverview();
    return {
      root: await has(".ov-page.ui-root"),
      noInnerScopes: (await count(".ov-page .ui-root")) === 0,
      noCards: !(await has(".ov-card, .ov-body, .ov-section")),
      fullWidth: (await box(".ov-tbl table")).r === (await box(".ov-page")).r,
      dragBand: (await count('.ov-head[data-tauri-drag-region="deep"]')) === 1,
      clearOfControls: (await box(".ov-refresh")).r <= (await box(".wc")).l,
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
    await sleep(120);
    const b = await badges();
    d.live = b.includes("1 active");
    d.rejected = b.includes("1 push rejected");
    d.noChangesStillCounts = b.includes("1 with changes");
    d.rejectedBadge = (await text('.ov-tbl tr[data-path$="agent-01"] .badge.error .ell')) === "Push rejected";
    d.activeTag = (await text('.ov-tbl tr[data-path$="agent-02"] .st-tag.active .ell')) === "Changing";
    d.liveNote = (await text(".live-note")) === "Live";
    const before = await ipc("worktrees_overview");
    await click(".ov-refresh");
    await sleep(200);
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
    await sleep(300);
    d.opens = !(await has(".ov-page")) && (await text(".head h1 .ell")) === "agent-02";
    await key("o", 79, CTRL_SHIFT);
    await sleep(200);
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
    await sleep(120);
    d.heldUnderPointer = await same(start);
    d.stateStillUpdates = (await text('tr[data-path$="agent-02"] .st-tag .ell')) === "Changing";
    await sortBy(3);
    await sleep(60);
    d.clickSortsAtOnce = await same([...resorted].reverse());
    await sortBy(3);
    await sleep(60);
    d.clickSortsBack = await same(resorted);
    await ev(`window.__store.setState({lastChange:{}});1`);
    await sleep(120);
    d.heldAgain = await same(resorted);
    await mouse(1000, 860);
    await sleep(120);
    d.leavingSorts = await same(start);
    // Clicking a header leaves focus in the table; the pointer leaving must still re-sort.
    await hover('tr[data-path$="agent-02"]');
    await sortBy(1);
    await sortBy(3);
    await changeTwo();
    await sleep(120);
    d.heldAfterClick = await same(start);
    await mouse(1000, 860);
    await sleep(120);
    d.leavingSortsAfterClick = await same(resorted);
    // A row that arrives while held joins at the end instead of waiting for the pointer.
    await ev(`window.__store.setState({lastChange:{}});1`);
    await sleep(120);
    await hover('tr[data-path$="agent-02"]');
    await ev(`(()=>{const s=window.__store,o=s.getState().overview,w={...o.worktrees[0],path:"/home/user/src/agent-03",branch:"agent/new"};s.setState({overview:{...o,worktrees:[w,...o.worktrees]}})})();1`);
    await sleep(120);
    d.newRowJoinsAtEnd = (await rowsNow()).at(-1) === "agent-03";
    await mouse(1000, 860);
    return d;
  });
  await attempt("overviewKeyboard", async () => {
    await openOverview();
    const d = {};
    await ev(`document.querySelector(".ov-tbl th .dt-sort").focus();1`);
    await key("Enter", 13);
    await sleep(60);
    d.headerSorts = JSON.stringify(await rowsNow()) === JSON.stringify(["agent-01", "agent-02", "main worktree"]);
    await key("Tab", 9);
    await ev(`window.__store.getState().setOverviewSort({key:"state",dir:1});1`);
    await sleep(60);
    await ev(`document.querySelector('tr[data-path$="agent-02"]').focus();1`);
    await key("Enter", 13);
    await sleep(300);
    d.rowOpens = (await text(".head h1 .ell")) === "agent-02";
    await key("o", 79, CTRL_SHIFT);
    await sleep(200);
    await ev(`document.querySelector(".help").focus();1`);
    await key("Tab", 9, 8);
    await key("Tab", 9);
    await sleep(100);
    d.helpTipOnFocus = (await text("#overlays .tip"))?.startsWith("Files that more than one worktree changes");
    return d;
  });
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
    await sleep(300);
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
    await sleep(300);
    d.worktreeLink = (await text(".head h1 .ell")) === "agent-02";
    await key("o", 79, CTRL_SHIFT);
    await sleep(200);
    await click(".ev:nth-child(2) .ev-link");
    await sleep(300);
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
    await sleep(500);
    d.sectionGone = !(await has(".ov-shared"));
    d.solo = await has(".ov-split.solo");
    d.activityFull = (await box(".ov-pane")).r === (await box(".ov-page")).r;
    d.saved = (await lastSaved())?.possibleConflicts === false;
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
    await sleep(120);
    d.noCommitAt1100 = (await shown()) < 10;
    await size(800, 500);
    await sleep(120);
    d.fewAt800 = (await shown()) === 7;
    d.refreshIconOnly = (await width(".ov-refresh")) === 28;
    d.refreshStillNamed = (await text(".ov-refresh .btn-l")) === "Refresh";
    await size(1440, 900);
    return d;
  });
  // Each state fits the design system's rules at both ends of the window, in both themes.
  for (const [theme, w, h] of [["dark", 800, 500], ["light", 800, 500], ["dark", 1440, 900], ["light", 1440, 900]]) {
    const views = {};
    await size(w, h);
    for (const ov of ["", "many", "errors", "nobase", "fail", "loading", "one", "odd"]) {
      await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/app.html?theme=${theme}&ov=${ov}` });
      await waitFor(".ov-page .ov-head", 60000);
      await sleep(500);
      if (ov !== "loading" && ov !== "fail") await seedFeed();
      await ev(`window.__store.setState({lastChange:{${JSON.stringify(TWO)}:Date.now()/1000+300},actions:{${JSON.stringify(ONE)}:{running:false,label:"",progress:"",error:null,rejected:true}}});1`);
      await sleep(160);
      views[ov || "live"] = await shellAudit();
      await shot(`overview-${theme}-${w}x${h}-${ov || "live"}`);
    }
    const bad = Object.fromEntries(Object.entries(views).filter(([, v]) => v.fails.length || v.overflow.length || v.pageW > v.win || v.appW > v.win));
    check(`overview-${theme}-${w}x${h}`, !Object.keys(bad).length, Object.keys(bad).length ? bad : undefined);
  }
  for (const font of [10, 18]) {
    await size(800, 500);
    await send("Page.navigate", { url: `http://localhost:${vitePort}/harness/app.html?theme=dark&font=${font}&ov=many` });
    await waitFor(".ov-page .ov-head", 60000);
    await sleep(500);
    await seedFeed();
    const v = await shellAudit();
    await shot(`overview-dark-800x500-font${font}`);
    check(`overview-font-${font}`, !v.fails.length && !v.overflow.length && v.pageW <= v.win, v);
  }
  await size(1440, 900);
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
