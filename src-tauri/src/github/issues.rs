//! GitHub's issues as an `IssueTracker`. The list always comes from one URL, newest
//! update first, with its first page checked by ETag; pull requests are left out.

use super::client::{ApiError, Client, Purpose, Reply};
use super::GithubRepo;
use crate::issues::{Comment, Issue, IssueDetail, IssueError, IssueState, IssueSummary, IssueTracker, Label, ListOutcome, ListRequest, Person, TrackerInfo};
use async_trait::async_trait;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const PER_PAGE: u32 = 100;
/// The first load stops after this many pages (300 issues and pull requests at most).
const FIRST_PAGES: u32 = 3;
/// Comments followed per issue, as a bound on runaway threads.
const MAX_COMMENT_PAGES: usize = 30;

#[derive(Deserialize)]
struct GhUser {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct GhLabel {
    name: String,
    color: Option<String>,
}

#[derive(Deserialize)]
struct GhMilestone {
    title: String,
}

#[derive(Deserialize)]
struct GhIssue {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    labels: Vec<GhLabel>,
    user: Option<GhUser>,
    #[serde(default)]
    comments: u32,
    updated_at: String,
    created_at: String,
    closed_at: Option<String>,
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assignees: Vec<GhUser>,
    milestone: Option<GhMilestone>,
    /// Present on pull requests, which the issues API lists too.
    pull_request: Option<serde::de::IgnoredAny>,
}

#[derive(Deserialize)]
struct GhComment {
    user: Option<GhUser>,
    body: Option<String>,
    created_at: String,
    updated_at: String,
    html_url: String,
}

fn person(u: &GhUser) -> Person {
    Person {
        name: u.login.clone(),
        // Only GitHub's own avatar host, as for commit avatars.
        avatar_url: u.avatar_url.clone().filter(|url| url.starts_with("https://avatars.githubusercontent.com/")),
    }
}

fn label(l: &GhLabel) -> Label {
    let color = l.color.as_deref().filter(|c| c.len() == 6 && c.chars().all(|ch| ch.is_ascii_hexdigit()));
    Label { name: l.name.clone(), color: color.map(|c| format!("#{}", c.to_ascii_lowercase())) }
}

fn summary(i: &GhIssue) -> IssueSummary {
    IssueSummary {
        number: i.number,
        title: i.title.clone(),
        state: if i.state == "closed" { IssueState::Closed } else { IssueState::Open },
        labels: i.labels.iter().map(label).collect(),
        author: i.user.as_ref().map(person),
        assignees: i.assignees.iter().map(person).collect(),
        comment_count: i.comments,
        updated_at: i.updated_at.clone(),
    }
}

fn issue(i: &GhIssue) -> Issue {
    Issue {
        summary: summary(i),
        body: i.body.clone().unwrap_or_default(),
        milestone: i.milestone.as_ref().map(|m| m.title.clone()),
        created_at: i.created_at.clone(),
        closed_at: i.closed_at.clone(),
        web_url: i.html_url.clone(),
    }
}

fn comment(c: &GhComment) -> Comment {
    Comment {
        author: c.user.as_ref().map(person),
        body: c.body.clone().unwrap_or_default(),
        created_at: c.created_at.clone(),
        updated_at: c.updated_at.clone(),
        web_url: c.html_url.clone(),
    }
}

/// A page of the list: its issues, and whether anything was on it at all (a page of
/// only pull requests has no issues but is not the end).
struct Page {
    issues: Vec<IssueSummary>,
    raw: usize,
    more: bool,
}

fn page(reply: &Reply) -> Result<Page, ApiError> {
    let items: Vec<GhIssue> = reply.json()?;
    Ok(Page {
        issues: items.iter().filter(|i| i.pull_request.is_none()).map(summary).collect(),
        raw: items.len(),
        more: reply.next_link().is_some(),
    })
}

/// What one account has loaded of the list.
#[derive(Default)]
struct Loaded {
    /// Most recently updated first, one per number.
    issues: Vec<IssueSummary>,
    /// Of the first page, for the next check.
    etag: Option<String>,
    pages: u32,
    more: bool,
}

impl Loaded {
    fn knows(&self, i: &IssueSummary) -> bool {
        self.issues.iter().any(|k| k.number == i.number && k.updated_at == i.updated_at)
    }

