// Every control in each state, drawn by src/ui itself. .is-hover, .is-focus and .is-active stand in for the real pseudo-classes.
// The Live section is the only interactive part: scripts/ui-check.mjs uses it to see real motion and the real overlays.
import { useRef, useState, type ReactNode } from "react";
import type { ChangeKind } from "../src/api";
import { Avatar } from "../src/components/Avatar";
import { FileTypeIcon, FolderTypeIcon } from "../src/components/FileTypeIcon";
import { Icon } from "../src/components/Icon";
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  Count,
  Delta,
  Dialog,
  EditorTab,
  Empty,
  EmptyLine,
  Field,
  FoldBody,
  FoldHead,
  IconTabs,
  Keys,
  LoadingLine,
  Mark,
  menuAtElement,
  MenuRows,
  OverlayHost,
  PathLabel,
  Picker,
  ProgressLine,
  Resizer,
  Row,
  SectionLabel,
  Select,
  SettingRow,
  Skeleton,
  Slider,
  Spinner,
  SplitButton,
  StateTag,
  StatusLetter,
  Toggle,
  Toolbar,
  Tray,
  WarnMark,
  WarnTriangle,
  type ButtonProps,
  type MarkState,
  type PickerItem,
  type RichMenuItem,
} from "../src/ui";
import { STATUS_LETTER, STATUS_TITLE, splitDisplayPath } from "../src/ui/classes";
import { SAMPLE_FILES } from "./mockIpc";

const KINDS = Object.keys(STATUS_LETTER) as ChangeKind[];
const STATES: [MarkState, string][] = [
  ["active", "Changing"],
  ["changes", "Has changes"],
  ["idle", "Clean"],
  ["error", "Push rejected"],
];
const TRAY = { label: "Demo", value: "b", items: [["a", "One"], ["b", "Two"], ["c", "Three"]] } as const;
const FETCH_ERROR = "fatal: unable to access 'https://example.com/shop-platform.git/': Could not resolve host: example.com";

function Cell({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <figure className={wide ? "gal-c wide" : "gal-c"}>
      <figcaption>{label}</figcaption>
      <div className="gal-d">{children}</div>
    </figure>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="gal-g">
      <h3>{title}</h3>
      {note && <p className="muted gal-n">{note}</p>}
      <div className="gal-cells">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gal-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <figure className="gal-sw">
      <i style={{ background: `var(${token})` }} />
      <figcaption>
        <b>{label}</b>
        <span className="mono muted">{token}</span>
      </figcaption>
    </figure>
  );
}

const SWATCHES: [string, [string, string][]][] = [
  ["Status", [["--live", "Changing"], ["--changes", "Has changes"], ["--warn", "Possible conflict"], ["--err", "Push rejected, conflict"], ["--live-bg", "Changing tint"], ["--changes-bg", "Has changes tint"], ["--warn-bg", "Possible conflict tint"], ["--err-bg", "Error tint"]]],
  ["Surfaces and lines", [["--shell", "Shell"], ["--sheet", "Sheet"], ["--card", "Card"], ["--well", "Well"], ["--fill", "Fill"], ["--wash", "Wash"], ["--press", "Press"], ["--line-strong", "Line"]]],
];

function Tokens() {
  return (
    <Section title="Tokens">
      {SWATCHES.map(([title, list]) => (
        <div className="gal-g" key={title}>
          <h3>{title}</h3>
          <div className="gal-sws">
            {list.map(([t, l]) => (
              <Swatch key={t} token={t} label={l} />
            ))}
          </div>
        </div>
      ))}
      <Group title="File kinds" note="Aliases of the status and syntax colours.">
        {KINDS.map((k) => (
          <span className="gal-kind" key={k}>
            <StatusLetter kind={k} />
            <span className={`fname k-${k}`}>{STATUS_TITLE[k]}</span>
          </span>
        ))}
      </Group>
      <div className="gal-g">
        <h3>Type scale</h3>
        <div className="gal-type">
          {[["xs", "Section labels, kbd"], ["sm", "Secondary lines, captions"], ["md", "Body text, rows"], ["lg", "Titles"], ["xl", "Large headings"]].map(([k, use]) => (
            <div className="gal-ty" key={k}>
              <span className="muted mono">{k}</span>
              <span style={{ fontSize: `var(--fs-${k})`, lineHeight: `var(--lh-${k})` }}>The quick brown fox · {use}</span>
            </div>
          ))}
          <div className="gal-ty">
            <span className="muted mono">mono</span>
            <span className="mono">0a1b2c3 src/server/api/orders/create.ts</span>
          </div>
        </div>
      </div>
    </Section>
  );
}

