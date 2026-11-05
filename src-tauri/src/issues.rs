//! Issues of a repository, read-only. Everything here is tracker-neutral: the app talks
//! to an `IssueTracker`, and `tracker_for` is the one place that picks the tracker for
//! a repository from its origin.

use crate::github;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[async_trait]
pub trait IssueTracker: Send + Sync {
    fn info(&self) -> TrackerInfo;

    /// The loaded issues, most recently updated first. `account` picks whose login is
    /// used, None for the default one.
    async fn list(&self, account: Option<&str>, request: ListRequest) -> Result<ListOutcome, IssueError>;

    /// One issue with all its comments.
    async fn issue(&self, account: Option<&str>, number: u64) -> Result<IssueDetail, IssueError>;
}

/// Picks the tracker for a repository from its origin URL. Sends nothing.
pub fn tracker_for(origin: Option<&str>, github: &Arc<github::Client>) -> Result<Arc<dyn IssueTracker>, IssueError> {
    let origin = origin.ok_or(IssueError::NoOrigin)?;
    if let Some(repo) = github::GithubRepo::from_url(origin) {
        return Ok(Arc::new(github::issues::GithubIssues::new(github.clone(), repo)));
    }
    let host = crate::remote::host_and_path(origin).map_or("", |(host, _)| host);
    Err(IssueError::UnsupportedHost { host: host.to_string() })
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerInfo {
    /// For labels such as "Open on GitHub".
    pub name: &'static str,
    /// The repository or project the issues belong to, as the tracker names it.
    pub project: String,
    /// The repository's issues page.
    pub web_url: String,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ListRequest {
    /// Asked for by the user: loads the first issues, or checks for changes.
    Refresh,
    /// The auto-refresh timer: like `Refresh`, but held back when few requests are left.
    TimedCheck,
    /// The next older issues.
    LoadMore,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ListOutcome {
    /// Nothing changed since the last answer.
    Unchanged,
    /// Every loaded issue; `more` when older ones can be loaded.
    Issues { issues: Vec<IssueSummary>, more: bool },
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IssueState {
    Open,
    Closed,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub name: String,
    /// `#rrggbb`, when the tracker gives one.
    pub color: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: u64,
    pub title: String,
    pub state: IssueState,
    pub labels: Vec<Label>,
    pub author: Option<Person>,
    /// For the list's assignee filter as much as for the issue view.
    pub assignees: Vec<Person>,
    pub comment_count: u32,
    /// RFC 3339, UTC.
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    #[serde(flatten)]
    pub summary: IssueSummary,
    /// Markdown, untrusted.
    pub body: String,
    pub milestone: Option<String>,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub web_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub author: Option<Person>,
    /// Markdown, untrusted.
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
    pub web_url: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub issue: Issue,
    /// Oldest first.
    pub comments: Vec<Comment>,
}

/// Why issues cannot be shown. Times are unix seconds.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum IssueError {
    /// The repository has no `origin` remote.
    NoOrigin,
    /// `origin` is on a host no tracker is known for (empty for local paths).
    UnsupportedHost { host: String },
    /// The origin could not be read from the repository.
    Git { message: String },
    /// No such repository or issue for this login; for a private repository, maybe the
    /// wrong account, or none (`signed_in` false).
    NotFound { account: Option<String>, signed_in: bool },
    /// The organisation requires single sign-on for this login; `url` authorises it.
    SingleSignOn { url: Option<String> },
    IssuesDisabled,
    /// The login was refused, even after reading it again.
    Unauthorized,
    /// Nothing is sent until `resets_at`.
    RateLimited { resets_at: u64 },
    /// A timed check was held back: few requests are left until `resets_at`, or, when
    /// None, there is no login and timed checks need one.
    Paused { resets_at: Option<u64> },
    /// Offline, timed out or a broken answer.
    Network { message: String },
    Unexpected { status: u16 },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pick(origin: Option<&str>) -> Result<TrackerInfo, IssueError> {
        tracker_for(origin, &Arc::new(github::Client::default())).map(|t| t.info())
    }

    #[test]
    fn github_origins_get_the_github_tracker() {
        let info = pick(Some("git@github.com:example-org/example.git")).unwrap();
        assert_eq!(info, TrackerInfo { name: "GitHub", project: "example-org/example".into(), web_url: "https://github.com/example-org/example/issues".into() });
    }

    #[test]
    fn other_origins_are_told_apart() {
        assert_eq!(pick(None).unwrap_err(), IssueError::NoOrigin);
        assert_eq!(pick(Some("https://gitlab.com/a/b.git")).unwrap_err(), IssueError::UnsupportedHost { host: "gitlab.com".into() });
        assert_eq!(pick(Some("/home/user/src/example")).unwrap_err(), IssueError::UnsupportedHost { host: String::new() });
    }

    #[test]
    fn errors_reach_the_ui_tagged_by_kind() {
        let json = serde_json::to_value(IssueError::NotFound { account: Some("octo".into()), signed_in: true }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "notFound", "account": "octo", "signedIn": true }));
        let json = serde_json::to_value(IssueError::RateLimited { resets_at: 7 }).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "rateLimited", "resetsAt": 7 }));
    }

    #[test]
    fn list_requests_come_from_the_ui_in_camel_case() {
        assert_eq!(serde_json::from_str::<ListRequest>("\"timedCheck\"").unwrap(), ListRequest::TimedCheck);
        assert_eq!(serde_json::from_str::<ListRequest>("\"loadMore\"").unwrap(), ListRequest::LoadMore);
    }
}