    fn merge(&mut self, fresh: Vec<IssueSummary>) {
        for i in fresh {
            match self.issues.iter_mut().find(|k| k.number == i.number) {
                Some(k) => *k = i,
                None => self.issues.push(i),
            }
        }
        // RFC 3339 times in UTC sort as text.
        self.issues.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(b.number.cmp(&a.number)));
    }

    fn outcome(&self) -> ListOutcome {
        ListOutcome::Issues { issues: self.issues.clone(), more: self.more }
    }
}

pub struct GithubIssues {
    client: Arc<Client>,
    repo: GithubRepo,
    /// Per account (None: the default login). In memory only.
    lists: Mutex<HashMap<Option<String>, Arc<tauri::async_runtime::Mutex<Loaded>>>>,
}

impl GithubIssues {
    pub fn new(client: Arc<Client>, repo: GithubRepo) -> Self {
        Self { client, repo, lists: Mutex::default() }
    }

    fn list_url(&self, page: u32) -> String {
        self.repo.api_url(&format!("/issues?state=all&sort=updated&direction=desc&per_page={PER_PAGE}&page={page}"))
    }

    fn error(&self, e: ApiError, account: Option<&str>) -> IssueError {
        match e {
            ApiError::NotFound { signed_in } => IssueError::NotFound { account: account.map(str::to_string), signed_in },
            ApiError::Gone { message } if message.to_lowercase().contains("disabled") => IssueError::IssuesDisabled,
            // A deleted or transferred issue.
            ApiError::Gone { .. } => IssueError::NotFound { account: account.map(str::to_string), signed_in: true },
            ApiError::SingleSignOn { url } => IssueError::SingleSignOn { url },
            ApiError::Unauthorized => IssueError::Unauthorized,
            ApiError::RateLimited { resets_at } => IssueError::RateLimited { resets_at },
            ApiError::Paused { resets_at } => IssueError::Paused { resets_at },
            ApiError::Network(message) => IssueError::Network { message },
            ApiError::Status(status) => IssueError::Unexpected { status },
        }
    }

    async fn fetch_page(&self, account: Option<&str>, purpose: Purpose, n: u32, etag: Option<&str>) -> Result<(Reply, Option<Page>), ApiError> {
        let reply = self.client.get(account, purpose, &self.list_url(n), etag).await?;
        let page = if reply.not_modified() { None } else { Some(page(&reply)?) };
        Ok((reply, page))
    }

    async fn first_load(&self, l: &mut Loaded, account: Option<&str>, purpose: Purpose) -> Result<ListOutcome, ApiError> {
        let mut fresh = Loaded::default();
        loop {
            let n = fresh.pages + 1;
            let (reply, page) = self.fetch_page(account, purpose, n, None).await?;
            let page = page.ok_or(ApiError::Status(304))?;
            if n == 1 {
                fresh.etag = reply.header("etag").map(str::to_string);
            }
            fresh.merge(page.issues);
            fresh.pages = n;
            fresh.more = page.more;
            if !fresh.more || fresh.pages >= FIRST_PAGES {
                break;
            }
        }
        *l = fresh;
        Ok(l.outcome())
    }