function ButtonStates({ title, ...o }: ButtonProps & { title: string }) {
  const force = (c: string) => [o.className, c].filter(Boolean).join(" ");
  return (
    <Group title={title}>
      <Cell label="Default"><Button {...o} /></Cell>
      <Cell label="Hover"><Button {...o} className={force("is-hover")} /></Cell>
      <Cell label="Focus"><Button {...o} className={force("is-focus")} /></Cell>
      <Cell label="Pressed"><Button {...o} className={force("is-active")} /></Cell>
      <Cell label="Disabled"><Button {...o} disabled="Unavailable here" /></Cell>
      {o.text && o.kind !== "link" && <Cell label="Loading"><Button {...o} loading /></Cell>}
    </Group>
  );
}

function Actions() {
  return (
    <Section title="Actions">
      <ButtonStates title="Button, secondary" text="Secondary" />
      <ButtonStates title="Button, primary" kind="primary" text="Primary" />
      <ButtonStates title="Button, ghost" kind="ghost" text="Ghost" />
      <Group title="Button, split">
        <Cell label="Primary"><SplitButton main={{ kind: "primary", icon: "arrow-up", text: "Publish branch" }} more={{ label: "More actions" }} /></Cell>
        <Cell label="Secondary"><SplitButton main={{ text: "Refresh" }} more={{ label: "More actions" }} /></Cell>
      </Group>
      <ButtonStates title="Button, link" kind="link" text="Link" />
      <ButtonStates title="Button, small" size="sm" text="Small" />
      <ButtonStates title="Button, icon only" kind="ghost" icon="sync" label="Refresh" />
      <ButtonStates title="Button, icon, label and shortcut" icon="search" text="Search" after={<Keys keys={["Ctrl", "K"]} />} />
      <Group title="Toggle">
        <Cell label="Off"><Toggle text="Toggle" /></Cell>
        <Cell label="On"><Toggle text="Toggle" on /></Cell>
        <Cell label="Hover"><Toggle text="Toggle" className="is-hover" /></Cell>
        <Cell label="Focus"><Toggle text="Toggle" on className="is-focus" /></Cell>
        <Cell label="Pressed"><Toggle text="Toggle" className="is-active" /></Cell>
        <Cell label="Disabled"><Toggle text="Toggle" disabled="Unavailable here" /></Cell>
        <Cell label="On, changes tone"><Toggle icon="diff" text="Has changes" on tone="changes" /></Cell>
      </Group>
      <Group title="Icon tabs">
        <Cell label="Active label">
          <IconTabs label="Demo" value="a" items={[["a", "Changes", "diff"], ["b", "History", "history"], ["c", "Explorer", "folder"], ["d", "Search", "search"]]} />
        </Cell>
      </Group>
      <Group title="Segmented tray">
        <Cell label="Default"><Tray {...TRAY} role="tablist" /></Cell>
        <Cell label="Disabled item"><Tray {...TRAY} role="tablist" items={[["a", "One"], ["b", "Two"], ["c", "Three", "Unavailable here"]]} /></Cell>
        <Cell label="Small"><Tray {...TRAY} role="tablist" small /></Cell>
        <Cell label="Pressed group"><Tray {...TRAY} /></Cell>
      </Group>
    </Section>
  );
}

const FIELD = { label: "Demo field", placeholder: "Placeholder", readOnly: true };

