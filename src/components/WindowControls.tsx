import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// The app draws its own title bar (the window has no Windows frame): the top bands
// move the window, and these are its Minimize, Maximize/Restore and Close buttons.
const win = getCurrentWindow();

const glyph = { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: 1, shapeRendering: "crispEdges" as const };

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const update = () => void win.isMaximized().then(setMaximized, () => {});
    update();
    const off = win.onResized(update);
    return () => void off.then((f) => f());
  }, []);
  const size = maximized ? "Restore" : "Maximize";
  return (
    <div className="wc ui-root">
      <button type="button" data-tip="Minimize" aria-label="Minimize" onClick={() => void win.minimize()}>
        <svg {...glyph}>
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button type="button" data-tip={size} aria-label={size} onClick={() => void win.toggleMaximize()}>
        <svg {...glyph}>
          <path d={maximized ? "M0.5 2.5h7v7h-7z M2.5 2.5v-2h7v7h-2" : "M0.5 0.5h9v9h-9z"} />
        </svg>
      </button>
      <button type="button" className="wc-close" data-tip="Close" aria-label="Close" onClick={() => void win.close()}>
        <svg {...glyph}>
          <path d="M0 0l10 10M10 0L0 10" shapeRendering="auto" />
        </svg>
      </button>
    </div>
  );
}
