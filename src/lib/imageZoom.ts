// Zoom for the image views: fitting, the steps Ctrl+= / Ctrl+- and Ctrl+wheel go
// through, and keeping the point under the pointer still while zooming.

export const ZOOM_LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/**
 * Decoded pixels an image may have (4 bytes each, so 256 MB); bigger ones are not
 * shown, whatever their file size.
 */
export const MAX_PIXELS = 64 * 1024 * 1024;

/** The scale that fits an image in the view; small images stay at 100%. */
export function fitScale(w: number, h: number, boxW: number, boxH: number): number {
  if (w <= 0 || h <= 0 || boxW <= 0 || boxH <= 0) return 1;
  return Math.min(1, boxW / w, boxH / h);
}

/** The next zoom level up (1) or down (-1) from `cur`, which may lie between levels. */
export function stepZoom(cur: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_LEVELS.find((z) => z > cur + eps) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  return [...ZOOM_LEVELS].reverse().find((z) => z < cur - eps) ?? ZOOM_LEVELS[0];
}

/**
 * The new scroll offset along one axis when the scale changes, so that the image
 * point `pointer` pixels into the view stays where it is.
 */
export function anchoredScroll(scroll: number, pointer: number, from: number, to: number): number {
  return Math.max(0, ((scroll + pointer) * to) / from - pointer);
}

export const formatZoom = (scale: number) => `${Math.round(scale * 100)}%`;

export const tooManyPixels = (w: number, h: number) => w * h > MAX_PIXELS;