function Inputs() {
  return (
    <Section title="Inputs">
      <Group title="Text field">
        <Cell label="Empty"><Field {...FIELD} /></Cell>
        <Cell label="Hover"><Field {...FIELD} className="is-hover" /></Cell>
        <Cell label="Focus"><Field {...FIELD} className="is-focus" /></Cell>
        <Cell label="Filled"><Field {...FIELD} value="src/server" /></Cell>
        <Cell label="Invalid"><Field {...FIELD} value="999" invalid /></Cell>
        <Cell label="Disabled"><Field {...FIELD} disabled /></Cell>
        <Cell label="Search"><Field {...FIELD} search placeholder="Filter files" /></Cell>
        <Cell label="Suffix"><Field {...FIELD} value="13" suffix="px · 10–18" /></Cell>
        <Cell label="Mono"><Field {...FIELD} value="3f9a1c2" mono /></Cell>
      </Group>
      <Group title="Checkbox">
        <Cell label="Unchecked"><Checkbox text="Checkbox" readOnly /></Cell>
        <Cell label="Checked"><Checkbox text="Checkbox" checked readOnly /></Cell>
        <Cell label="Hover"><Checkbox text="Checkbox" className="is-hover" readOnly /></Cell>
        <Cell label="Focus"><Checkbox text="Checkbox" checked className="is-focus" readOnly /></Cell>
        <Cell label="Disabled"><Checkbox text="Checkbox" disabled readOnly /></Cell>
        <Cell label="Disabled, checked"><Checkbox text="Checkbox" checked disabled readOnly /></Cell>
      </Group>
      <Group title="Slider">
        <Cell label="Default"><Slider text="Swipe" defaultValue={40} /></Cell>
        <Cell label="Opacity"><Slider text="Opacity" defaultValue={60} /></Cell>
      </Group>
    </Section>
  );
}

function FileRow({ i, ...o }: { i: number; on?: boolean; menu?: boolean; className?: string }) {
  const f = SAMPLE_FILES[i];
  const { dir, name } = splitDisplayPath(f.path);
  return (
    <Row
      {...o}
      tabIndex={0}
      lead={<FileTypeIcon name={name} />}
      trail={
        <>
          <Delta add={[3, 31, 0][i]} del={[1, 0, 3][i]} />
          <StatusLetter kind={f.kind} />
        </>
      }
    >
      <span className={`fname k-${f.kind}`}>{name}</span>
      <span className="fdir">{dir.slice(0, -1)}</span>
    </Row>
  );
}

function TabStrip({ children }: { children: ReactNode }) {
  return (
    <div className="tabs gal-tabs">
      <div className="tabs-in" role="tablist">
        {children}
      </div>
    </div>
  );
}

const TAB = { text: "create.ts", icon: "file", mark: "±" } as const;

function Lists() {
  return (
    <Section title="Lists and data">
      <Group title="Row">
        <Cell label="Default"><div className="gal-w"><FileRow i={0} /></div></Cell>
        <Cell label="Hover"><div className="gal-w"><FileRow i={0} className="is-hover" /></div></Cell>
        <Cell label="Focus"><div className="gal-w"><FileRow i={0} className="is-focus" /></div></Cell>
        <Cell label="Selected"><div className="gal-w"><FileRow i={0} on /></div></Cell>
        <Cell label="Menu open"><div className="gal-w"><FileRow i={0} menu /></div></Cell>
      </Group>
      <Group title="List">
        <Cell label="Selected row">
          <div className="gal-w" role="listbox" aria-label="Demo list">
            {SAMPLE_FILES.map((f, i) => (
              <FileRow key={f.path} i={i} on={i === 1} />
            ))}
          </div>
        </Cell>
        <Cell label="Empty"><div className="gal-w"><EmptyLine>No uncommitted changes in this worktree.</EmptyLine></div></Cell>
        <Cell label="Loading">
          <div className="gal-w">
            <LoadingLine />
            <Row role="presentation" lead={<Skeleton width="16px" height={16} />}>
              <Skeleton width="70%" />
            </Row>
          </div>
        </Cell>
      </Group>
      <Group title="Tab">
        <Cell label="Default"><TabStrip><EditorTab {...TAB} /></TabStrip></Cell>
        <Cell label="Hover"><TabStrip><EditorTab {...TAB} className="is-hover" /></TabStrip></Cell>
        <Cell label="Focus"><TabStrip><EditorTab {...TAB} className="is-focus" /></TabStrip></Cell>
        <Cell label="Selected"><TabStrip><EditorTab {...TAB} on /></TabStrip></Cell>
        <Cell label="Preview"><TabStrip><EditorTab {...TAB} preview /></TabStrip></Cell>
      </Group>
      <Group title="Fold header">
        <Cell label="Open"><FoldHead text="Local branches" open n={4} /></Cell>
        <Cell label="Closed"><FoldHead text="Remote branches" open={false} n={2} /></Cell>
        <Cell label="Hover"><FoldHead text="Remote branches" open n={2} className="is-hover" /></Cell>
        <Cell label="Plain, a folder name"><FoldHead text="src/server" plain open /></Cell>
      </Group>
      <Group title="Data atoms">
        <Cell label="Path"><div className="gal-w"><PathLabel path="src/server/api/orders/create.ts" /></div></Cell>
        <Cell label="Status letters">{KINDS.map((k) => <StatusLetter key={k} kind={k} />)}</Cell>
        <Cell label="Delta"><Delta add={18} del={4} /></Cell>
        <Cell label="Count"><Count n={12} /></Cell>
        <Cell label="Chip"><Chip>agent-06</Chip></Cell>
        <Cell label="Chip button"><Chip onClick={() => {}}>agent-06</Chip></Cell>
        <Cell label="Chip button, hover"><Chip onClick={() => {}} className="is-hover">agent-06</Chip></Cell>
        <Cell label="Avatar">
          <Avatar name="Dev Example" email="dev@example.com" size={24} />
          <Avatar name="Ada Example" email="ada@example.com" size={18} />
        </Cell>
        <Cell label="File icons">
          {["a.ts", "a.json", "a.md", "a.html", "a.css", "a.png", "a.rs", "a.txt"].map((n) => <FileTypeIcon key={n} name={n} />)}
          <FolderTypeIcon name="src" open />
        </Cell>
        <Cell label="Keys"><Keys keys={["Ctrl", "Shift", "O"]} /></Cell>
      </Group>
      <Group title="Setting row">
        <Cell label="Default" wide>
          <SettingRow label="Minimap" description="Shows an overview of the file at the right edge." control={<Checkbox label="Minimap" checked readOnly />} />
        </Cell>
        <Cell label="Modified" wide>
          <SettingRow label="Font size" description="Text size of the file and diff views." modified control={<Field label="Font size" value="15" className="gal-num" readOnly />} reset={<Button kind="link" size="sm" text="Reset to default" />} />
        </Cell>
      </Group>
    </Section>
  );
}

