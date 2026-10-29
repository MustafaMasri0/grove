//! `git for-each-ref` with [`REF_FORMAT`], for the branch switcher and the action button.

use serde::Serialize;

pub const REF_FORMAT: &str =
    "--format=%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(HEAD)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RefKind {
    Local,
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRef {
    /// `main` for local branches, `origin/main` for remote ones.
    pub name: String,
    pub full_ref: String,
    pub kind: RefKind,
    pub oid: String,
    /// Short upstream name, e.g. `origin/main`.
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// The upstream is configured but no longer exists.
    pub upstream_gone: bool,
    pub committer_unix: i64,
    pub is_head: bool,
}

pub fn parse_refs(out: &[u8]) -> Result<Vec<BranchRef>, String> {
    let text = String::from_utf8_lossy(out);
    let mut refs = Vec::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let f: Vec<&str> = line.split('\0').collect();
        let [full_ref, oid, upstream, track, date, head] = f[..] else {
            return Err(format!("unexpected for-each-ref line: {line:?}"));
        };
        let (kind, name) = if let Some(n) = full_ref.strip_prefix("refs/heads/") {
            (RefKind::Local, n)
        } else if let Some(n) = full_ref.strip_prefix("refs/remotes/") {
            if n.ends_with("/HEAD") {
                continue;
            }
            (RefKind::Remote, n)
        } else {
            continue;
        };
        let (ahead, behind, upstream_gone) = parse_track(track);
        refs.push(BranchRef {
            name: name.to_string(),
            full_ref: full_ref.to_string(),
            kind,
            oid: oid.to_string(),
            upstream: (!upstream.is_empty())
                .then(|| upstream.strip_prefix("refs/remotes/").unwrap_or(upstream).to_string()),
            ahead,
            behind,
            upstream_gone,
            committer_unix: date.parse().unwrap_or(0),
            is_head: head == "*",
        });
    }
    Ok(refs)
}

/// Parses `ahead 3, behind 2` / `ahead 1` / `behind 4` / `gone` / ``.
pub fn parse_track(track: &str) -> (u32, u32, bool) {
    let (mut ahead, mut behind) = (0, 0);
    for part in track.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind, track.trim() == "gone")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_strings() {
        assert_eq!(parse_track(""), (0, 0, false));
        assert_eq!(parse_track("ahead 3"), (3, 0, false));
        assert_eq!(parse_track("behind 61"), (0, 61, false));
        assert_eq!(parse_track("ahead 3, behind 2"), (3, 2, false));
        assert_eq!(parse_track("gone"), (0, 0, true));
    }

    #[test]
    fn synthetic_refs() {
        let r = parse_refs(include_bytes!("../../tests/fixtures/for-each-ref.txt")).unwrap();
        let main = r.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main.kind, RefKind::Local);
        assert_eq!(main.upstream.as_deref(), Some("origin/main"));
        assert_eq!((main.ahead, main.behind), (1, 0));
        assert!(main.is_head);
        assert_eq!(main.committer_unix, 1767319445);
        let remote = r.iter().find(|b| b.name == "origin/main").unwrap();
        assert_eq!(remote.kind, RefKind::Remote);
        assert!(!remote.is_head);
        assert_eq!(r.iter().find(|b| b.name == "feature").unwrap().upstream, None);
    }

    #[test]
    fn large_refs_skip_symbolic_remote_head() {
        let r = parse_refs(include_bytes!("../../tests/fixtures/large-for-each-ref.txt")).unwrap();
        assert!(r.iter().all(|b| !b.name.ends_with("/HEAD")), "origin/HEAD must be skipped");
        let main = r.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(main.behind, 61);
        assert!(r.iter().any(|b| b.name == "prototype/quick-open" && b.kind == RefKind::Local));
    }
}