    /// Checks the first page; when it changed, takes in pages until one holds an issue
    /// already known as it is (everything after it is older), within what was loaded.
    async fn refresh(&self, l: &mut Loaded, account: Option<&str>, purpose: Purpose) -> Result<ListOutcome, ApiError> {
        let (reply, page) = self.fetch_page(account, purpose, 1, l.etag.as_deref()).await?;
        let Some(mut page) = page else { return Ok(ListOutcome::Unchanged) };
        l.etag = reply.header("etag").map(str::to_string);
        let mut n = 1;
        loop {
            let reached_known = page.issues.iter().any(|i| l.knows(i)) || page.raw == 0;
            if n == 1 && l.pages == 1 {
                l.more = page.more;
            }
            l.merge(page.issues);
            if reached_known || !page.more || n >= l.pages {
                break;
            }
            n += 1;
            page = self.fetch_page(account, purpose, n, None).await?.1.ok_or(ApiError::Status(304))?;
        }
        Ok(l.outcome())
    }

    async fn load_more(&self, l: &mut Loaded, account: Option<&str>) -> Result<ListOutcome, ApiError> {
        if l.more {
            let n = l.pages + 1;
            let page = self.fetch_page(account, Purpose::User, n, None).await?.1.ok_or(ApiError::Status(304))?;
            l.merge(page.issues);
            l.pages = n;
            l.more = page.more;
        }
        Ok(l.outcome())
    }
}

#[async_trait]
impl IssueTracker for GithubIssues {
    fn info(&self) -> TrackerInfo {
        TrackerInfo { name: "GitHub", project: self.repo.full_name(), web_url: format!("{}/issues", self.repo.web_url()) }
    }

    async fn list(&self, account: Option<&str>, request: ListRequest) -> Result<ListOutcome, IssueError> {
        let cell = self.lists.lock().unwrap().entry(account.map(str::to_string)).or_default().clone();
        // One request at a time per account, so checks and Load more do not race.
        let mut l = cell.lock().await;
        let purpose = if request == ListRequest::TimedCheck { Purpose::Background } else { Purpose::User };
        let result = match request {
            _ if l.pages == 0 => self.first_load(&mut l, account, purpose).await,
            ListRequest::LoadMore => self.load_more(&mut l, account).await,
            ListRequest::Refresh | ListRequest::TimedCheck => self.refresh(&mut l, account, purpose).await,
        };
        result.map_err(|e| self.error(e, account))
    }

    async fn issue(&self, account: Option<&str>, number: u64) -> Result<IssueDetail, IssueError> {
        let fail = |e| self.error(e, account);
        let reply = self.client.get(account, Purpose::User, &self.repo.api_url(&format!("/issues/{number}")), None).await.map_err(fail)?;
        let gh: GhIssue = reply.json().map_err(fail)?;
        if gh.pull_request.is_some() {
            return Err(IssueError::NotFound { account: account.map(str::to_string), signed_in: true });
        }
        let mut comments = Vec::new();
        let mut url = Some(self.repo.api_url(&format!("/issues/{number}/comments?per_page={PER_PAGE}")));
        for _ in 0..MAX_COMMENT_PAGES {
            let Some(u) = url.take() else { break };
            let reply = self.client.get(account, Purpose::User, &u, None).await.map_err(fail)?;
            let page: Vec<GhComment> = reply.json().map_err(fail)?;
            comments.extend(page.iter().map(comment));
            url = reply.next_link();
        }
        Ok(IssueDetail { issue: issue(&gh), comments })
    }
}

#[cfg(test)]
mod tests {
    use super::super::client::testing::*;
    use super::*;

    const LIST: &str = include_str!("testdata/issues-page.json");
    const ISSUE: &str = include_str!("testdata/issue.json");
    const COMMENTS_1: &str = include_str!("testdata/comments-1.json");
    const COMMENTS_2: &str = include_str!("testdata/comments-2.json");

    fn repo() -> GithubRepo {
        GithubRepo { owner: "example-org".into(), name: "example".into() }
    }

    fn tracker(rig: &Rig) -> GithubIssues {
        GithubIssues::new(rig.client.clone(), repo())
    }