function Status() {
  return (
    <Section title="Status">
      <Group title="Mark">
        {STATES.map(([s, l]) => (
          <Cell key={s} label={l}>
            <span className="gal-mk"><Mark state={s} /><span>{l}</span></span>
          </Cell>
        ))}
      </Group>
      <Group title="State tag" note="Only the exception gets a filled badge.">
        {STATES.map(([s, l]) => <Cell key={s} label={l}><StateTag state={s} label={l} /></Cell>)}
      </Group>
      <Group title="Badge" note="Coloured badges hide at zero.">
        <Cell label="Neutral"><Badge>12 worktrees</Badge></Cell>
        <Cell label="Live"><Badge tone="live">3 active</Badge></Cell>
        <Cell label="Has changes"><Badge tone="changes">5 with changes</Badge></Cell>
        <Cell label="Warn"><Badge tone="warn"><WarnTriangle />2 possible conflicts</Badge></Cell>
        <Cell label="Error"><Badge tone="error">1 push rejected</Badge></Cell>
        <Cell label="View only"><Badge tone="changes">View only</Badge></Cell>
      </Group>
      <Group title="Markers">
        <Cell label="Possible conflict count"><WarnMark n={2} /></Cell>
        <Cell label="Live pulse"><span className="gal-mk"><i className="pulse" /><span>Live</span></span></Cell>
        <Cell label="Push rejected note"><span className="err-text">Push rejected</span></Cell>
      </Group>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback">
      <Group title="Banner">
        <Cell label="Error, raw git output" wide><Banner tone="error" pre text={FETCH_ERROR} onDismiss={() => {}} /></Cell>
        <Cell label="Possible conflict" wide><Banner tone="warn" lead={<WarnTriangle />} title="Possible conflict" text="Also changed in 2 other worktrees" actions={<Chip>agent-02</Chip>} /></Cell>
        <Cell label="View only" wide><Banner tone="view" title="Viewing release/2.4" text="Read-only. Nothing is checked out." actions={<Button kind="link" text="Back to main" />} /></Cell>
        <Cell label="Neutral notice" wide><Banner lead={<Icon name="sync" size={12} />} text="Connection to dev-box lost. Reconnecting…" /></Cell>
      </Group>
      <Group title="Empty state">
        <Cell label="View"><div className="gal-empty"><Empty title="No repository open" text="Use the Repository menu at the top left to add a folder." /></div></Cell>
        <Cell label="Line in a list"><div className="gal-w"><EmptyLine action={<Button kind="link" text="Clear filter" />}>No worktrees match.</EmptyLine></div></Cell>
      </Group>
      <Group title="Loading">
        <Cell label="Loading line"><LoadingLine text="Loading worktrees…" /></Cell>
        <Cell label="Spinner"><Spinner size={16} /></Cell>
        <Cell label="Progress line"><ProgressLine text="Writing objects: 100% (3/3), done." /></Cell>
        <Cell label="Skeleton"><div className="gal-w"><Skeleton height={12} /><br /><Skeleton width="60%" /></div></Cell>
        <Cell label="Button, loading"><Button kind="primary" text="Pushing to origin" loading /></Cell>
      </Group>
    </Section>
  );
}

