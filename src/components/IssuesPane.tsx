import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef } from "react";
import type { IssueSummary } from "../api";
import { useIssueList, useIssues, type IssueList } from "../issuesStore";
import { isoToUnix, relativeTime } from "../lib/format";
import { useNow } from "../lib/useNow";
import { assigneeChoices, filterIssues, issueProblem, labelChoices, labelColors, type IssueAction } from "../lib/issues";
import { Badge, Button, Count, Empty, Field, Row, Select, Skeleton, Tray, type SelectOption } from "../ui";
import { IssueStateMark } from "./IssueStateIcon";
import { ListView, useCommitRowHeight, type ListRow } from "./ListView";
import { issuesOnScreen, useStore } from "../store";
import { issueTabId } from "../tabs";
import "../panes.css";

/** Labels shown on a row before the rest become "+n". */
const ROW_LABELS = 2;
/** The value of the "any" option; with no filter the select shows its name instead, as the mock does. */
const ANY = "";
const SKELETON = ["78%", "62%", "84%", "55%", "70%", "66%", "74%", "58%"];

/** The repository's issues in the list pane; the issues store loads them while they are on screen. */
export function IssuesPane() {
  const list = useIssueList();
  const pane = useRef<HTMLElement>(null);
  const onScreen = useStore(issuesOnScreen);
  // A request for the keyboard (Ctrl+I) made before the issues arrived.
  const wantsFocus = useStore((s) => s.issuesFocus);
  const problem = list.error && issueProblem(list.error, list.tracker, list.loaded);
  const ready = list.loaded && !problem;

  // Taken once the list is there; dropped when there is none to take it, so it cannot steal the keyboard later.
  useEffect(() => {
    if (!wantsFocus) return;
    if (!ready && !problem && onScreen) return;
    if (ready && onScreen) pane.current?.querySelector<HTMLElement>(".lbox")?.focus();
    useStore.setState({ issuesFocus: false });
  }, [wantsFocus, ready, !!problem, onScreen]);
  useEffect(() => () => useStore.setState({ issuesFocus: false }), []);

  return (
    <aside ref={pane} className="ui-root left issues-pane">
      {problem ? <Empty title={problem.title} text={problem.text} action={problem.action && <ProblemAction action={problem.action} />} /> : list.loaded ? <IssueBrowser list={list} /> : <IssueSkeleton />}
    </aside>
  );
}

function ProblemAction({ action }: { action: IssueAction }) {
  const openSettings = useStore((s) => s.openSettings);
  const run = () => (action.kind === "open" ? void openUrl(action.url) : openSettings("repositories"));
  return <Button text={action.label} onClick={run} />;
}

function IssueSkeleton() {
  return (
    <div className="pane-body" aria-busy="true" aria-label="Loading issues">
      {SKELETON.map((w) => (
        <Row key={w} role="presentation" className="commit" lead={<Skeleton width="16px" height={16} />}>
          <span className="cm">
            <Skeleton width={w} />
            <Skeleton width="40%" />
          </span>
        </Row>
      ))}
    </div>
  );
}

const choices = (any: string, names: readonly string[]): SelectOption[] => [{ value: ANY, label: any }, ...names.map((n) => ({ value: n, label: n }))];

function IssueBrowser({ list }: { list: IssueList }) {
  const setFilter = useIssues((s) => s.setFilter);
  const loadMore = useIssues((s) => s.loadMore);
  const openIssue = useStore((s) => s.openIssue);
  // The row of the issue shown in the editor area.
  const selected = useStore((s) => s.tabs.find((t) => t.id === s.activeTab && t.kind === "issue")?.id ?? null);
  const rowHeight = useCommitRowHeight();
  const now = useNow(30_000);
  const { filter, issues, more, tracker } = list;
  const shown = useMemo(() => filterIssues(issues, filter), [issues, filter]);
  const labels = useMemo(() => choices("Any label", labelChoices(issues)), [issues]);
  const assignees = useMemo(() => choices("Anyone", assigneeChoices(issues)), [issues]);

  const loadMoreButton = more && <Button kind="link" text="Load more" loading={list.loading === "loadMore"} onClick={() => void loadMore()} />;
  return (
    <div className="pane-body">
      <div className="pane-seg">
        <Tray<"open" | "closed">
          label="State"
          value={filter.state}
          items={[
            ["open", "Open"],
            ["closed", "Closed"],
          ]}
          onChange={(state) => setFilter({ state })}
        />
        <Select label="Label" placeholder="Label" value={filter.label} options={labels} searchable onPick={(v) => setFilter({ label: v || null })} />
        <Select label="Assignee" placeholder="Assignee" value={filter.assignee} options={assignees} searchable onPick={(v) => setFilter({ assignee: v || null })} />
      </div>
      <div className="filter-row">
        <Field
          search
          placeholder="Filter by title or #number"
          label="Filter issues"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape" && filter.text) {
              e.preventDefault();
              setFilter({ text: "" });
            }
          }}
        />
      </div>
      <ListView<IssueSummary>
        label="Issues"
        className="commits"
        items={shown}
        rowHeight={rowHeight}
        getKey={(i) => issueTabId(i.number)}
        selectedKey={selected}
        onSelect={(i, pin) => openIssue(i.number, i.title, pin)}
        render={(i) => issueRow(i, now)}
        empty={
          <>
            {issues.length ? `No loaded issues match. More may be on ${tracker?.name ?? "the tracker"}.` : "No issues yet."}
            {loadMoreButton}
          </>
        }
      />
      {shown.length > 0 && (
        <div className="panel-toolbar">
          <span className="muted">{more ? `${issues.length} most recently updated` : `All ${issues.length} issues loaded`}</span>
          {loadMoreButton}
        </div>
      )}
    </div>
  );
}

function issueRow(i: IssueSummary, now: number): ListRow {
  const sub = [`#${i.number}`, i.author?.name, relativeTime(isoToUnix(i.updatedAt), now)].filter(Boolean).join(" · ");
  const extra = i.labels.length - ROW_LABELS;
  return {
    className: "commit",
    title: `#${i.number} ${i.title}`,
    lead: <IssueStateMark state={i.state} />,
    main: (
      <span className="cm">
        <span className="s ell">{i.title}</span>
        <span className="m iss-sub">
          <span className="ell">{sub}</span>
          {i.labels.slice(0, ROW_LABELS).map((l) => (
            <Badge key={l.name} style={labelColors(l.color)}>
              {l.name}
            </Badge>
          ))}
          {extra > 0 && <span title={i.labels.slice(ROW_LABELS).map((l) => l.name).join(", ")}>+{extra}</span>}
        </span>
      </span>
    ),
    trail: i.commentCount > 0 ? <Count n={i.commentCount} title={`${i.commentCount} ${i.commentCount === 1 ? "comment" : "comments"}`} /> : undefined,
  };
}
