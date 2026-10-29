// The blame margin of a file view: who last changed each line, shown in place of
// the line numbers (Monaco's lineNumbers option takes a function).
import type { Blame } from "../api";
import { shortSha } from "./format";

const AUTHOR = 14;
const LABEL = 7 + 1 + AUTHOR + 1 + 10;

function date(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function author(name: string): string {
  return name.length > AUTHOR ? `${name.slice(0, AUTHOR - 1)}…` : name.padEnd(AUTHOR);
}

/** The label of each run's first line (`abc1234 Author 2026-01-02`), then the line number; all lines equally wide. */
export function blameMargin(b: Blame, lineCount: number): { text(line: number): string; width: number } {
  const labels = new Map<number, string>();
  for (const h of b.hunks) {
    const c = b.commits[h.sha];
    if (!c) continue;
    labels.set(h.start, c.uncommitted ? "Uncommitted" : `${shortSha(h.sha)} ${author(c.authorName)} ${date(c.authorTime)}`);
  }
  const digits = String(Math.max(1, lineCount)).length;
  return {
    width: LABEL + 2 + digits,
    text: (line) => `${(labels.get(line) ?? "").padEnd(LABEL)}  ${String(line).padStart(digits)}`,
  };
}

/** The commit that last changed a line; null for uncommitted lines and lines blame does not cover. */
export function commitAtLine(b: Blame, line: number): string | null {
  const h = b.hunks.find((h) => line >= h.start && line < h.start + h.count);
  return h && !b.commits[h.sha]?.uncommitted ? h.sha : null;
}
