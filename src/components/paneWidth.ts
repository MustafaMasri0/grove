import type { KeyboardEvent, MouseEvent } from "react";
import { useStore } from "../store";

type PaneKey = "railWidth" | "leftWidth" | "commitPaneWidth";

const setWidth = (key: PaneKey, width: number) => useStore.setState((s) => ({ settings: { ...s.settings, [key]: width } }));
const saveWidth = (key: PaneKey) => useStore.getState().updateSettings({ [key]: useStore.getState().settings[key] });

/** Follows the mouse from a pane's edge. Instant: the width applies each move and is saved on release. */
export function dragWidth(e: MouseEvent, key: PaneKey, clamp: (width: number) => number) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = useStore.getState().settings[key];
  const move = (m: globalThis.MouseEvent) => setWidth(key, clamp(startW + m.clientX - startX));
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    saveWidth(key);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** Arrow keys on a pane's edge. */
export function nudgeWidth(e: KeyboardEvent, key: PaneKey, clamp: (width: number) => number) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  setWidth(key, clamp(useStore.getState().settings[key] + (e.key === "ArrowRight" ? 8 : -8)));
  saveWidth(key);
}