function Structure() {
  return (
    <Section title="Structure">
      <Group title="Card">
        <Cell label="Card">
          <div className="gal-w">
            <Card><div className="gal-pad"><b>Card</b><p className="muted">Raised surface for a group of content.</p></div></Card>
          </div>
        </Cell>
      </Group>
      <Group title="Section label"><Cell label="Label"><SectionLabel text="Local branches" /></Cell></Group>
      <Group title="Toolbar">
        <Cell label="Path and actions" wide>
          <Toolbar>
            <PathLabel path="src/server/api/orders/create.ts" />
            <span className="spacer" />
            <Button kind="ghost" size="sm" icon="arrow-up" label="Previous change" />
            <Button kind="ghost" size="sm" icon="arrow-down" label="Next change" />
          </Toolbar>
        </Cell>
      </Group>
      <Group title="Resize handle">
        <Cell label="Default"><div className="gal-rz"><Resizer label="Demo handle" /></div></Cell>
        <Cell label="Hover"><div className="gal-rz"><Resizer label="Demo handle" className="is-hover" /></div></Cell>
        <Cell label="Focus"><div className="gal-rz"><Resizer label="Demo handle" className="is-focus" /></div></Cell>
      </Group>
    </Section>
  );
}

const noop = () => {};
const MENU: RichMenuItem[] = [{ label: "Open", shortcut: "Enter", run: noop }, { label: "Copy path", run: noop }, { label: "Copy relative path", run: noop }, { separator: true }, { label: "Reveal in File Explorer", disabled: true, disabledReason: "Not available over SSH", run: noop }, { separator: true }, { label: "Close", shortcut: "Ctrl+W", run: noop }];
const CHECKS: RichMenuItem[] = [{ label: "Collapse unchanged", check: true, run: noop }, { label: "Ignore whitespace", check: false, run: noop }, { label: "Show ignored files", check: false, disabled: true, run: noop }];
const ICONS: RichMenuItem[] = [
  { label: "Go to Overview", lead: <Icon name="home" size={13} />, detail: "Worktrees and activity", trailing: <Keys keys={["Ctrl", "Shift", "O"]} />, run: noop },
  { label: "Open Settings", lead: <Icon name="gear" size={13} />, trailing: <Keys keys={["Ctrl", ","]} />, run: noop },
  { label: "agent-06", lead: <Icon name="git-branch" size={13} />, detail: "agent/payment-retry", trailing: <StateTag state="active" label="Changing" />, run: noop },
];
const PICK: PickerItem[] = [
  { key: "main", label: "main", section: "Local branches", detail: "checked out in main worktree", current: true },
  { key: "a", label: "agent/payment-retry", section: "Local branches", detail: "checked out in agent-06", trailing: <Count n={3} /> },
  { key: "r", label: "release/2.4", section: "Local branches", detail: "3 days ago · view only", menu: () => MENU as never },
  { key: "o", label: "origin/main", section: "Remote branches", detail: "2 hours ago · view only" },
];
const BRANCHES = [{ value: "main", label: "main" }, { value: "development", label: "development" }, { value: "release/2.4", label: "release/2.4" }];

function Overlays() {
  return (
    <Section title="Overlays">
      <Group title="Menu" note="The highlighted row is the active item.">
        <Cell label="Separator, disabled, shortcut"><div className="menu"><MenuRows items={MENU} active={0} /></div></Cell>
        <Cell label="Check marks"><div className="menu"><MenuRows items={CHECKS} /></div></Cell>
        <Cell label="Icon, detail, trailing"><div className="menu"><MenuRows items={ICONS} active={1} /></div></Cell>
      </Group>
      <Group title="Select">
        <Cell label="Default"><Select label="Base" value="main" options={BRANCHES} onPick={noop} /></Cell>
        <Cell label="Disabled"><Select label="Base" value="main" options={BRANCHES} onPick={noop} disabled="Unavailable here" /></Cell>
        <Cell label="Placeholder"><Select label="Base" value={null} placeholder="Pick a branch" options={BRANCHES} onPick={noop} /></Cell>
      </Group>
      <Group title="Tooltip">
        <Cell label="Short"><div className="tip">Fetch origin</div></Cell>
        <Cell label="Two lines"><div className="tip">{"Fetch origin\nLast fetched 13 minutes ago"}</div></Cell>
      </Group>
    </Section>
  );
}

