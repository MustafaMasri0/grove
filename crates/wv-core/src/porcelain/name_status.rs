//! `git diff --name-status -z -M`, used for Branch vs base and commit file lists.

use super::{lossy, ChangeKind};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
}

pub fn parse_name_status(out: &[u8]) -> Result<Vec<ChangedFile>, String> {
    let mut fields = out.split(|&b| b == 0).filter(|f| !f.is_empty());
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let letter = status[0];
        let mut next_path = || fields.next().map(lossy).ok_or_else(|| format!("missing path after {}", lossy(status)));
        let (kind, orig_path, path) = match letter {
            b'R' | b'C' => {
                let orig = next_path()?;
                let path = next_path()?;
                (if letter == b'R' { ChangeKind::Renamed } else { ChangeKind::Copied }, Some(orig), path)
            }
            b'A' => (ChangeKind::Added, None, next_path()?),
            b'D' => (ChangeKind::Deleted, None, next_path()?),
            b'U' => (ChangeKind::Conflicted, None, next_path()?),
            b'M' | b'T' | b'X' => (ChangeKind::Modified, None, next_path()?),
            _ => return Err(format!("unknown name-status letter {}", lossy(status))),
        };
        files.push(ChangedFile { path, orig_path, kind });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture() {
        let f = parse_name_status(include_bytes!("../../tests/fixtures/diff-name-status.bin")).unwrap();
        let kinds: Vec<_> = f.iter().map(|f| (f.path.as_str(), f.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                ("a.txt", ChangeKind::Modified),
                ("conflict.txt", ChangeKind::Modified),
                ("gone.txt", ChangeKind::Deleted),
                ("new name ✓.txt", ChangeKind::Renamed),
                ("staged-add.txt", ChangeKind::Added),
                ("with space.txt", ChangeKind::Deleted),
            ]
        );
        assert_eq!(f[3].orig_path.as_deref(), Some("old-name.txt"));
    }

    #[test]
    fn copies_type_changes_and_unmerged() {
        let f = parse_name_status(b"C075\0src\0dst\0T\0link\0U\0both\0").unwrap();
        assert_eq!(f[0].kind, ChangeKind::Copied);
        assert_eq!(f[0].orig_path.as_deref(), Some("src"));
        assert_eq!(f[1].kind, ChangeKind::Modified);
        assert_eq!(f[2].kind, ChangeKind::Conflicted);
    }

    #[test]
    fn truncated_rename_is_an_error() {
        assert!(parse_name_status(b"R100\0only\0").is_err());
        let _ = lossy(b"");
    }
}
