//! `git status --porcelain=v2 -z --branch`

use super::{fields, lossy, ChangeKind};
use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchHeader {
    pub oid: Option<String>,
    /// None when HEAD is detached.
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
    /// Index (staged) status letter, '.' for unchanged.
    pub staged: char,
    /// Working tree (unstaged) status letter, '.' for unchanged.
    pub unstaged: char,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: BranchHeader,
    pub entries: Vec<StatusEntry>,
}

pub fn parse_status_v2(out: &[u8]) -> Result<Status, String> {
    let mut status = Status::default();
    let mut records = out.split(|&b| b == 0).filter(|r| !r.is_empty());
    while let Some(rec) = records.next() {
        let bad = || format!("unexpected status record: {}", lossy(rec));
        match rec[0] {
            b'#' => parse_header(&mut status.branch, rec),
            b'1' => {
                let f = fields(rec, 9);
                let [_, xy, .., path] = f[..] else { return Err(bad()) };
                if f.len() != 9 || xy.len() != 2 {
                    return Err(bad());
                }
                status.entries.push(entry(xy, lossy(path), None));
            }
            b'2' => {
                let f = fields(rec, 10);
                let [_, xy, .., path] = f[..] else { return Err(bad()) };
                if f.len() != 10 || xy.len() != 2 {
                    return Err(bad());
                }
                let orig = records.next().ok_or_else(bad)?;
                status.entries.push(entry(xy, lossy(path), Some(lossy(orig))));
            }
            b'u' => {
                let f = fields(rec, 11);
                let [_, xy, .., path] = f[..] else { return Err(bad()) };
                if f.len() != 11 || xy.len() != 2 {
                    return Err(bad());
                }
                let mut e = entry(xy, lossy(path), None);
                e.kind = ChangeKind::Conflicted;
                status.entries.push(e);
            }
            b'?' | b'!' if rec.len() > 2 => status.entries.push(StatusEntry {
                path: lossy(&rec[2..]),
                orig_path: None,
                kind: if rec[0] == b'?' { ChangeKind::Untracked } else { ChangeKind::Ignored },
                staged: '.',
                unstaged: '.',
            }),
            _ => return Err(bad()),
        }
    }
    Ok(status)
}

fn parse_header(b: &mut BranchHeader, rec: &[u8]) {
    let line = lossy(rec);
    let mut parts = line.splitn(3, ' ').skip(1);
    let (Some(key), Some(value)) = (parts.next(), parts.next()) else { return };
    match key {
        "branch.oid" if value != "(initial)" => b.oid = Some(value.into()),
        "branch.head" if value != "(detached)" => b.head = Some(value.into()),
        "branch.upstream" => b.upstream = Some(value.into()),
        "branch.ab" => {
            for n in value.split(' ') {
                if let Some(a) = n.strip_prefix('+') {
                    b.ahead = a.parse().unwrap_or(0);
                } else if let Some(c) = n.strip_prefix('-') {
                    b.behind = c.parse().unwrap_or(0);
                }
            }
        }
        _ => {}
    }
}

fn entry(xy: &[u8], path: String, orig_path: Option<String>) -> StatusEntry {
    let (x, y) = (xy[0] as char, xy[1] as char);
    let kind = match (x, y) {
        ('A', _) => ChangeKind::Added,
        ('R', _) => ChangeKind::Renamed,
        ('C', _) => ChangeKind::Copied,
        ('D', _) | (_, 'D') => ChangeKind::Deleted,
        _ => ChangeKind::Modified,
    };
    StatusEntry { path, orig_path, kind, staged: x, unstaged: y }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Status {
        parse_status_v2(include_bytes!("../../tests/fixtures/status-v2.bin")).unwrap()
    }

    fn entry<'a>(s: &'a Status, path: &str) -> &'a StatusEntry {
        s.entries.iter().find(|e| e.path == path).unwrap_or_else(|| panic!("no entry {path}: {:#?}", s.entries))
    }

    #[test]
    fn branch_header() {
        let s = fixture();
        assert_eq!(s.branch.head.as_deref(), Some("main"));
        assert_eq!(s.branch.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.branch.ahead, s.branch.behind), (1, 0));
        assert_eq!(s.branch.oid.as_deref(), Some("c9a01ad9a1f15e4b5501e2ed8ccc794313eafd03"));
    }

    #[test]
    fn ordinary_changes() {
        let s = fixture();
        let a = entry(&s, "a.txt");
        assert_eq!((a.kind, a.staged, a.unstaged), (ChangeKind::Modified, '.', 'M'));
        assert_eq!(entry(&s, "gone.txt").kind, ChangeKind::Deleted);
        assert_eq!(entry(&s, "with space.txt").kind, ChangeKind::Deleted);
        let added = entry(&s, "staged-add.txt");
        assert_eq!((added.kind, added.staged, added.unstaged), (ChangeKind::Added, 'A', 'M'));
    }

    #[test]
    fn rename_with_unicode_keeps_both_paths() {
        let s = fixture();
        let r = entry(&s, "new name ✓.txt");
        assert_eq!(r.kind, ChangeKind::Renamed);
        assert_eq!(r.orig_path.as_deref(), Some("old-name.txt"));
    }

    #[test]
    fn conflicts_and_untracked() {
        let s = fixture();
        assert_eq!(entry(&s, "conflict.txt").kind, ChangeKind::Conflicted);
        assert_eq!(entry(&s, "untracked file.txt").kind, ChangeKind::Untracked);
        assert_eq!(entry(&s, "ñew.txt").kind, ChangeKind::Untracked);
        assert_eq!(s.entries.len(), 8);
    }

    #[test]
    fn large_repo_header_without_changes() {
        let s = parse_status_v2(include_bytes!("../../tests/fixtures/large-status-v2.bin")).unwrap();
        assert_eq!(s.branch.head.as_deref(), Some("rewrite"));
        assert_eq!((s.branch.ahead, s.branch.behind), (354, 0));
        assert!(s.entries.is_empty());
    }

    #[test]
    fn detached_head_and_no_upstream() {
        let s = parse_status_v2(b"# branch.oid abc\0# branch.head (detached)\0").unwrap();
        assert_eq!(s.branch.head, None);
        assert_eq!(s.branch.upstream, None);
        assert_eq!(s.branch.oid.as_deref(), Some("abc"));
    }

    #[test]
    fn initial_commit_and_ignored_and_type_change() {
        let out = b"# branch.oid (initial)\0# branch.head main\0\
1 .T N... 100644 120000 120000 aaaa aaaa link\0! build/\0";
        let s = parse_status_v2(out).unwrap();
        assert_eq!(s.branch.oid, None);
        assert_eq!(s.entries[0].kind, ChangeKind::Modified);
        assert_eq!(s.entries[1].kind, ChangeKind::Ignored);
        assert_eq!(s.entries[1].path, "build/");
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(parse_status_v2(b"1 M\0").is_err());
        assert!(parse_status_v2(b"2 R. N... 1 2 3 a b R100 only-one-path\0").is_err());
    }
}
