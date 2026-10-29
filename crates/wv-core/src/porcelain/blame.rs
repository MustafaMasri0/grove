//! `git blame --porcelain`: which commit last changed each line.

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub author_name: String,
    pub author_email: String,
    /// Unix seconds.
    pub author_time: i64,
    pub summary: String,
    /// Lines changed in the worktree and not committed yet (git's all-zero SHA).
    pub uncommitted: bool,
}

/// Consecutive lines last changed by the same commit; `start` is 1-based.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    pub sha: String,
    pub start: u32,
    pub count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blame {
    pub hunks: Vec<BlameHunk>,
    pub commits: BTreeMap<String, BlameCommit>,
}

pub fn parse_blame(out: &[u8]) -> Result<Blame, String> {
    let text = String::from_utf8_lossy(out);
    let mut blame = Blame::default();
    // The commit of the line being read, and whether the next line is a header.
    let mut current: Option<String> = None;
    let mut want_header = true;
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if want_header {
            if line.is_empty() {
                continue;
            }
            // `<sha> <orig line> <final line> [<lines in group>]`
            let f: Vec<&str> = line.split(' ').collect();
            let (Some(sha), Some(final_line)) = (f.first(), f.get(2).and_then(|n| n.parse::<u32>().ok())) else {
                return Err(format!("unexpected blame header: {line:?}"));
            };
            if !(sha.len() == 40 || sha.len() == 64) || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(format!("unexpected blame header: {line:?}"));
            }
            match blame.hunks.last_mut() {
                Some(h) if h.sha == *sha && h.start + h.count == final_line => h.count += 1,
                _ => blame.hunks.push(BlameHunk { sha: sha.to_string(), start: final_line, count: 1 }),
            }
            blame.commits.entry(sha.to_string()).or_insert_with(|| BlameCommit {
                author_name: String::new(),
                author_email: String::new(),
                author_time: 0,
                summary: String::new(),
                uncommitted: sha.bytes().all(|b| b == b'0'),
            });
            current = Some(sha.to_string());
            want_header = false;
        } else if line.starts_with('\t') {
            // The line's content ends the record.
            want_header = true;
        } else if let (Some(sha), Some((key, value))) = (&current, line.split_once(' ')) {
            let c = blame.commits.get_mut(sha).expect("inserted with the header");
            match key {
                "author" => c.author_name = value.to_string(),
                "author-mail" => c.author_email = value.trim_start_matches('<').trim_end_matches('>').to_string(),
                "author-time" => c.author_time = value.parse().unwrap_or(0),
                "summary" => c.summary = value.to_string(),
                _ => {}
            }
        }
    }
    Ok(blame)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "d50d41840fa337ccb7d367ca6163c1440a9f6af7";
    const B: &str = "721e70cb80a8339b701cec164ddf48cb035cadc2";
    const Z: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn porcelain_fixture() {
        let b = parse_blame(include_bytes!("../../tests/fixtures/blame-porcelain.txt")).unwrap();
        assert_eq!(
            b.hunks,
            vec![
                BlameHunk { sha: A.into(), start: 1, count: 1 },
                BlameHunk { sha: B.into(), start: 2, count: 2 },
                BlameHunk { sha: Z.into(), start: 4, count: 1 },
            ]
        );
        assert_eq!(b.commits.len(), 3);
        let a = &b.commits[A];
        assert_eq!((a.author_name.as_str(), a.author_email.as_str(), a.author_time), ("T", "t@e.com", 1793251797));
        assert_eq!(a.summary, "first");
        assert!(!a.uncommitted);
        assert!(b.commits[Z].uncommitted);
    }

    #[test]
    fn lines_with_tabs_and_header_lookalikes_are_content() {
        // A content line always starts with a tab, so text like "author X" inside the file is never a header.
        let out = format!("{A} 1 1 2\nauthor N\nauthor-mail <n@x>\nauthor-time 5\nsummary s\nfilename f\n\tauthor evil\n{A} 2 2\n\t{B} 9 9 9\n");
        let b = parse_blame(out.as_bytes()).unwrap();
        assert_eq!(b.hunks, vec![BlameHunk { sha: A.into(), start: 1, count: 2 }]);
        assert_eq!(b.commits[A].author_name, "N");
    }

    #[test]
    fn same_commit_in_separate_places_makes_separate_hunks() {
        let out = format!("{A} 1 1 1\nauthor N\nsummary s\n\tx\n{B} 1 2 1\nauthor M\nsummary t\n\ty\n{A} 2 3 1\n\tz\n");
        let b = parse_blame(out.as_bytes()).unwrap();
        assert_eq!(b.hunks.iter().map(|h| (h.start, h.count)).collect::<Vec<_>>(), vec![(1, 1), (2, 1), (3, 1)]);
        assert_eq!(b.commits.len(), 2);
    }

    #[test]
    fn empty_file_and_garbage() {
        assert_eq!(parse_blame(b"").unwrap(), Blame::default());
        assert!(parse_blame(b"not a header\n\tx\n").is_err());
    }
}
