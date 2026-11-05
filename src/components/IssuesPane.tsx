import { useEffect, useMemo, useState } from "react";
import type { IssueSummary } from "../api";
import { useIssueList, useIssues, type IssueList } from "../issuesStore";
import { isoToUnix, relativeTime } from "../lib/format";
import { assigneeChoices, filterIssues, issueProblem, labelChoices, labelColors } from "../lib/issues";
import { Badge, Button, Count, Empty, Field, Row, Select, Skeleton, Tray, type SelectOption } from "../ui";
import { Icon } from "./Icon";
import { ListView, useCommitRowHeight, type ListRow } from "./ListView";
import "../panes.css";

/** Labels shown on a row before the rest become "+n". */
const ROW_LABELS = 2;
/** The value of the "any" option; with no filter the select shows its name instead, as the mock does. */
const ANY = "";
const SKELETON = ["78%", "62%", "84%", "55%", "70%", "66%", "74%", "58%"];

/** The repository's issues in the list pane: loaded while it is shown, checked every minute. */
export function IssuesPane() {
  const list = useIssueList();

  useEffect(() => {
    useIssues.getState().show();
    return () => useIssues.getState().hide();
  }, []);

  const problem = list.error && issueProblem(list.error, list.tracker, list.loaded);
  return (
    <aside className="ui-root left issues-pane">
      {problem ? <Empty title={problem.title} text={problem.text} /> : list.loaded ? <IssueBrowser list={list} /> : <IssueSkeleton />}
    </aside>
  );
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
  const rowHeight = useCommitRowHeight();
  // Opening an issue as a tab comes with the issue view; until then a row is only selected.
  const [selected, setSelected] = useState<number | null>(null);
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
        getKey={(i) => String(i.number)}
        selectedKey={selected === null ? null : String(selected)}
        onSelect={(i) => setSelected(i.number)}
        render={issueRow}
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

function issueRow(i: IssueSummary): ListRow {
  const open = i.state === "open";
  const sub = [`#${i.number}`, i.author?.name, relativeTime(isoToUnix(i.updatedAt))].filter(Boolean).join(" · ");
  const extra = i.labels.length - ROW_LABELS;
  return {
    className: "commit",
    title: `#${i.number} ${i.title}`,
    lead: (
      <span title={open ? "Open" : "Closed"} className={open ? undefined : "muted"}>
        <Icon name={open ? "issues" : "pass"} size={16} />
      </span>
    ),
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
