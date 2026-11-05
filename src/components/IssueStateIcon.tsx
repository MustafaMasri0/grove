import type { IssueSummary } from "../api";
import { useIssueList, useIssueView } from "../issuesStore";
import { Icon } from "./Icon";

/** An issue's state as its mark: open, or closed and muted. Shape tells them apart, not colour. */
export function IssueStateMark({ state, size = 16 }: { state: IssueSummary["state"]; size?: number }) {
  const closed = state === "closed";
  return (
    <span className={closed ? "muted" : undefined} title={closed ? "Closed" : "Open"}>
      <Icon name={closed ? "pass" : "issues"} size={size} />
    </span>
  );
}

/** An issue tab's mark, from the loaded issue or the list. */
export function IssueStateIcon({ number }: { number: number }) {
  const detail = useIssueView(number).detail;
  const summary = useIssueList().issues.find((i) => i.number === number);
  return <IssueStateMark state={detail?.issue.state ?? summary?.state ?? "open"} size={13} />;
}
