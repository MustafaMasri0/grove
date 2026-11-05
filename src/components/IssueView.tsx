// An issue tab: the issue's title, a labelled grid of its fields, its text and every comment.
// Issue text is untrusted: it is sanitised, its web images are not loaded, and links open in the browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import type { IssueComment, IssuePerson, TrackerInfo } from "../api";
import { useIssueList, useIssues, useIssueView } from "../issuesStore";
import { isoToUnix, relativeTime } from "../lib/format";
import { issueViewProblem, labelColors, linkedIssue, loginInitials, splitIssueRefs } from "../lib/issues";
import { classifyLink } from "../lib/mdLinks";
import { useNow } from "../lib/useNow";
import { useStore } from "../store";
import { issueTabTitle, type IssueTab } from "../tabs";
import { Badge, Button, Chip, SectionLabel, Toolbar } from "../ui";
import { Message } from "./DocumentView";
import { InitialsAvatar } from "./Avatar";
import { Icon } from "./Icon";
import { blockImage, highlightCode, markdownHtml } from "./MarkdownPreview";

/** Each issue's scroll, kept while the app runs: switching tabs comes back to the same place. */
const scrolls = new Map<string, number>();

const ago = (iso: string, now: number) => relativeTime(isoToUnix(iso), now);
const dash = <span className="muted">–</span>;

/** A login's initials in its own colour; tracker pictures are not loaded. */
const PersonMark = ({ person, size }: { person: IssuePerson; size: number }) => <InitialsAvatar seed={person.name} text={loginInitials(person.name)} size={size} />;

const Who = ({ person }: { person: IssuePerson }) => (
  <span className="iss-who">
    <PersonMark person={person} size={18} />
    {person.name}
  </span>
);

/** Stands in for an image: issue text loads none. A web image opens in the browser. */
function blockIssueImage(img: HTMLImageElement) {
  const src = img.getAttribute("src") ?? "";
  if (classifyLink(src) === "external") blockImage(img, { href: src, tip: "Remote image not loaded. Click to open it in your browser." });
  else blockImage(img);
}

/** Turns `#123` in plain text (not code, not links) into links that open the issue as a tab. */
function linkIssueRefs(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const parts = splitIssueRefs(t.data);
    if (parts.length === 1 && typeof parts[0] === "string") continue;
    t.replaceWith(
      ...parts.map((p) => {
        if (typeof p === "string") return p;
        const a = document.createElement("a");
        a.href = `#issue-${p}`;
        a.dataset.issue = String(p);
        a.textContent = `#${p}`;
        return a;
      }),
    );
  }
}

