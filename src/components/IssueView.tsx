// An issue tab: the issue's title, a labelled grid of its fields, its text and every comment.
// Issue text is untrusted: it is sanitised, its web images are not loaded, and links open in the browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import type { IssueComment, IssuePerson, TrackerInfo } from "../api";
import { useIssueList, useIssues, useIssueView } from "../issuesStore";
import { avatarHue } from "../lib/avatar";
import { isoToUnix, relativeTime } from "../lib/format";
import { issueViewProblem, labelColors, linkedIssue, loginInitials, splitIssueRefs } from "../lib/issues";
import { classifyLink } from "../lib/mdLinks";
import { useNow } from "../lib/useNow";
import { useStore } from "../store";
import { issueTabTitle, type IssueTab } from "../tabs";
import { Badge, Button, Chip, SectionLabel, Toolbar } from "../ui";
import { Message } from "./DocumentView";
import { Icon, iconMarkup } from "./Icon";
import { highlightCode, markdownHtml } from "./MarkdownPreview";

/** Each issue's scroll, kept while the app runs: switching tabs comes back to the same place. */
const scrolls = new Map<string, number>();

const ago = (iso: string, now: number) => relativeTime(isoToUnix(iso), now);
const dash = <span className="muted">–</span>;

/** A login's initials in its own colour; tracker pictures are not loaded. */
function PersonMark({ person, size }: { person: IssuePerson; size: number }) {
  return (
    <span className="avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `hsl(${avatarHue(person.name)} 42% var(--avatar-lightness, 44%))` }}>
      {loginInitials(person.name)}
    </span>
  );
}

const Who = ({ person }: { person: IssuePerson }) => (
  <span className="iss-who">
    <PersonMark person={person} size={18} />
    {person.name}
  </span>
);

/** Stands in for a web image: its alternative text, and a click opens it in the browser. */
function blockImage(img: HTMLImageElement) {
  const src = img.getAttribute("src") ?? "";
  const alt = img.getAttribute("alt") || "Image";
  const web = classifyLink(src) === "external";
  const box = document.createElement(web ? "button" : "span");
  box.className = "md-blocked";
  if (web) {
    box.setAttribute("type", "button");
    box.dataset.href = src;
    box.setAttribute("aria-label", `Open image in browser: ${alt}`);
    box.dataset.tip = "Remote image not loaded. Click to open it in your browser.";
  } else box.setAttribute("aria-label", alt);
  box.innerHTML = iconMarkup("file-media");
  const label = document.createElement("span");
  label.className = "ell";
  label.textContent = alt;
  box.append(label);
  img.replaceWith(box);
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

/** Issue text as GitHub-flavoured Markdown. */
function IssueMarkdown({ text, tracker }: { text: string; tracker: TrackerInfo | null }) {
  const ref = useRef<HTMLElement>(null);
  const openIssue = useStore((s) => s.openIssue);
  const html = useMemo(() => markdownHtml(text), [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    el.querySelectorAll("img").forEach(blockImage);
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
    if (n !== null) openIssue(n, undefined, false);
    else if (classifyLink(href) === "external") void openUrl(href);
  };

  return <article ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

function CommentCard({ c, author, tracker, now }: { c: IssueComment; author: string | null; tracker: TrackerInfo | null; now: number }) {
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
        {c.body.trim() ? <IssueMarkdown text={c.body} tracker={tracker} /> : <p className="md-preview muted">No text.</p>}
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
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);
  const { detail, error } = view;
  const scrollKey = `${tab.repo}\n${tab.number}`;

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
          {i.body.trim() ? <IssueMarkdown text={i.body} tracker={tracker} /> : <p className="muted">No description.</p>}
          {comments > 0 && <SectionLabel text={`${comments} ${comments === 1 ? "comment" : "comments"}`} />}
          {detail.comments.map((c, k) => (
            <CommentCard key={c.webUrl || k} c={c} author={i.author?.name ?? null} tracker={tracker} now={now} />
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
