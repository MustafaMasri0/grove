//! Reading a repository's `origin` remote, independent of where it is hosted.

/// The fetch URL of `origin` in the output of `git remote -v`.
pub fn origin_url(remote_v: &str) -> Option<String> {
    let mut first = None;
    for line in remote_v.lines() {
        let mut parts = line.split_whitespace();
        if parts.next() != Some("origin") {
            continue;
        }
        let Some(url) = parts.next() else { continue };
        if parts.next() == Some("(fetch)") {
            return Some(url.to_string());
        }
        first.get_or_insert_with(|| url.to_string());
    }
    first
}

/// The host and the path of a remote URL, for `scheme://[user@]host[:port]/path` and
/// scp-like `[user@]host:path`. None for local paths and anything else.
pub fn host_and_path(url: &str) -> Option<(&str, &str)> {
    if let Some((_, rest)) = url.split_once("://") {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit('@').next()?;
        let host = host.split(':').next()?;
        return (!host.is_empty()).then_some((host, path));
    }
    // scp-like: no slash before the first colon, and more than a drive letter.
    let (authority, path) = url.split_once(':')?;
    if authority.contains(['/', '\\']) || path.starts_with('\\') {
        return None;
    }
    let host = authority.rsplit('@').next()?;
    (host.len() > 1).then_some((host, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_fetch_url_of_origin() {
        let out = "upstream\thttps://example.com/other/thing.git (fetch)\n\
                   origin\thttps://example.com/push-only.git (push)\n\
                   origin\thttps://example.com/example-org/example.git (fetch)\n";
        assert_eq!(origin_url(out).as_deref(), Some("https://example.com/example-org/example.git"));
        assert_eq!(origin_url("upstream\thttps://example.com/a/b.git (fetch)\n"), None);
        assert_eq!(origin_url(""), None);
    }

    #[test]
    fn splits_remote_urls_into_host_and_path() {
        for (url, host, path) in [
            ("https://github.com/Owner/Repo.git", "github.com", "Owner/Repo.git"),
            ("https://user@example.com:8443/a/b", "example.com", "a/b"),
            ("ssh://git@github.com:22/Owner/Repo.git", "github.com", "Owner/Repo.git"),
            ("git@gitlab.com:group/sub/repo.git", "gitlab.com", "group/sub/repo.git"),
            ("example.com:a/b", "example.com", "a/b"),
        ] {
            assert_eq!(host_and_path(url), Some((host, path)), "{url}");
        }
    }

    #[test]
    fn local_paths_have_no_host() {
        for url in [r"C:\src\example", "C:/src/example", "/home/user/src/example", "../example", "file:///srv/example.git"] {
            assert_eq!(host_and_path(url), None, "{url}");
        }
    }
}
