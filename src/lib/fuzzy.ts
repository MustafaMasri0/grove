// Quick-open matching: subsequence matching with bonuses for file-name,
// contiguous and word-start matches, close to how VS Code ranks Ctrl+P.

export interface Match {
  score: number;
  /** Indices into the path that matched, for highlighting. */
  positions: number[];
}

export interface Ranked extends Match {
  path: string;
}

const isSeparator = (c: string) => c === "/" || c === "\\" || c === "-" || c === "_" || c === "." || c === " ";

function wordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  return isSeparator(prev) || (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
}

/** Leftmost match, then tightened from the end so the matched window is as short as possible. */
function matchIn(query: string, text: string, offset: number): number[] | null {
  const lower = text.toLowerCase();
  let qi = 0;
  let end = -1;
  for (let i = offset; i < lower.length && qi < query.length; i++) {
    if (lower[i] === query[qi]) {
      qi++;
      end = i;
    }
  }
  if (qi < query.length) return null;
  const positions: number[] = new Array(query.length);
  qi = query.length - 1;
  for (let i = end; i >= offset && qi >= 0; i--) {
    if (lower[i] === query[qi]) positions[qi--] = i;
  }
  return positions;
}

function scorePositions(text: string, positions: number[]): number {
  let score = 0;
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k];
    score += 1;
    if (k > 0 && positions[k - 1] === p - 1) score += 5;
    if (wordStart(text, p)) score += 8;
  }
  return score;
}

export function fuzzyMatch(rawQuery: string, path: string): Match | null {
  const query = rawQuery.toLowerCase().replace(/\\/g, "/");
  if (!query) return { score: 0, positions: [] };
  const baseStart = path.lastIndexOf("/") + 1;
  const base = path.slice(baseStart);
  const penalty = base.length * 0.1 + path.length * 0.01;

  if (!query.includes("/")) {
    const inBase = matchIn(query, path, baseStart);
    if (inBase) {
      let score = scorePositions(path, inBase) + 20;
      if (base.toLowerCase().startsWith(query)) score += 15;
      return { score: score - penalty, positions: inBase };
    }
  }
  const inPath = matchIn(query, path, 0);
  if (!inPath) return null;
  return { score: scorePositions(path, inPath) - penalty, positions: inPath };
}

/** Every space-separated term must match; scores add up. */
export function quickOpen(query: string, files: readonly string[], limit = 50): Ranked[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return files.slice(0, limit).map((path) => ({ path, score: 0, positions: [] }));
  const out: Ranked[] = [];
  for (const path of files) {
    let score = 0;
    const positions = new Set<number>();
    let ok = true;
    for (const t of terms) {
      const m = fuzzyMatch(t, path);
      if (!m) {
        ok = false;
        break;
      }
      score += m.score;
      m.positions.forEach((p) => positions.add(p));
    }
    if (ok) out.push({ path, score, positions: [...positions].sort((a, b) => a - b) });
  }
  out.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return out.slice(0, limit);
}