    fn next(page: u32) -> String {
        format!(r#"<https://api.github.com/repositories/1/issues?page={page}>; rel="next""#)
    }

    /// A list page of made-up issues: (number, updated day of November).
    fn issues(items: &[(u64, u32)]) -> String {
        let items: Vec<_> = items
            .iter()
            .map(|(n, day)| {
                serde_json::json!({
                    "number": n, "title": format!("Issue {n}"), "state": "open", "labels": [], "user": null,
                    "comments": 0, "updated_at": format!("2026-11-{day:02}T10:00:00Z"), "created_at": "2026-10-01T10:00:00Z",
                    "closed_at": null, "body": null, "html_url": format!("https://github.com/example-org/example/issues/{n}")
                })
            })
            .collect();
        serde_json::to_string(&items).unwrap()
    }

    fn numbers(o: &ListOutcome) -> (Vec<u64>, bool) {
        match o {
            ListOutcome::Issues { issues, more } => (issues.iter().map(|i| i.number).collect(), *more),
            ListOutcome::Unchanged => panic!("unchanged"),
        }
    }

    #[test]
    fn maps_a_page_and_leaves_out_pull_requests() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("etag", "W/\"one\"")], LIST));
        let out = run(tracker(&rig).list(None, ListRequest::Refresh)).unwrap();
        let ListOutcome::Issues { issues, more } = out else { panic!() };
        assert!(!more);
        assert_eq!(issues.iter().map(|i| i.number).collect::<Vec<_>>(), [12, 9]);
        let first = &issues[0];
        assert_eq!(first.title, "Crash when opening an empty folder");
        assert_eq!(first.state, IssueState::Open);
        assert_eq!(first.comment_count, 2);
        assert_eq!(first.labels, [Label { name: "bug".into(), color: Some("#d73a4a".into()) }, Label { name: "odd colour".into(), color: None }]);
        assert_eq!(first.author, Some(Person { name: "octo-cat".into(), avatar_url: Some("https://avatars.githubusercontent.com/u/1?v=4".into()) }));
        assert_eq!(issues[1].state, IssueState::Closed);
        // Avatars elsewhere than GitHub's own host are dropped.
        assert_eq!(issues[1].author.as_ref().unwrap().avatar_url, None);

        let url = &rig.sent()[0].url;
        assert_eq!(url, "https://api.github.com/repos/example-org/example/issues?state=all&sort=updated&direction=desc&per_page=100&page=1");
    }

    #[test]
    fn the_first_load_stops_after_three_pages_and_load_more_goes_on() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("link", &next(2))], &issues(&[(10, 30), (9, 29)])))
            .answer(reply(200, &[("link", &next(3))], &issues(&[(8, 28)])))
            .answer(reply(200, &[("link", &next(4))], &issues(&[(7, 27)])))
            .answer(reply(200, &[], &issues(&[(6, 26)])));
        let t = tracker(&rig);
        assert_eq!(numbers(&run(t.list(None, ListRequest::Refresh)).unwrap()), (vec![10, 9, 8, 7], true));
        assert_eq!(rig.sent().len(), 3);
        assert_eq!(numbers(&run(t.list(None, ListRequest::LoadMore)).unwrap()), (vec![10, 9, 8, 7, 6], false));
        assert!(rig.sent()[3].url.ends_with("&page=4"));
        // Nothing more to load: nothing is sent.
        run(t.list(None, ListRequest::LoadMore)).unwrap();
        assert_eq!(rig.sent().len(), 4);
    }

    #[test]
    fn checks_send_the_etag_and_a_304_is_unchanged() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("etag", "W/\"one\"")], &issues(&[(2, 2), (1, 1)]))).answer(reply(304, &[], ""));
        let t = tracker(&rig);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        assert_eq!(run(t.list(None, ListRequest::TimedCheck)).unwrap(), ListOutcome::Unchanged);
        assert_eq!(rig.sent()[1].header("if-none-match"), Some("W/\"one\""));
    }

    #[test]
    fn a_changed_first_page_is_merged_by_number() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("etag", "W/\"one\"")], &issues(&[(2, 2), (1, 1)])))
            .answer(reply(200, &[("etag", "W/\"two\"")], &issues(&[(1, 5), (3, 4), (2, 2)])))
            .answer(reply(304, &[], ""));
        let t = tracker(&rig);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        assert_eq!(numbers(&run(t.list(None, ListRequest::Refresh)).unwrap()).0, [1, 3, 2]);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        assert_eq!(rig.sent()[2].header("if-none-match"), Some("W/\"two\""));
        assert_eq!(rig.sent().len(), 3);
    }

    #[test]
    fn a_check_follows_pages_until_it_meets_a_known_issue() {
        let rig = Rig::new(&[Some("t")]);
        // Loaded: two pages.
        rig.answer(reply(200, &[("link", &next(2))], &issues(&[(4, 4), (3, 3)])))
            .answer(reply(200, &[], &issues(&[(2, 2), (1, 1)])));
        let t = tracker(&rig);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        // Two new updates fill page 1; page 2 starts with a known issue, so it stops there.
        rig.answer(reply(200, &[("link", &next(2))], &issues(&[(1, 9), (2, 8)])))
            .answer(reply(200, &[("link", &next(3))], &issues(&[(4, 4), (3, 3)])));
        assert_eq!(numbers(&run(t.list(None, ListRequest::Refresh)).unwrap()).0, [1, 2, 4, 3]);
        assert_eq!(rig.sent().len(), 4);
    }

    #[test]
    fn timed_checks_are_held_back_but_the_user_can_still_refresh() {
        let rig = Rig::new(&[Some("t")]);
        let low = [("x-ratelimit-remaining", "120"), ("x-ratelimit-reset", "9000")];
        rig.answer(reply(200, &low, &issues(&[(1, 1)])));
        let t = tracker(&rig);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        assert_eq!(run(t.list(None, ListRequest::TimedCheck)).unwrap_err(), IssueError::Paused { resets_at: Some(9000) });
        rig.answer(reply(304, &low, ""));
        assert_eq!(run(t.list(None, ListRequest::Refresh)).unwrap(), ListOutcome::Unchanged);
        assert_eq!(rig.sent().len(), 2);
    }

    #[test]
    fn without_a_login_there_are_no_timed_checks() {
        let rig = Rig::new(&[None]);
        rig.answer(reply(200, &[], &issues(&[(1, 1)])));
        let t = tracker(&rig);
        run(t.list(None, ListRequest::Refresh)).unwrap();
        assert_eq!(run(t.list(None, ListRequest::TimedCheck)).unwrap_err(), IssueError::Paused { resets_at: None });
    }

    #[test]
    fn lists_are_kept_per_account() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[], &issues(&[(1, 1)]))).answer(reply(200, &[], &issues(&[(2, 2)])));
        let t = tracker(&rig);
        assert_eq!(numbers(&run(t.list(None, ListRequest::Refresh)).unwrap()).0, [1]);
        assert_eq!(numbers(&run(t.list(Some("work-login"), ListRequest::Refresh)).unwrap()).0, [2]);
        assert_eq!(*rig.tokens.reads.lock().unwrap(), [None, Some("work-login".to_string())]);
    }

    #[test]
    fn tells_errors_apart() {
        let cases: [(Reply, IssueError); 5] = [
            (reply(404, &[], r#"{"message":"Not Found"}"#), IssueError::NotFound { account: Some("octo".into()), signed_in: true }),
            (reply(410, &[], r#"{"message":"Issues are disabled for this repo"}"#), IssueError::IssuesDisabled),
            (
                reply(403, &[("x-github-sso", "required; url=https://github.com/orgs/example-org/sso?x=1")], "{}"),
                IssueError::SingleSignOn { url: Some("https://github.com/orgs/example-org/sso?x=1".into()) },
            ),
            (reply(403, &[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "7000")], "{}"), IssueError::RateLimited { resets_at: 7000 }),
            (reply(500, &[], ""), IssueError::Unexpected { status: 500 }),
        ];
        for (r, expected) in cases {
            let rig = Rig::new(&[Some("t")]);
            rig.answer(r);
            assert_eq!(run(tracker(&rig).list(Some("octo"), ListRequest::Refresh)).unwrap_err(), expected);
        }
        let rig = Rig::new(&[None]);
        rig.answer(reply(404, &[], "{}"));
        assert_eq!(run(tracker(&rig).list(None, ListRequest::Refresh)).unwrap_err(), IssueError::NotFound { account: None, signed_in: false });
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[], "not json"));
        assert!(matches!(run(tracker(&rig).list(None, ListRequest::Refresh)).unwrap_err(), IssueError::Network { .. }));
    }

    #[test]
    fn a_failed_first_load_keeps_nothing_and_is_tried_again() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("link", &next(2))], &issues(&[(2, 2)]))).answer(reply(502, &[], ""));
        let t = tracker(&rig);
        assert!(run(t.list(None, ListRequest::Refresh)).is_err());
        rig.answer(reply(200, &[], &issues(&[(2, 2)])));
        assert_eq!(numbers(&run(t.list(None, ListRequest::TimedCheck)).unwrap()), (vec![2], false));
        assert!(rig.sent()[2].header("if-none-match").is_none());
    }

    #[test]
    fn reads_one_issue_with_all_its_comments() {
        let rig = Rig::new(&[Some("t")]);
        let link = r#"<https://api.github.com/repositories/1/issues/12/comments?per_page=100&page=2>; rel="next""#;
        rig.answer(reply(200, &[], ISSUE)).answer(reply(200, &[("link", link)], COMMENTS_1)).answer(reply(200, &[], COMMENTS_2));
        let d = run(tracker(&rig).issue(None, 12)).unwrap();
        assert_eq!(d.issue.summary.number, 12);
        assert_eq!(d.issue.body, "Steps:\n\n1. Open an empty folder\n2. See it crash");
        assert_eq!(d.issue.milestone.as_deref(), Some("1.0"));
        assert_eq!(d.issue.summary.assignees.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["octo-cat", "example-user"]);
        assert_eq!(d.issue.web_url, "https://github.com/example-org/example/issues/12");
        assert_eq!(d.issue.closed_at, None);
        assert_eq!(d.comments.iter().map(|c| c.body.as_str()).collect::<Vec<_>>(), ["I see this too.", "", "Fixed on main."]);
        assert_eq!(d.comments[1].author, None);
        let urls: Vec<_> = rig.sent().into_iter().map(|s| s.url).collect();
        assert_eq!(
            urls,
            [
                "https://api.github.com/repos/example-org/example/issues/12",
                "https://api.github.com/repos/example-org/example/issues/12/comments?per_page=100",
                "https://api.github.com/repositories/1/issues/12/comments?per_page=100&page=2",
            ]
        );
    }

    #[test]
    fn a_pull_request_number_is_not_an_issue() {
        let rig = Rig::new(&[Some("t")]);
        let pr = ISSUE.replacen("\"number\": 12,", "\"number\": 12, \"pull_request\": {\"url\": \"x\"},", 1);
        assert_ne!(pr, ISSUE);
        rig.answer(reply(200, &[], &pr));
        assert!(matches!(run(tracker(&rig).issue(None, 12)).unwrap_err(), IssueError::NotFound { .. }));
        assert_eq!(rig.sent().len(), 1);
    }

    #[test]
    fn a_deleted_issue_is_not_found() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(410, &[], r#"{"message":"This issue was deleted"}"#));
        assert!(matches!(run(tracker(&rig).issue(None, 5)).unwrap_err(), IssueError::NotFound { .. }));
    }
}
