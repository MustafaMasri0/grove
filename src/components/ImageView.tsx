import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ImageSource } from "../api";
import { formatBytes } from "../lib/format";
import { anchoredScroll, fitScale, formatZoom, MAX_PIXELS, stepZoom, tooManyPixels } from "../lib/imageZoom";
import type { ImageDiff } from "../lib/settings";
import { Button, Slider, Toggle, Toolbar } from "../ui";

export interface ImageSide {
  label: string;
  source: ImageSource;
}

/** What Ctrl+= / Ctrl+- / Ctrl+0 reach while an image is shown (0: fit). */
export const imageCommands = {
  active: false,
  zoom: (_dir: 1 | -1 | 0) => {},
  set: (_z: number | "fit") => {},
};

type Dims = { w: number; h: number; vector: boolean };
type SideState = { dims?: Dims; error?: string };

const PAD = 16;
const isSvgUrl = (url: string) => /\.svg$/i.test(new URL(url).pathname);

/**
 * One image, or the two sides of a changed one. Images load from wvfile: URLs and
 * live only as long as this view: it is shown for the active tab alone, so closing
 * or leaving the tab lets the webview drop the decoded pixels.
 */
export function ImageView({ sides, mode }: { sides: ImageSide[]; mode: ImageDiff }) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [states, setStates] = useState<SideState[]>(() => sides.map(() => ({})));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const area = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number; from: number; to: number } | null>(null);
  const syncing = useRef(false);

  const both = sides.length === 2 && sides.every((s) => s.source.kind === "image");
  const layered = both && mode !== "sideBySide" && states.every((s) => !s.error);
  const panes = layered ? 1 : sides.length;
  const paneW = (box.w - (panes - 1)) / panes - 2 * PAD;
  const paneH = box.h - 2 * PAD;
  const loaded = states.map((s) => s.dims).filter((d): d is Dims => !!d);
  const frame = { w: Math.max(0, ...loaded.map((d) => d.w)), h: Math.max(0, ...loaded.map((d) => d.h)) };
  // Both sides share one scale, so their sizes compare.
  const fit = loaded.length ? (layered ? fitScale(frame.w, frame.h, paneW, paneH) : Math.min(...loaded.map((d) => fitScale(d.w, d.h, paneW, paneH)))) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => {
    const el = area.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    // Ctrl+wheel zooms around the pointer; it must be able to cancel the page's own scroll.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const pane = (e.target as HTMLElement).closest(".image-pane") ?? el.querySelector(".image-pane");
      const r = (pane ?? el).getBoundingClientRect();
      const from = scaleRef.current;
      const to = stepZoom(from, e.deltaY < 0 ? 1 : -1);
      anchor.current = { x: e.clientX - r.left, y: e.clientY - r.top, from, to };
      setZoom(to);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    imageCommands.active = true;
    imageCommands.zoom = (dir) => {
      anchor.current = null;
      setZoom(dir === 0 ? "fit" : stepZoom(scaleRef.current, dir));
    };
    imageCommands.set = (z) => setZoom(z);
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      imageCommands.active = false;
    };
  }, []);

  // After a pointer zoom, scroll so the point under the pointer stays put.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a || Math.abs(a.to - scale) > 1e-9) return;
    anchor.current = null;
    area.current?.querySelectorAll<HTMLElement>(".image-pane").forEach((p) => {
      p.scrollLeft = anchoredScroll(p.scrollLeft, a.x, a.from, a.to);
      p.scrollTop = anchoredScroll(p.scrollTop, a.y, a.from, a.to);
    });
  }, [scale]);

  const setSide = (i: number, s: SideState) => setStates((all) => all.map((x, j) => (j === i ? s : x)));
  const onLoad = (i: number, img: HTMLImageElement) => {
    const vector = isSvgUrl(img.src);
    // An SVG without a width and height has no size of its own.
    const [w, h] = img.naturalWidth && img.naturalHeight ? [img.naturalWidth, img.naturalHeight] : [512, 512];
    if (tooManyPixels(w, h)) setSide(i, { error: `Too large to show: ${w} × ${h} pixels (the limit is ${MAX_PIXELS / 1024 / 1024} megapixels).` });
    else setSide(i, { dims: { w, h, vector } });
  };

  /** The image, at the current scale over a checkerboard; hidden until its size is known. */
  const picture = (i: number, style?: React.CSSProperties) => {
    const src = sides[i].source;
    const st = states[i];
    if (src.kind !== "image" || st.error) return null;
    const d = st.dims;
    return (
      <div className="image-checker" style={d ? { width: d.w * scale, height: d.h * scale, ...style } : { display: "none" }}>
        <img
          src={src.url}
          alt={sides[i].label}
          draggable={false}
          decoding="async"
          onLoad={(e) => onLoad(i, e.currentTarget)}
          onError={() => setSide(i, { error: "Not a valid image, or a format this view cannot show." })}
        />
      </div>
    );
  };

  const empty = (i: number) => {
    const src = sides[i].source;
    const st = states[i];
    if (src.kind === "missing") return <div className="image-none">{sides.length > 1 ? (i === 0 ? "No image before this change" : "No image after this change") : "This file does not exist."}</div>;
    if (src.kind === "tooLarge") return <div className="image-none">Image is too large to show ({formatBytes(src.size)}; the limit is 32 MB).</div>;
    if (st.error) return <div className="image-none">{st.error}</div>;
    return null;
  };

  const onPaneScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (syncing.current) return;
    syncing.current = true;
    const src = e.currentTarget;
    area.current?.querySelectorAll<HTMLElement>(".image-pane").forEach((p) => {
      if (p !== src) {
        p.scrollLeft = src.scrollLeft;
        p.scrollTop = src.scrollTop;
      }
    });
    requestAnimationFrame(() => (syncing.current = false));
  };

  const swipeAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  };

  const info = (i: number) => {
    const s = sides[i];
    const d = states[i].dims;
    const size = s.source.kind === "missing" ? "none" : formatBytes(s.source.size);
    const px = d ? (d.vector ? "vector" : `${d.w} × ${d.h}`) : s.source.kind === "image" && !states[i].error ? "…" : "";
    return (
      <span key={i} className="image-info" title={s.label}>
        {sides.length > 1 && <b>{s.label}</b>} {[px, size].filter(Boolean).join(" · ")}
      </span>
    );
  };

  return (
    <div className="ui-root image-view">
      <div ref={area} className="image-area">
        {layered ? (
          <div className="image-pane">
            <div className="image-canvas">
              <div
                className={`image-stack ${mode}`}
                style={{ width: frame.w * scale, height: frame.h * scale }}
                onPointerDown={(e) => {
                  if (mode !== "swipe") return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  swipeAt(e);
                }}
                onPointerMove={(e) => mode === "swipe" && e.buttons === 1 && swipeAt(e)}
              >
                {picture(0)}
                <div className="image-top" style={mode === "swipe" ? { clipPath: `inset(0 0 0 ${pos}%)` } : { opacity: opacity / 100 }}>
                  {picture(1)}
                </div>
                {mode === "swipe" && loaded.length === 2 && <div className="swipe-handle" style={{ left: `${pos}%` }} />}
                {loaded.length === 2 && (
                  <>
                    <span className="image-tag left">{sides[0].label}</span>
                    <span className="image-tag right">{sides[1].label}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          sides.map((s, i) => (
            <div key={i} className="image-pane" onScroll={onPaneScroll}>
              {sides.length > 1 && <span className="image-tag left">{s.label}</span>}
              <div className="image-canvas">
                {picture(i)}
                {empty(i)}
              </div>
            </div>
          ))
        )}
        {layered && states.some((s) => s.error) && <div className="image-none">{states.find((s) => s.error)!.error}</div>}
      </div>
      <Toolbar>
        {sides.map((_, i) => info(i))}
        <span className="spacer" />
        {layered && mode === "swipe" && <Slider text="Swipe" tip="Where the after image starts; drag across the image too" value={pos} onChange={(e) => setPos(Number(e.target.value))} />}
        {layered && mode === "onion" && <Slider text="Opacity" tip="How much of the after image shows through" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />}
        <Button kind="ghost" size="sm" icon="remove" label="Zoom out" tip="Zoom out (Ctrl+- or Ctrl+wheel)" onClick={() => imageCommands.zoom(-1)} />
        <span className="image-zoom num" data-tip="Zoom">
          {formatZoom(scale)}
        </span>
        <Button kind="ghost" size="sm" icon="add" label="Zoom in" tip="Zoom in (Ctrl+= or Ctrl+wheel)" onClick={() => imageCommands.zoom(1)} />
        <Toggle size="sm" text="Fit" tip="Fit to the window (Ctrl+0)" on={zoom === "fit"} onClick={() => imageCommands.zoom(0)} />
        <Toggle size="sm" text="100%" tip="Actual size" on={zoom === 1} onClick={() => setZoom(1)} />
      </Toolbar>
    </div>
  );
}
