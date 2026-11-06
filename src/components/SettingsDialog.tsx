import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { errorText } from "../api";
import { loginReader, type RepoLogins } from "../lib/issueLogins";
import { RANGES, defaultSettings, getSetting, isDefault, resetAll, withSetting, type SettingPath } from "../lib/settings";
import { SECTIONS, SETTINGS, filterSettings, groupBySection, matchesQuery, type Control, type SectionId, type SettingDef } from "../lib/settingsSchema";
import { SHORTCUTS } from "../lib/shortcuts";
import { useStore } from "../store";
import { Badge, Button, Checkbox, Dialog, EmptyLine, Field, Keys, Select, SettingRow, Toggle } from "../ui";
import "../settings.css";

const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.title;
const ALL_PATHS = SETTINGS.map((d) => d.path);

/** VS Code-style Settings, over the app. One scrolling body holds every section, so search filters across them; the nav follows the scroll. Every change applies and saves at once. */
export function SettingsDialog() {
  const settings = useStore((s) => s.settings);
  const query = useStore((s) => s.settingsQuery);
  const setQuery = useStore((s) => s.setSettingsQuery);
  const updateSettings = useStore((s) => s.updateSettings);
  const openSettingsFile = useStore((s) => s.openSettingsFile);
  const closeSettings = useStore((s) => s.closeSettings);
  const opensAt = useStore((s) => s.settingsSection);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [spied, setSpied] = useState(opensAt);
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Logins are read once per visit to Settings.
  const [readLogins] = useState(loginReader);

  useEffect(() => {
    if (!confirmReset) return;
    const t = window.setTimeout(() => setConfirmReset(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmReset]);

  const groups = groupBySection(filterSettings(SETTINGS, query));
  const repos = settings.repos.filter((r) => matchesQuery(query, sectionTitle("repositories"), r, "base branch", settings.base[r] ?? "", "issues github account login", settings.issueAccounts[r] ?? ""));
  const noRepos = settings.repos.length === 0 && matchesQuery(query, sectionTitle("repositories"));
  const shortcuts = SHORTCUTS.filter((s) => matchesQuery(query, sectionTitle("shortcuts"), "keyboard keys", s.keys, s.action, s.where));
  const modified = ALL_PATHS.filter((p) => !isDefault(settings, p)).length;

  const sections: { id: SectionId; content: ReactNode }[] = groups.map(({ section, settings: defs }) => ({ id: section.id, content: defs.map((d) => <SettingLine key={d.path} def={d} />) }));
  if (repos.length > 0 || noRepos) {
    const list = noRepos ? (
      <p className="muted set-note">No repositories yet. Add one from the Repository menu at the top left.</p>
    ) : (
      <>
        <p className="muted set-note">
          The repositories in the Repository menu. Removing one only takes it off the list. The base branch is what “Branch vs base” compares against; leave it empty to pick development, main or master automatically. The account is the login a repository's issues are read with.
        </p>
        {repos.map((r, i) => (
          <RepoRow key={r} id={r} n={i} readLogins={readLogins} />
        ))}
      </>
    );
    // The section's own settings (auto-refresh) come first, then the repositories.
    const own = sections.find((s) => s.id === "repositories");
    if (own)
      own.content = (
        <>
          {own.content}
          {list}
        </>
      );
    else sections.push({ id: "repositories", content: list });
  }
  if (shortcuts.length > 0)
    sections.push({
      id: "shortcuts",
      content: (
        <table className="keys-t">
          <tbody>
            {shortcuts.map((s) => (
              <tr key={s.keys + s.action}>
                <td>
                  <Keys keys={[s.keys]} />
                </td>
                <td>{s.action}</td>
                <td className="muted">{s.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    });
  const on = sections.some((s) => s.id === spied) ? spied : sections[0]?.id;

  const goTo = (id: SectionId) => {
    const el = body.current?.querySelector<HTMLElement>(`section[data-sec="${id}"]`);
    if (el) body.current!.scrollTop = el.offsetTop - 4;
    setSpied(id);
  };
  const follow = () => {
    const b = body.current!;
    let id: SectionId | undefined;
    b.querySelectorAll<HTMLElement>("section[data-sec]").forEach((s) => {
      if (s.offsetTop <= b.scrollTop + 24) id = s.dataset.sec as SectionId;
    });
    if (id) setSpied(id);
  };
  useLayoutEffect(() => goTo(opensAt), [opensAt]);

  return (
    <Dialog
      title="Settings"
      className="set-dlg"
      head={
        <Button
          kind="link"
          className="set-json"
          text="Open settings.json"
          tip="Show the saved settings file (read-only)"
          onClick={() => {
            setFileError(null);
            openSettingsFile().catch((e) => setFileError(errorText(e)));
          }}
        />
      }
      onClose={closeSettings}
      onEscape={() => {
        if (!query) return false;
        setQuery("");
        search.current?.focus();
        return true;
      }}
    >
      {fileError && (
        <div className="set-err set-file" role="alert">
          {fileError}
        </div>
      )}
      <div className="set-split">
        <div className="set-rail">
          <Field
            ref={search}
            search
            data-autofocus
            className="set-q"
            placeholder="Search settings"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (body.current) body.current.scrollTop = 0;
            }}
          />
          <nav className="set-nav" aria-label="Sections">
            {sections.map(({ id }) => (
              <Toggle key={id} className="set-n" text={sectionTitle(id)} on={on === id} onClick={() => goTo(id)} />
            ))}
          </nav>
          <div className="set-foot">
            <Toggle
              text={confirmReset ? "Click again to reset all" : "Reset all"}
              on={confirmReset}
              disabled={modified === 0 ? "No settings have been changed" : undefined}
              tip="Put every setting on this page back to its default. Added repositories, their base branches and accounts are kept."
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                updateSettings(resetAll(settings, ALL_PATHS));
                setConfirmReset(false);
              }}
            />
            {modified > 0 && (
              <span className="muted set-count" role="status">
                {modified} changed
              </span>
            )}
          </div>
        </div>
        <div ref={body} className="set-b" onScroll={follow}>
          {sections.map(({ id, content }) => (
            <section key={id} className="set-sec" data-sec={id} aria-label={sectionTitle(id)}>
              <h2>{sectionTitle(id)}</h2>
              {content}
            </section>
          ))}
          {sections.length === 0 && <EmptyLine>No settings match “{query.trim()}”.</EmptyLine>}
        </div>
      </div>
    </Dialog>
  );
}

function SettingLine({ def }: { def: SettingDef }) {
  const changed = useStore((s) => !isDefault(s.settings, def.path));
  const set = (v: string | number | boolean) => {
    const { settings, updateSettings } = useStore.getState();
    updateSettings(withSetting(settings, def.path, v));
  };
  const id = `setting-${def.path}`;
  return (
    <SettingRow
      label={def.label}
      description={def.description}
      htmlFor={id}
      modified={changed}
      control={<SettingControl id={id} def={def} onChange={set} />}
      reset={changed && <Button kind="link" size="sm" className="set-rst" text="Reset to default" tip={`Default: ${describeDefault(def)}`} onClick={() => set(getSetting(defaultSettings, def.path) as string | number | boolean)} />}
    />
  );
}

function SettingControl({ id, def, onChange }: { id: string; def: SettingDef; onChange: (v: string | number | boolean) => void }) {
  const value = useStore((s) => getSetting(s.settings, def.path));
  const c = def.control;
  if (c.kind === "toggle") return <Checkbox id={id} label={def.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  if (c.kind === "number") return <NumberInput id={id} label={def.label} path={def.path} value={value as number} control={c} onChange={onChange} />;
  if (c.kind === "text") return <TextInput id={id} label={def.label} value={value as string} placeholder={c.placeholder} onChange={onChange} />;
  const at = c.options.findIndex((o) => o.value === value);
  // A hand-edited value that is no option shows as it is.
  return <Select id={id} label={def.label} value={at < 0 ? String(value) : String(at)} options={c.options.map((o, i) => ({ value: String(i), label: o.label }))} popWidth={220} onPick={(v) => onChange(c.options[Number(v)].value)} />;
}

function describeDefault(def: SettingDef): string {
  const v = getSetting(defaultSettings, def.path);
  if (def.control.kind === "select") return def.control.options.find((o) => o.value === v)?.label ?? String(v);
  if (def.control.kind === "toggle") return v ? "on" : "off";
  return String(v);
}

/** Applies each valid value as it is typed; out-of-range input is clamped when the field loses focus. The arrow keys step it. */
function NumberInput(p: { id: string; label: string; path: SettingPath; value: number; control: Extract<Control, { kind: "number" }>; onChange: (v: number) => void }) {
  const [min, max, whole] = RANGES[p.path]!;
  const [draft, setDraft] = useState(String(p.value));
  useEffect(() => setDraft(String(p.value)), [p.value]);
  const parse = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  const clamp = (n: number) => Math.min(max, Math.max(min, whole ? Math.round(n) : n));
  const inRange = (n: number) => Number.isFinite(n) && n >= min && n <= max && (!whole || Number.isInteger(n));
  const save = (v: number) => {
    if (v !== p.value) p.onChange(v);
    setDraft(String(v));
  };
  const commit = () => {
    const n = parse(draft);
    if (Number.isFinite(n)) save(clamp(n));
    else setDraft(String(p.value));
  };
  return (
    <Field
      id={p.id}
      className="set-num"
      label={p.label}
      inputMode="numeric"
      value={draft}
      invalid={!inRange(parse(draft))}
      suffix={`${p.control.unit ? `${p.control.unit} · ` : ""}${min}–${max}`}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parse(e.target.value);
        if (inRange(v) && v !== p.value) p.onChange(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const n = parse(draft);
          save(clamp((Number.isFinite(n) ? n : min) + (e.key === "ArrowUp" ? p.control.step : -p.control.step)));
        }
      }}
    />
  );
}

/** Applies as typed; an emptied field goes back to the saved value when it loses focus. */
function TextInput(p: { id: string; label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(p.value);
  useEffect(() => setDraft(p.value), [p.value]);
  return (
    <Field
      id={p.id}
      className="set-txt"
      label={p.label}
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

function RepoRow({ id, n, readLogins }: { id: string; n: number; readLogins: ReturnType<typeof loginReader> }) {
  const info = useStore((s) => s.repos[id]);
  const saved = useStore((s) => s.settings.base[id] ?? "");
  const account = useStore((s) => s.settings.issueAccounts[id] ?? "");
  const isCurrent = useStore((s) => s.repo?.id === id);
  const resolved = useStore((s) => (s.repo?.id === id ? s.base : null));
  const branches = useStore((s) => (s.repo?.id === id ? s.branches : null));
  const setRepoBase = useStore((s) => s.setRepoBase);
  const removeRepo = useStore((s) => s.removeRepo);

  const name = info && "name" in info ? info.name : id.split(/[\\/]/).filter(Boolean).pop() ?? id;
  const automatic = isCurrent && resolved && !saved ? `Automatic: ${resolved}` : "Automatic (development, main or master)";
  const choices = [...new Set([...(branches ?? []).map((b) => b.name), ...(saved ? [saved] : [])])];
  const selectId = `repo-base-${n}`;

  return (
    <SettingRow
      className="repo"
      label={name}
      description={id}
      mono
      modified={!!saved || !!account}
      after={
        <>
          {isCurrent && <Badge>open</Badge>}
          <Button kind="link" size="sm" className="set-rm" text="Remove" tip="Take this repository off the list (nothing on disk changes)" onClick={() => removeRepo(id)} />
        </>
      }
      extra={info && "error" in info && <span className="setting-d set-err">⚠ {info.error}</span>}
      control={
        <>
          <span className="set-pair">
            <label className="muted" htmlFor={selectId}>
              Base branch
            </label>
            <Select id={selectId} label="Base branch" value={saved} placeholder={automatic} searchable free popWidth={240} options={[{ value: "", label: automatic }, ...choices.map((b) => ({ value: b, label: b }))]} onPick={(v) => setRepoBase(id, v || null)} />
            {saved && <Button kind="link" size="sm" text="Reset to default" tip="Pick the base branch automatically again" onClick={() => setRepoBase(id, null)} />}
          </span>
          {info && "root" in info && <IssueAccount id={id} n={n} at={{ repo: id, cwd: info.root }} readLogins={readLogins} />}
        </>
      }
    />
  );
}

/** The login the repository's issues are read with; shown once its tracker and logins are known. */
function IssueAccount({ id, n, at, readLogins }: { id: string; n: number; at: { repo: string; cwd: string }; readLogins: ReturnType<typeof loginReader> }) {
  const saved = useStore((s) => s.settings.issueAccounts[id] ?? "");
  const setIssueAccount = useStore((s) => s.setIssueAccount);
  const [read, setRead] = useState<RepoLogins | null>(null);
  useEffect(() => {
    let live = true;
    void readLogins(at).then((r) => live && setRead(r));
    return () => {
      live = false;
    };
  }, [readLogins, at.repo, at.cwd]);
  if (!read) return null;

  const { tracker, logins } = read;
  const label = `${tracker.name} account`;
  const selectId = `repo-account-${n}`;
  const fallback = logins.default ? `Default (${logins.default})` : "Default login";
  const names = [...new Set([...logins.accounts, ...(saved ? [saved] : [])])];
  const fixed = logins.fixedBy ? `${logins.fixedBy} is set, so Grove uses that token for every repository.` : undefined;
  return (
    <span className="set-pair">
      <label className="muted" htmlFor={selectId}>
        {label}
      </label>
      <Select
        id={selectId}
        label={label}
        value={fixed ? null : saved}
        placeholder={fixed ? `From ${logins.fixedBy}` : fallback}
        disabled={fixed}
        searchable
        free
        popWidth={240}
        options={[{ value: "", label: fallback }, ...names.map((a) => ({ value: a, label: a }))]}
        onPick={(v) => setIssueAccount(id, v || null)}
      />
    </span>
  );
}
