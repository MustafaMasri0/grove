//! Everything that knows about GitHub: the shared API client and the issue tracker.

pub mod client;
pub mod issues;

pub use client::{Client, Purpose};

/// A repository on github.com.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GithubRepo {
    pub owner: String,
    pub name: String,
}

fn is_name(s: &str) -> bool {
    !matches!(s, "" | "." | "..") && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

impl GithubRepo {
    /// The repository a remote URL points at, when it is on github.com.
    pub fn from_url(url: &str) -> Option<Self> {
        let (host, path) = crate::remote::host_and_path(url)?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        let path = path.trim_start_matches('/').trim_end_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        match path.split('/').collect::<Vec<_>>()[..] {
            [owner, name] if is_name(owner) && is_name(name) => Some(Self { owner: owner.into(), name: name.into() }),
            _ => None,
        }
    }

    /// `owner/name`.
    pub fn full_name(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }

    /// An API URL under this repository; `path` starts with `/`.
    pub fn api_url(&self, path: &str) -> String {
        format!("{}/repos/{}/{}{path}", client::API, self.owner, self.name)
    }

    pub fn web_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full(url: &str) -> Option<String> {
        GithubRepo::from_url(url).map(|r| r.full_name())
    }

    #[test]
    fn finds_the_repository_in_github_urls() {
        for url in [
            "git@github.com:Owner/Repo.git",
            "ssh://git@github.com/Owner/Repo.git",
            "ssh://git@github.com:22/Owner/Repo.git",
            "https://user@github.com/Owner/Repo",
            "https://GitHub.com/Owner/Repo/",
        ] {
            assert_eq!(full(url).as_deref(), Some("Owner/Repo"), "{url}");
        }
    }

    #[test]
    fn other_hosts_and_odd_paths_are_not_github_repositories() {
        assert_eq!(full("https://gitlab.com/a/b.git"), None);
        assert_eq!(full("https://github.com.evil.example/a/b.git"), None);
        assert_eq!(full("https://github.com/a"), None);
        assert_eq!(full("https://github.com/a/b/c"), None);
        assert_eq!(full("https://github.com/a/../b"), None);
        assert_eq!(full("https://github.com/a/.."), None);
        assert_eq!(full("/home/user/src/example"), None);
    }

    #[test]
    fn builds_api_and_web_urls() {
        let r = GithubRepo { owner: "example-org".into(), name: "example".into() };
        assert_eq!(r.api_url("/issues/3"), "https://api.github.com/repos/example-org/example/issues/3");
        assert_eq!(r.web_url(), "https://github.com/example-org/example");
    }
}