/** Issue text as GitHub-flavoured Markdown; `onIssue` follows a reference to an issue. */
function IssueMarkdown({ text, tracker, onIssue }: { text: string; tracker: TrackerInfo | null; onIssue: (n: number) => void }) {
  const ref = useRef<HTMLElement>(null);
  const html = useMemo(() => markdownHtml(text), [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    el.querySelectorAll("img").forEach(blockIssueImage);
    linkIssueRefs(el);
    highlightCode(el, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html]);

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const image = target.closest<HTMLElement>("[data-href]");
    if (image?.dataset.href) return void openUrl(image.dataset.href);
    const a = target.closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const n = a.dataset.issue ? Number(a.dataset.issue) : linkedIssue(href, tracker);
    if (n !== null) onIssue(n);
    else if (classifyLink(href) === "external") void openUrl(href);
  };

  return <article ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function CommentCard({ c, author, tracker, now, onIssue }: { c: IssueComment; author: string | null; tracker: TrackerInfo | null; now: number; onIssue: (n: number) => void }) {
  const name = c.author?.name ?? "ghost";
  return (
    <div className="iss-c">
      <PersonMark person={c.author ?? { name, avatarUrl: null }} size={24} />
      <div className="card">
        <Toolbar>
          <b>{name}</b>
          <span className="muted" title={new Date(c.createdAt).toLocaleString()}>
            {ago(c.createdAt, now)}
          </span>
          <span className="spacer" />
          {author !== null && c.author?.name === author && <Chip>Author</Chip>}
        </Toolbar>
        {c.body.trim() ? <IssueMarkdown text={c.body} tracker={tracker} onIssue={onIssue} /> : <p className="md-preview muted">No text.</p>}
      </div>
    </div>
  );
}

/** Shows `tab`'s issue, loading it (with its comments) when it is not loaded yet. */
export function IssueView({ tab }: { tab: IssueTab }) {
  const view = useIssueView(tab.number);
  const tracker = useIssueList().tracker;
  const loadIssue = useIssues((s) => s.loadIssue);
  const setTabTitle = useStore((s) => s.setTabTitle);
  const pinTab = useStore((s) => s.pinTab);
  const openIssue = useStore((s) => s.openIssue);
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);
  const { detail, error } = view;
  const scrollKey = `${tab.repo}\n${tab.number}`;

  // The issue being read stays open; the followed one comes up as the preview.
  const follow = (n: number) => {
    if (n === tab.number) return;
    pinTab(tab.id);
    openIssue(n, undefined, false);
  };

  useEffect(() => {
    void loadIssue(tab.number);
  }, [tab.number, loadIssue]);

  // A tab opened from a reference knows only the number until the issue arrives.
  useEffect(() => {
    if (detail) setTabTitle(tab.id, issueTabTitle(tab.number, detail.issue.title));
  }, [detail, tab.id, tab.number, setTabTitle]);

  useLayoutEffect(() => {
    if (detail && scroller.current) scroller.current.scrollTop = scrolls.get(scrollKey) ?? 0;
  }, [scrollKey, !!detail]);

  let toolbar: ReactNode = null;
  let body: ReactNode;
  if (detail) {
    const i = detail.issue;
    const open = i.state === "open";
    toolbar = (
      <Toolbar>
        <span className="crumb">
          <span className={open ? "st-tag" : "st-tag idle"}>
            <Icon name={open ? "issues" : "pass"} size={14} />
            <span>{open ? "Open" : "Closed"}</span>
          </span>
          <span className="muted num">#{i.number}</span>
        </span>
        <span className="spacer" />
        {tracker && <Button kind="ghost" size="sm" text={`Open on ${tracker.name}`} after={<Icon name="link" size={13} />} onClick={() => void openUrl(i.webUrl)} />}
      </Toolbar>
    );
    const comments = detail.comments.length;
    body = (
      <div ref={scroller} className="ui-root md-scroll iss" onScroll={(e) => scrolls.set(scrollKey, e.currentTarget.scrollTop)}>
        <div className="iss-in">
          <h1>{i.title}</h1>
          <dl className="iss-meta">
            <dt>Author</dt>
            <dd>{i.author ? <Who person={i.author} /> : dash}</dd>
            <dt>Assignees</dt>
            <dd>{i.assignees.length ? i.assignees.map((p) => <Who key={p.name} person={p} />) : dash}</dd>
            <dt>Opened</dt>
            <dd title={new Date(i.createdAt).toLocaleString()}>{ago(i.createdAt, now)}</dd>
            <dt>Labels</dt>
            <dd>
              {i.labels.length
                ? i.labels.map((l) => (
                    <Badge key={l.name} style={labelColors(l.color)}>
                      {l.name}
                    </Badge>
                  ))
                : dash}
            </dd>
            <dt>{open ? "Updated" : "Closed"}</dt>
            <dd title={new Date(open || !i.closedAt ? i.updatedAt : i.closedAt).toLocaleString()}>{ago(open || !i.closedAt ? i.updatedAt : i.closedAt, now)}</dd>
            <dt>Milestone</dt>
            <dd>{i.milestone ?? dash}</dd>
          </dl>
          {i.body.trim() ? <IssueMarkdown text={i.body} tracker={tracker} onIssue={follow} /> : <p className="muted">No description.</p>}
          {comments > 0 && <SectionLabel text={`${comments} ${comments === 1 ? "comment" : "comments"}`} />}
          {detail.comments.map((c, k) => (
            <CommentCard key={c.webUrl || k} c={c} author={i.author?.name ?? null} tracker={tracker} now={now} onIssue={follow} />
          ))}
        </div>
      </div>
    );
  } else if (error) {
    const p = issueViewProblem(error, tab.number, tracker);
    body = <Message text={p.title} hint={p.text} />;
  } else body = <Message text="Loading…" />;

  return (
    <>
      {toolbar && <div className="ui-root ed-chrome">{toolbar}</div>}
      <div className="editor-stack">{body}</div>
    </>
  );
}