/** The real overlays, opened as a person would. */
function LiveOverlays() {
  const [last, setLast] = useState("Nothing chosen yet");
  const [branch, setBranch] = useState("main");
  const [picker, setPicker] = useState(false);
  const [dialog, setDialog] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const items = MENU.map((m) => ("separator" in m ? m : { ...m, run: () => setLast(`Menu: ${m.label}`) }));
  return (
    <Group title="Overlays">
      <Cell label="Menu"><Button data-live="menu" text="Open menu" onClick={(e) => menuAtElement(e.currentTarget, items)} /></Cell>
      <Cell label="Picker">
        <Button ref={pickerButton} data-live="picker" text="Open picker" aria-expanded={picker} onClick={() => setPicker(!picker)} />
        {picker && <Picker anchor={pickerButton.current} items={PICK.map((p) => ({ ...p, current: p.label === last.slice(8) }))} searchable placeholder="Filter branches" onClose={() => setPicker(false)} onPick={(k) => setLast(`Picker: ${PICK.find((p) => p.key === k)?.label}`)} />}
      </Cell>
      <Cell label="Dialog">
        <Button data-live="dialog" text="Open dialog" onClick={() => setDialog(true)} />
        {dialog && (
          <Dialog
            title="Dialog title"
            onClose={() => setDialog(false)}
            foot={
              <>
                <span className="spacer" />
                <Button text="Cancel" onClick={() => setDialog(false)} />
                <Button kind="primary" text="Confirm" onClick={() => setDialog(false)} />
              </>
            }
          >
            <div className="gal-pad">
              <p>Dialog body text sits on the sheet.</p>
              <Field label="Name" placeholder="Name" />
            </div>
          </Dialog>
        )}
      </Cell>
      <Cell label="Select"><span data-live="select"><Select label="Live select" value={branch} options={BRANCHES} onPick={setBranch} /></span></Cell>
      <Cell label="Tooltip"><Button data-live="tip" text="Hover me" tip="A tooltip shows after a short wait" /></Cell>
      <Cell label="Last choice"><span className="muted" role="status" data-live="last">{last}</span></Cell>
    </Group>
  );
}

/** Controls that really change, so the checks can watch their motion. */
function Live() {
  const [tray, setTray] = useState<"a" | "b" | "c">("b");
  const [open, setOpen] = useState(true);
  const [on, setOn] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mark, setMark] = useState<MarkState>("changes");
  return (
    <Section title="Live">
      <Group title="Interactive">
        <Cell label="Tray"><Tray {...TRAY} value={tray} role="tablist" onChange={setTray} /></Cell>
        <Cell label="Fold">
          <div className="gal-w" data-live="fold">
            <FoldHead text="Local branches" open={open} n={1} onClick={() => setOpen(!open)} />
            <FoldBody open={open}><Row role="presentation">main</Row></FoldBody>
          </div>
        </Cell>
        <Cell label="Toggle"><Toggle data-live="toggle" icon="diff" text="Has changes" on={on} tone="changes" onClick={() => setOn(!on)} /></Cell>
        <Cell label="Checkbox"><Checkbox data-live="check" text="Possible conflicts" checked={checked} onChange={(e) => setChecked(e.target.checked)} /></Cell>
        <Cell label="State">
          <Button data-live="mark" text="Next state" onClick={() => setMark(STATES[(STATES.findIndex(([s]) => s === mark) + 1) % STATES.length][0])} />
          <Mark state={mark} />
        </Cell>
      </Group>
      <LiveOverlays />
    </Section>
  );
}

export function Gallery() {
  return (
    <>
      <div className="ui-root" id="app" data-overlay-inert="">
        <main className="gal-scroll">
          <h1 className="gal-title">Design system</h1>
          <Live />
          <Tokens />
          <Actions />
          <Inputs />
          <Overlays />
          <Lists />
          <Status />
          <Feedback />
          <Structure />
        </main>
      </div>
      <OverlayHost />
    </>
  );
}
