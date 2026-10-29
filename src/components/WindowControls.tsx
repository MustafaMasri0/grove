import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

// The app draws its own title bar (the window has no Windows frame): the top bar
// moves the window, and these are its Minimize, Maximize/Restore and Close buttons.
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
  return (
    <div className="window-controls">
      <button className="wc-button" title="Minimize" aria-label="Minimize" onClick={() => void win.minimize()}>
        <svg {...glyph}>
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button className="wc-button" title={maximized ? "Restore" : "Maximize"} aria-label={maximized ? "Restore" : "Maximize"} onClick={() => void win.toggleMaximize()}>
        {maximized ? (
          <svg {...glyph}>
            <path d="M0.5 2.5h7v7h-7z M2.5 2.5v-2h7v7h-2" />
          </svg>
        ) : (
          <svg {...glyph}>
            <path d="M0.5 0.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button className="wc-button wc-close" title="Close" aria-label="Close" onClick={() => void win.close()}>
        <svg {...glyph}>
          <path d="M0 0l10 10M10 0L0 10" shapeRendering="auto" />
        </svg>
      </button>
    </div>
  );
}
