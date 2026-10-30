//! `git log` / `git show -s` with unit/record separators, so subjects and
//! bodies can contain anything.

use super::name_status::{parse_name_status, ChangedFile};
use super::ChangeKind;
use serde::{Deserialize, Serialize};

pub const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e";
/// For `git log --follow --name-status -z`: each record starts with RS, and the
/// file's name-status follows the subject's NUL.
pub const FILE_LOG_FORMAT: &str = "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s";
pub const COMMIT_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    /// ISO 8601 with offset.
    pub author_date: String,
    pub subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub author_date: String,
    pub committer_name: String,
    pub committer_date: String,
    /// Full message, trailing whitespace trimmed.
    pub message: String,
}

pub fn parse_log(out: &[u8]) -> Result<Vec<CommitSummary>, String> {
    let text = String::from_utf8_lossy(out);
    text.split('\x1e')
        .map(|r| r.trim_start_matches('\n'))
        .filter(|r| !r.trim().is_empty())
        .map(|r| {
            let f: Vec<&str> = r.splitn(6, '\x1f').collect();
            let [sha, parents, an, ae, ad, subject] = f[..] else {
                return Err(format!("unexpected log record: {r:?}"));
            };
            Ok(CommitSummary {
                sha: sha.into(),
                parents: split_parents(parents),
                author_name: an.into(),
                author_email: ae.into(),
                author_date: ad.into(),
                subject: subject.trim_end().into(),
            })
        })
        .collect()
}

/// A commit in a file's history, with the file's name and change at that commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCommit {
    pub commit: CommitSummary,
    pub file: ChangedFile,
}

/// Records without a name-status (merges) keep the newer record's path, or `path` for the first.
pub fn parse_file_log(out: &[u8], path: &str) -> Result<Vec<FileCommit>, String> {
    let mut path = path.to_string();
    let mut list = Vec::new();
    for rec in out.split(|&b| b == 0x1e).filter(|r| !r.is_empty()) {
        let (head, status) = match rec.iter().position(|&b| b == 0) {
            Some(i) => (&rec[..i], &rec[i + 1..]),
            None => (rec, &[][..]),
        };
        let mut commits = parse_log(head)?;
        let Some(commit) = commits.pop().filter(|_| commits.is_empty()) else {
            return Err(format!("unexpected file log record: {:?}", String::from_utf8_lossy(rec)));
        };
        let file = parse_name_status(status.strip_prefix(b"\n").unwrap_or(status))?
            .into_iter()
            .next()
            .unwrap_or(ChangedFile { path: path.clone(), orig_path: None, kind: ChangeKind::Modified });
        // Older commits know the file by the name it had before this one renamed it.
        path = file.orig_path.clone().unwrap_or_else(|| file.path.clone());
        list.push(FileCommit { commit, file });
    }
    Ok(list)
}

pub fn parse_commit(out: &[u8]) -> Result<CommitDetail, String> {
    let text = String::from_utf8_lossy(out);
    let f: Vec<&str> = text.splitn(8, '\x1f').collect();
    let [sha, parents, an, ae, ad, cn, cd, message] = f[..] else {
        return Err(format!("unexpected commit output: {text:?}"));
    };
    Ok(CommitDetail {
        sha: sha.trim().into(),
        parents: split_parents(parents),
        author_name: an.into(),
        author_email: ae.into(),
        author_date: ad.into(),
        committer_name: cn.into(),
        committer_date: cd.into(),
        message: message.trim_end().into(),
    })
}

fn split_parents(p: &str) -> Vec<String> {
    p.split_whitespace().map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_fixture() {
        let l = parse_log(include_bytes!("../../tests/fixtures/log.txt")).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].subject, "Main: change conflict.txt");
        assert_eq!(l[0].parents, vec!["9e1c0174dc450abefec8a2a1a28f6368f6a10821".to_string()]);
        assert_eq!(l[0].author_name, "Fixture Author");
        assert_eq!(l[0].author_date, "2026-01-02T03:04:05+01:00");
        assert!(l[1].parents.is_empty(), "root commit has no parents");
    }

    #[test]
    fn subjects_with_odd_characters_and_merge_parents() {
        let out = "a\x1fp1 p2\x1fN\x1fe\x1fd\x1fSubject: with | pipes and ünïcode\x1e\n".as_bytes();
        let l = parse_log(out).unwrap();
        assert_eq!(l[0].parents.len(), 2);
        assert_eq!(l[0].subject, "Subject: with | pipes and ünïcode");
    }

    #[test]
    fn empty_log() {
        assert!(parse_log(b"").unwrap().is_empty());
    }

    #[test]
    fn commit_detail_keeps_body() {
        let c = parse_commit(include_bytes!("../../tests/fixtures/show-commit.txt")).unwrap();
        assert_eq!(c.message, "Initial commit\n\nBody line one.\nBody line two.");
        assert!(c.parents.is_empty());
        assert_eq!(c.committer_name, "Fixture Author");
    }

    fn rec(sha: &str, subject: &str, status: &str) -> String {
        format!("\x1e{sha}\x1fp\x1fN\x1fe@x\x1f2026-01-02T03:04:05+01:00\x1f{subject}\0\n{status}")
    }

    #[test]
    fn file_log_follows_renames() {
        let out = [
            rec("c3", "move it", "R100\0a.txt\0s/b c.txt\0"),
            rec("c2", "edit", "M\0a.txt\0"),
            rec("c1", "first", "A\0a.txt\0"),
        ]
        .concat();
        let l = parse_file_log(out.as_bytes(), "s/b c.txt").unwrap();
        let got: Vec<_> = l.iter().map(|f| (f.commit.sha.as_str(), f.commit.subject.as_str(), f.file.path.as_str(), f.file.orig_path.as_deref(), f.file.kind)).collect();
        assert_eq!(
            got,
            vec![
                ("c3", "move it", "s/b c.txt", Some("a.txt"), ChangeKind::Renamed),
                ("c2", "edit", "a.txt", None, ChangeKind::Modified),
                ("c1", "first", "a.txt", None, ChangeKind::Added),
            ]
        );
        assert_eq!(l[0].commit.author_email, "e@x");
    }

    #[test]
    fn file_log_merges_without_status_keep_the_newer_path() {
        let out = [rec("m", "merge", ""), rec("c2", "rename", "R090\0old.txt\0new.txt\0"), rec("m2", "older merge", "")].concat();
        let l = parse_file_log(out.as_bytes(), "new.txt").unwrap();
        let got: Vec<_> = l.iter().map(|f| (f.file.path.as_str(), f.file.kind)).collect();
        assert_eq!(got, vec![("new.txt", ChangeKind::Modified), ("new.txt", ChangeKind::Renamed), ("old.txt", ChangeKind::Modified)]);
    }

    #[test]
    fn file_log_empty_and_bad() {
        assert!(parse_file_log(b"", "a").unwrap().is_empty());
        assert!(parse_file_log(b"\x1eonly\x1ftwo\0\n", "a").is_err());
    }

    #[test]
    fn short_record_is_an_error() {
        assert!(parse_log(b"a\x1fb\x1e").is_err());
    }
}
