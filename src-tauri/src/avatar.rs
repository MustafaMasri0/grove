//! Commit author avatars. In order: the GitHub account the commit belongs to
//! (GitHub API, for repositories whose origin is on github.com, with the
//! user's `gh` token), GitHub's avatar CDN for noreply addresses, Gravatar.
//! Pictures (and "this author has none") are cached on disk, so each author is
//! looked up at most once a week. Only GET requests; nothing touches a repository.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

const KEEP_FOUND: Duration = Duration::from_secs(7 * 24 * 3600);
const KEEP_MISSING: Duration = Duration::from_secs(24 * 3600);
const MAX_BYTES: usize = 1 << 20;

fn normalize(email: &str) -> String {
    email.trim().to_lowercase()
}

fn sha256_hex(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Where to look for an author's picture, best first.
pub fn sources(email: &str, size: u32) -> Vec<String> {
    let e = normalize(email);
    let Some((local, domain)) = e.split_once('@') else { return vec![] };
    if local.is_empty() || domain.is_empty() || e.contains(char::is_whitespace) {
        return vec![];
    }
    if domain == "users.noreply.github.com" {
        let login_ok = |l: &str| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        match local.split_once('+') {
            Some((id, login)) if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) && login_ok(login) => {
                return vec![format!("https://avatars.githubusercontent.com/u/{id}?s={size}&v=4")]
            }
            None if login_ok(local) => return vec![format!("https://github.com/{local}.png?size={size}")],
            _ => {}
        }
    }
    vec![format!("https://secure.gravatar.com/avatar/{}?s={size}&d=404", sha256_hex(&e))]
}

/// The cache file name (without extension) for an author at a size. The
/// version changes when the lookup gets better, so older misses are retried.
pub fn cache_key(email: &str, size: u32) -> String {
    format!("{}-{size}-v2", sha256_hex(&normalize(email)))
}

