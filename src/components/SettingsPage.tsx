import { useEffect, useRef, useState } from "react";
import { errorText } from "../api";
import { RANGES, defaultSettings, getSetting, isDefault, resetAll, withSetting, type SettingPath } from "../lib/settings";
import { SECTIONS, SETTINGS, filterSettings, groupBySection, matchesQuery, type SettingDef } from "../lib/settingsSchema";
import { SHORTCUTS } from "../lib/shortcuts";
import { useStore } from "../store";

const sectionTitle = (id: string) => SECTIONS.find((s) => s.id === id)!.title;
const ALL_PATHS = SETTINGS.map((d) => d.path);

/** VS Code-style Settings, shown as an editor tab. Every change applies and saves at once. */
export function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const query = useStore((s) => s.settingsQuery);
  const setQuery = useStore((s) => s.setSettingsQuery);
  const updateSettings = useStore((s) => s.updateSettings);
  const openSettingsFile = useStore((s) => s.openSettingsFile);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => search.current?.focus(), []);
  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const groups = groupBySection(filterSettings(SETTINGS, query));
  const repos = settings.repos.filter((r) => matchesQuery(query, sectionTitle("repositories"), r, "base branch", settings.base[r] ?? ""));
  const shortcuts = SHORTCUTS.filter((s) => matchesQuery(query, sectionTitle("shortcuts"), "keyboard keys", s.keys, s.action, s.where));
  const modified = ALL_PATHS.filter((p) => !isDefault(settings, p)).length;
  const nothing = groups.length === 0 && repos.length === 0 && shortcuts.length === 0;

  return (
    <div className="settings-page">
      <div className="settings-head">
        <input
          ref={search}
          className="settings-search"
          type="search"
          placeholder="Search settings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
        <div className="settings-actions">
          <span className="muted">{modified === 0 ? "All settings are at their defaults" : `${modified} changed`}</span>
          <span className="spacer" />
          <button
            className="link"
            title="Show the saved settings file (read-only)"
            onClick={() => {
              setFileError(null);
              openSettingsFile().catch((e) => setFileError(errorText(e)));
            }}
          >
            Open settings.json
          </button>
          <button
            className={`toggle${confirmReset ? " on" : ""}`}
            disabled={modified === 0}
            title="Put every setting on this page back to its default. Added repositories and their base branches are kept."
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              updateSettings(resetAll(settings, ALL_PATHS));
              setConfirmReset(false);
            }}
          >
            {confirmReset ? "Click again to reset all" : "Reset all"}
          </button>
        </div>
        {fileError && <div className="error-text">{fileError}</div>}
      </div>
      <div className="settings-body">
        {nothing && <p className="muted settings-none">No settings match “{query.trim()}”.</p>}
        {groups.map(({ section, settings: defs }) => (
          <section key={section.id} className="settings-section">
            <h2>{section.title}</h2>
            {defs.map((d) => (
              <SettingRow key={d.path} def={d} />
            ))}
          </section>
        ))}
        {repos.length > 0 && (
          <section className="settings-section">
            <h2>{sectionTitle("repositories")}</h2>
            <p className="setting-desc">
              The repositories in the Repository menu. Removing one only takes it off the list. The base branch is what “Branch vs base” compares against; leave it
              empty to pick development, main or master automatically.
            </p>
            {repos.map((r) => (
              <RepoRow key={r} id={r} />
            ))}
          </section>
        )}
        {settings.repos.length === 0 && matchesQuery(query, sectionTitle("repositories")) && (
          <section className="settings-section">
            <h2>{sectionTitle("repositories")}</h2>
            <p className="setting-desc">No repositories yet. Add one from the Repository menu at the top left.</p>
          </section>
        )}
        {shortcuts.length > 0 && (
          <section className="settings-section">
            <h2>{sectionTitle("shortcuts")}</h2>
            <table className="shortcut-table">
              <tbody>
                {shortcuts.map((s) => (
                  <tr key={s.keys + s.action}>
                    <td>
                      <kbd>{s.keys}</kbd>
                    </td>
                    <td>{s.action}</td>
                    <td className="muted">{s.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}

function SettingRow({ def }: { def: SettingDef }) {
  const value = useStore((s) => getSetting(s.settings, def.path));
  const changed = useStore((s) => !isDefault(s.settings, def.path));
  const set = (v: string | number | boolean) => {
    const { settings, updateSettings } = useStore.getState();
    updateSettings(withSetting(settings, def.path, v));
  };
  const reset = () => set(getSetting(defaultSettings, def.path) as string | number | boolean);
  const id = `setting-${def.path}`;
  const c = def.control;

  return (
    <div className={`setting${changed ? " modified" : ""}`}>
      <div className="setting-title">
        <label htmlFor={id}>
          <span className="muted">{sectionTitle(def.section)}: </span>
          <b>{def.label}</b>
        </label>
        {changed && (
          <button className="link setting-reset" title={`Default: ${describeDefault(def)}`} onClick={reset}>
            Reset to default
          </button>
        )}
      </div>
      {c.kind === "toggle" ? (
        <label className="setting-check">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />
          <span className="setting-desc">{def.description}</span>
        </label>
      ) : (
        <>
          <div className="setting-desc">{def.description}</div>
          {c.kind === "select" && (
            <select id={id} value={String(c.options.findIndex((o) => o.value === value))} onChange={(e) => set(c.options[Number(e.target.value)].value)}>
              {!c.options.some((o) => o.value === value) && <option value="-1">{String(value)}</option>}
              {c.options.map((o, i) => (
                <option key={i} value={i}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {c.kind === "number" && <NumberInput id={id} path={def.path} value={value as number} step={c.step} unit={c.unit} onChange={set} />}
          {c.kind === "text" && <TextInput id={id} value={value as string} placeholder={c.placeholder} onChange={set} />}
        </>
      )}
    </div>
  );
}

function describeDefault(def: SettingDef): string {
  const v = getSetting(defaultSettings, def.path);
  if (def.control.kind === "select") return def.control.options.find((o) => o.value === v)?.label ?? String(v);
  if (def.control.kind === "toggle") return v ? "on" : "off";
  return String(v);
}

/** Applies each valid value as it is typed; out-of-range input is clamped when the field loses focus. */
function NumberInput(p: { id: string; path: SettingPath; value: number; step: number; unit?: string; onChange: (v: number) => void }) {
  const [min, max, whole] = RANGES[p.path]!;
  const [draft, setDraft] = useState(String(p.value));
  useEffect(() => setDraft(String(p.value)), [p.value]);
  const parse = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  const n = parse(draft);
  const valid = Number.isFinite(n) && n >= min && n <= max && (!whole || Number.isInteger(n));
  const commit = () => {
    if (!Number.isFinite(n)) return setDraft(String(p.value));
    const v = Math.min(max, Math.max(min, whole ? Math.round(n) : n));
    if (v !== p.value) p.onChange(v);
    setDraft(String(v));
  };
  return (
    <span className="setting-number">
      <input
        id={p.id}
        type="number"
        min={min}
        max={max}
        step={p.step}
        value={draft}
        className={valid ? "" : "invalid"}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = parse(e.target.value);
          if (Number.isFinite(v) && v >= min && v <= max && (!whole || Number.isInteger(v)) && v !== p.value) p.onChange(v);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
      <span className="muted">
        {p.unit ? `${p.unit} · ` : ""}
        {min}–{max}
      </span>
    </span>
  );
}

/** Applies as typed; an emptied field goes back to the saved value when it loses focus. */
function TextInput(p: { id: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(p.value);
  useEffect(() => setDraft(p.value), [p.value]);
  return (
    <input
      id={p.id}
      className="setting-text"
      spellCheck={false}
      value={draft}
      placeholder={p.placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) p.onChange(e.target.value);
      }}
      onBlur={() => !draft.trim() && setDraft(p.value)}
    />
  );
}

function RepoRow({ id }: { id: string }) {
  const info = useStore((s) => s.repos[id]);
  const saved = useStore((s) => s.settings.base[id] ?? "");
  const isCurrent = useStore((s) => s.repo?.id === id);
  const resolved = useStore((s) => (s.repo?.id === id ? s.base : null));
  const branches = useStore((s) => (s.repo?.id === id ? s.branches : null));
  const setRepoBase = useStore((s) => s.setRepoBase);
  const removeRepo = useStore((s) => s.removeRepo);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  const name = info && "name" in info ? info.name : id.split(/[\\/]/).filter(Boolean).pop() ?? id;
  const commit = () => draft.trim() !== saved && setRepoBase(id, draft.trim() || null);
  const listId = `branches-${id}`;

  return (
    <div className={`setting repo-setting${saved ? " modified" : ""}`}>
      <div className="setting-title">
        <b>{name}</b>
        {isCurrent && <span className="badge repo-open">open</span>}
        <span className="spacer" />
        <button className="link" title="Take this repository off the list (nothing on disk changes)" onClick={() => removeRepo(id)}>
          Remove
        </button>
      </div>
      <div className="setting-desc mono selectable">{id}</div>
      {info && "error" in info && <div className="error-text">⚠ {info.error}</div>}
      <label className="repo-base">
        <span>Base branch</span>
        <input
          list={branches ? listId : undefined}
          spellCheck={false}
          value={draft}
          placeholder={isCurrent && resolved && !saved ? `Automatic: ${resolved}` : "Automatic (development, main or master)"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {branches && (
          <datalist id={listId}>
            {branches.map((b) => (
              <option key={b.fullRef} value={b.name} />
            ))}
          </datalist>
        )}
        {saved && (
          <button className="link" title="Pick the base branch automatically again" onClick={() => setRepoBase(id, null)}>
            Reset to default
          </button>
        )}
      </label>
    </div>
  );
}
