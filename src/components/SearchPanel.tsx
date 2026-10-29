import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type GrepHit, type GrepResult } from "../api";
import { fileItems } from "../lib/contextMenus";
import { splitPath } from "../lib/format";
import { useAt, useStore } from "../store";
import { fileTab } from "../tabs";
import { currentWhere, menuEnv } from "./ContextMenu";
import { ListView } from "./ListView";

type Row = { type: "file"; path: string; count: number } | { type: "hit"; hit: GrepHit; key: string };

export function SearchPanel() {
  const at = useAt();
  const viewBranch = useStore((s) => s.viewBranch);
  const focusTick = useStore((s) => s.searchFocus);
  const openTab = useStore((s) => s.openTab);
  const showDir = useStore((s) => s.settings.showFolderPath);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<GrepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusTick]);

  const run = async () => {
    if (!at || !query) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.grep(at, viewBranch?.fullRef ?? null, { pattern: query, regex, caseSensitive, limit: 2000 }));
    } catch (e) {
      setResult(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    let last = "";
    const counts = new Map<string, number>();
    for (const h of result?.hits ?? []) counts.set(h.path, (counts.get(h.path) ?? 0) + 1);
    (result?.hits ?? []).forEach((h, i) => {
      if (h.path !== last) {
        out.push({ type: "file", path: h.path, count: counts.get(h.path) ?? 0 });
        last = h.path;
      }
      out.push({ type: "hit", hit: h, key: `${i}` });
    });
    return out;
  }, [result]);

  const files = new Set(result?.hits.map((h) => h.path)).size;
  return (
    <div className="panel">
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input ref={input} className="filter" placeholder={viewBranch ? `Search ${viewBranch.name}` : "Search this worktree"} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className={`toggle${caseSensitive ? " on" : ""}`} title="Match case" onClick={() => setCaseSensitive((v) => !v)}>
          Aa
        </button>
        <button type="button" className={`toggle${regex ? " on" : ""}`} title="Use regular expression" onClick={() => setRegex((v) => !v)}>
          .*
        </button>
      </form>
      <div className="muted search-summary">
        {busy ? "Searching…" : error ? <span className="error-text">{error}</span> : result ? `${result.hits.length}${result.truncated ? "+" : ""} results in ${files} files${result.truncated ? " (showing the first 2000)" : ""}` : "Press Enter to search (git grep)."}
      </div>
      <ListView<Row>
        label="Search results"
        items={rows}
        getKey={(r) => (r.type === "file" ? `f:${r.path}` : r.key)}
        selectedKey={selected}
        onSelect={(r, pin) => {
          setSelected(r.type === "file" ? `f:${r.path}` : r.key);
          if (r.type === "hit" && at) openTab(fileTab(at.cwd, r.hit.path, viewBranch?.fullRef ?? null, r.hit.line), pin);
        }}
        menu={(r) => {
          const where = currentWhere();
          if (!where || !at) return null;
          const path = r.type === "file" ? r.path : r.hit.path;
          const line = r.type === "hit" ? r.hit.line : undefined;
          return fileItems(menuEnv, where, { path, open: () => openTab(fileTab(at.cwd, path, viewBranch?.fullRef ?? null, line), true),
            history: () => void useStore.getState().openFileHistory(path),
            revealInExplorer: () => useStore.getState().revealInExplorer(path),
            onDisk: !viewBranch,
          });
        }}
        render={(r) =>
          r.type === "file" ? (
            <span className="search-file">
              <b>{splitPath(r.path).name}</b> {showDir && <span className="file-dir">{splitPath(r.path).dir}</span>}
              <span className="badge">{r.count}</span>
            </span>
          ) : (
            <span className="search-hit">
              <span className="line-no">{r.hit.line}</span>
              <span className="hit-text">{r.hit.text.trim()}</span>
            </span>
          )
        }
        empty={result ? "No results." : ""}
      />
    </div>
  );
}