fn is_name(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `owner/repo` when the origin remote (from `git remote -v`) is on github.com.
pub fn github_repo(remote_v: &str) -> Option<String> {
    let url = remote_v.lines().find_map(|l| {
        let mut parts = l.split_whitespace();
        (parts.next()? == "origin").then(|| parts.next()).flatten()
    })?;
    let path = if let Some(p) = url.strip_prefix("git@github.com:") {
        p
    } else {
        let (host, path) = url.split_once("://")?.1.split_once('/')?;
        let host = host.rsplit('@').next()?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        path
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    match path.split('/').collect::<Vec<_>>()[..] {
        [owner, repo] if is_name(owner) && is_name(repo) => Some(format!("{owner}/{repo}")),
        _ => None,
    }
}

pub fn commit_api_url(repo: &str, sha: &str) -> Option<String> {
    let ok = (7..=40).contains(&sha.len()) && sha.chars().all(|c| c.is_ascii_hexdigit());
    ok.then(|| format!("https://api.github.com/repos/{repo}/commits/{sha}"))
}

/// The newest commit by this email on the default branch (works for unpushed shas too).
pub fn author_query_url(repo: &str, email: &str) -> Option<String> {
    let e = normalize(email);
    if e.is_empty() {
        return None;
    }
    let enc: String = e
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    Some(format!("https://api.github.com/repos/{repo}/commits?author={enc}&per_page=1"))
}

/// The author's avatar URL from a commit (or a list of commits) from the GitHub API.
/// Some(None): no linked account. None: not an answer we understand.
pub fn author_avatar(json: &[u8]) -> Option<Option<String>> {
    let v: serde_json::Value = serde_json::from_slice(json).ok()?;
    let commit = match &v {
        serde_json::Value::Array(list) => match list.first() {
            Some(c) => c,
            None => return Some(None),
        },
        other => other,
    };
    let author = commit.get("author")?;
    Some(
        author
            .get("avatar_url")
            .and_then(|u| u.as_str())
            .filter(|u| u.starts_with("https://avatars.githubusercontent.com/"))
            .map(str::to_string),
    )
}

pub fn sized(url: &str, size: u32) -> String {
    format!("{url}{}s={size}", if url.contains('?') { '&' } else { '?' })
}

/// What is needed to ask GitHub whose commit this is.
pub struct GithubLookup {
    pub repo: String,
    pub sha: Option<String>,
    pub token: String,
}

/// Ok(Some(url)): the author's GitHub picture. Ok(None): GitHub knows no account for
/// them. Err: no answer (offline, rate limit, commit unknown): do not cache a miss.
async fn github_avatar(g: &GithubLookup, email: &str) -> Result<Option<String>, ()> {
    let mut urls: Vec<String> = author_query_url(&g.repo, email).into_iter().collect();
    urls.extend(g.sha.as_deref().and_then(|sha| commit_api_url(&g.repo, sha)));
    let mut answered = false;
    for url in urls {
        let resp = client()
            .get(&url)
            .bearer_auth(&g.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await;
        let Ok(resp) = resp else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(body) = resp.bytes().await else { continue };
        match author_avatar(&body) {
            Some(Some(avatar)) => return Ok(Some(avatar)),
            Some(None) => answered = true,
            None => {}
        }
    }
    if answered { Ok(None) } else { Err(()) }
}

pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Whether a cached picture (`found`) or a cached "no picture" is still good.
pub fn is_fresh(age: Duration, found: bool) -> bool {
    age < if found { KEEP_FOUND } else { KEEP_MISSING }
}

enum Fetched {
    Image(Vec<u8>),
    /// Every source answered 404: the author has no picture.
    Missing,
    /// Offline, rate-limited or a bad answer: try again next time.
    Failed,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("Grove/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client")
    })
}

async fn fetch(urls: &[String]) -> Fetched {
    for url in urls {
        let Ok(resp) = client().get(url).send().await else { return Fetched::Failed };
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        if !resp.status().is_success() {
            return Fetched::Failed;
        }
        return match resp.bytes().await {
            Ok(b) if b.len() <= MAX_BYTES && sniff_mime(&b).is_some() => Fetched::Image(b.to_vec()),
            _ => Fetched::Failed,
        };
    }
    Fetched::Missing
}

fn data_url(bytes: &[u8]) -> Option<String> {
    let mime = sniff_mime(bytes)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn age(p: &Path) -> Option<Duration> {
    std::fs::metadata(p).ok()?.modified().ok()?.elapsed().ok()
}

fn write_atomic(p: &Path, bytes: &[u8]) {
    let tmp = p.with_extension("tmp");
    if std::fs::write(&tmp, bytes).is_ok() {
        let _ = std::fs::rename(&tmp, p);
    }
}

/// The author's picture as a data URL, from the cache in `dir` or downloaded.
/// None when the author has no picture or it cannot be fetched right now.
pub async fn get(dir: &Path, email: &str, size: u32, github: Option<GithubLookup>) -> Option<String> {
    let mut urls = sources(email, size);
    if urls.is_empty() {
        return None;
    }
    let key = cache_key(email, size);
    let img = dir.join(format!("{key}.img"));
    let none = dir.join(format!("{key}.none"));
    let cached = || std::fs::read(&img).ok().and_then(|b| data_url(&b));
    if let Some(a) = age(&img) {
        if is_fresh(a, true) {
            if let Some(url) = cached() {
                return Some(url);
            }
        }
    } else if age(&none).is_some_and(|a| is_fresh(a, false)) {
        return None;
    }
    // Noreply addresses already name their GitHub account; ask GitHub about the rest.
    let mut github_failed = false;
    if let (Some(g), Some(first)) = (&github, urls.first()) {
        if first.starts_with("https://secure.gravatar.com/") {
            match github_avatar(g, email).await {
                Ok(Some(avatar)) => urls.insert(0, sized(&avatar, size)),
                Ok(None) => {}
                Err(()) => github_failed = true,
            }
        }
    }
    match fetch(&urls).await {
        Fetched::Image(bytes) => {
            write_atomic(&img, &bytes);
            let _ = std::fs::remove_file(&none);
            data_url(&bytes)
        }
        // GitHub did not answer: maybe it has a picture, so try again next time.
        Fetched::Missing if github_failed => None,
        Fetched::Missing => {
            write_atomic(&none, b"");
            let _ = std::fs::remove_file(&img);
            None
        }
        // Keep showing an older picture rather than none.
        Fetched::Failed => cached(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(24 * 3600);

    #[test]
    fn finds_the_github_repository_of_origin() {
        let out = "upstream\thttps://github.com/other/thing.git (fetch)\n\
                   origin\thttps://github.com/example-org/example.git (fetch)\n\
                   origin\thttps://github.com/example-org/example.git (push)\n";
        assert_eq!(github_repo(out).as_deref(), Some("example-org/example"));
        for url in [
            "git@github.com:Owner/Repo.git",
            "ssh://git@github.com/Owner/Repo.git",
            "https://user@github.com/Owner/Repo",
            "https://github.com/Owner/Repo/",
        ] {
            assert_eq!(github_repo(&format!("origin\t{url} (fetch)\n")).as_deref(), Some("Owner/Repo"), "{url}");
        }
    }

    #[test]
    fn other_hosts_and_missing_origin_have_no_github_repository() {
        assert_eq!(github_repo("origin\thttps://gitlab.com/a/b.git (fetch)\n"), None);
        assert_eq!(github_repo("origin\thttps://github.com.evil.example/a/b.git (fetch)\n"), None);
        assert_eq!(github_repo("upstream\thttps://github.com/a/b.git (fetch)\n"), None);
        assert_eq!(github_repo("origin\thttps://github.com/a (fetch)\n"), None);
        assert_eq!(github_repo(""), None);
    }

    #[test]
    fn commit_api_url_accepts_only_hex_shas() {
        assert_eq!(
            commit_api_url("example-org/example", "b173ed8fb").as_deref(),
            Some("https://api.github.com/repos/example-org/example/commits/b173ed8fb")
        );
        assert_eq!(commit_api_url("a/b", "HEAD"), None);
        assert_eq!(commit_api_url("a/b", "../x"), None);
        assert_eq!(commit_api_url("a/b", "abc"), None);
    }

    #[test]
    fn author_query_url_encodes_the_email() {
        assert_eq!(
            author_query_url("a/b", " J.Doe+x@Example.com ").as_deref(),
            Some("https://api.github.com/repos/a/b/commits?author=j.doe%2Bx%40example.com&per_page=1")
        );
        assert_eq!(author_query_url("a/b", "  "), None);
    }

    #[test]
    fn reads_the_author_picture_from_a_commit_list() {
        let list = br#"[{"sha":"x","author":{"avatar_url":"https://avatars.githubusercontent.com/u/2?v=4"}}]"#;
        assert_eq!(author_avatar(list), Some(Some("https://avatars.githubusercontent.com/u/2?v=4".to_string())));
        assert_eq!(author_avatar(b"[]"), Some(None));
    }

    #[test]
    fn reads_the_author_picture_from_the_commit() {
        let linked = br#"{"sha":"x","author":{"login":"octo","avatar_url":"https://avatars.githubusercontent.com/u/1?v=4"}}"#;
        assert_eq!(author_avatar(linked), Some(Some("https://avatars.githubusercontent.com/u/1?v=4".to_string())));
        // The commit email is not linked to any GitHub account.
        assert_eq!(author_avatar(br#"{"sha":"x","author":null}"#), Some(None));
        assert_eq!(author_avatar(b"not json"), None);
        // Only GitHub's own avatar host is trusted.
        assert_eq!(author_avatar(br#"{"author":{"avatar_url":"https://evil.example/x.png"}}"#), Some(None));
    }

    #[test]
    fn sizes_github_avatar_urls() {
        assert_eq!(sized("https://avatars.githubusercontent.com/u/1?v=4", 64), "https://avatars.githubusercontent.com/u/1?v=4&s=64");
        assert_eq!(sized("https://avatars.githubusercontent.com/u/1", 64), "https://avatars.githubusercontent.com/u/1?s=64");
    }

    #[test]
    fn cache_keys_are_versioned_so_older_misses_are_looked_up_again() {
        assert!(cache_key("a@b.c", 64).ends_with("-64-v2"));
    }

    #[test]
    fn github_noreply_with_id_uses_the_avatar_cdn() {
        assert_eq!(sources("12345+octo@users.noreply.github.com", 64), vec!["https://avatars.githubusercontent.com/u/12345?s=64&v=4"]);
    }

    #[test]
    fn github_noreply_without_id_uses_the_login() {
        assert_eq!(sources(" Octo-Cat@Users.NoReply.GitHub.com ", 40), vec!["https://github.com/octo-cat.png?size=40"]);
    }

    #[test]
    fn other_emails_use_gravatar_with_a_sha256_of_the_normalised_address() {
        assert_eq!(
            sources(" Test@Example.com ", 64),
            vec!["https://secure.gravatar.com/avatar/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b?s=64&d=404"]
        );
    }

    #[test]
    fn odd_noreply_logins_fall_back_to_gravatar() {
        let s = sources("a/b@users.noreply.github.com", 64);
        assert_eq!(s.len(), 1);
        assert!(s[0].starts_with("https://secure.gravatar.com/avatar/"));
    }

    #[test]
    fn no_address_means_no_lookup() {
        assert!(sources("", 64).is_empty());
        assert!(sources("not an email", 64).is_empty());
    }

    #[test]
    fn cache_key_is_normalised_per_size_and_safe_as_a_file_name() {
        let k = cache_key("Ada@Example.com", 64);
        assert_eq!(k, cache_key(" ada@example.com", 64));
        assert_ne!(k, cache_key("ada@example.com", 32));
        assert!(k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        assert!(!k.contains("ada"));
    }

    #[test]
    fn sniffs_image_types() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff_mime(b"\xff\xd8\xff\xe0...."), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(sniff_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff_mime(b"<html>not an image"), None);
        assert_eq!(sniff_mime(b""), None);
    }

    #[test]
    fn pictures_keep_a_week_and_misses_a_day() {
        assert!(is_fresh(6 * DAY, true));
        assert!(!is_fresh(8 * DAY, true));
        assert!(is_fresh(DAY - Duration::from_secs(60), false));
        assert!(!is_fresh(DAY + Duration::from_secs(60), false));
    }
}
