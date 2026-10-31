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
  const found = ["ui-root", "gal-scroll", "harness/main", "mockIPC", "The harness has no answer", "Inter Variable"].filter((s) => built.some((f) => readFileSync(f, "utf8").includes(s)));
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

const KEEP_ANIM = ["pie", "turn"], COLOUR = ["background-color", "color", "box-shadow", "opacity"];
// Timing comes from the stylesheet: a reversed transition runs shorter, so getTiming() can't tell.
const CLASSIFY = `(()=>{const out=[];for(const a of document.getAnimations()){const t=a.effect&&a.effect.target,cs=getComputedStyle(t);
 const spec=(kind,names,name)=>{const i=Math.max(0,cs[names].split(", ").indexOf(name));return{dur:Math.round(parseFloat(cs[kind+"Duration"].split(", ")[i])*1000),ease:cs[kind+"TimingFunction"].split(/, (?![^(]*[)])/)[i]}};
 const where=e=>!e?"?":(e.tagName||"")+"."+String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className).split(" ")[0];
 let key,bad=null;
 if(a instanceof CSSAnimation){key="animation:"+a.animationName;if(!${JSON.stringify(KEEP_ANIM)}.includes(a.animationName))bad=key}
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
  const need = ["animation:pie", "animation:turn", "transition:background-color", "transition:left", "transition:transform", "transition:opacity"];
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
