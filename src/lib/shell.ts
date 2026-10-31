// The shell's width bands. They follow the app's width, so window size and zoom both count.
export type Band = "xl" | "l" | "m" | "s";

export const bandOf = (width: number): Band => (width >= 1500 ? "xl" : width >= 1100 ? "l" : width >= 800 ? "m" : "s");

/** Below this the rail is icons and the list pane is a drawer. */
export const isNarrow = (width: number) => width < 1100;

/** Below this a commit's files replace the list instead of opening a column beside it. */
export const commitInList = (width: number) => width < 1300;

/** A list row and a two-line commit row, in pixels: the heights tokens.css gives --h-md and two lines of text. */
export const listRowHeight = (uiFont: number) => Math.ceil((uiFont * 28) / 13);
export const commitRowHeight = (uiFont: number) => Math.ceil((uiFont * 20) / 13) + Math.ceil((uiFont * 16) / 13) + 8;

export const RAIL_MIN = 220;
export const RAIL_MAX = 420;

export const clampRail = (width: number) => Math.max(RAIL_MIN, Math.min(RAIL_MAX, Math.round(width)));
