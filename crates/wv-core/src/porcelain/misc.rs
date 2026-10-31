//! Small outputs: rev-list counts and NUL-separated path lists.

use super::lossy;

/// `git rev-list --left-right --count A...B` → (left-only, right-only).
pub fn parse_left_right(out: &[u8]) -> Result<(u32, u32), String> {
    let text = lossy(out);
    let mut n = text.split_whitespace().map(str::parse::<u32>);
    match (n.next(), n.next()) {
        (Some(Ok(l)), Some(Ok(r))) => Ok((l, r)),
        _ => Err(format!("unexpected rev-list count: {text:?}")),
    }
}

/// NUL-separated path lists (`ls-files -z`, `ls-tree -z --name-only`), sorted and de-duplicated.
pub fn parse_path_list(out: &[u8]) -> Vec<String> {
    let mut paths: Vec<String> = out.split(|&b| b == 0).filter(|p| !p.is_empty()).map(lossy).collect();
    paths.sort();
    paths.dedup();
    paths
}

/// One file of `git diff --numstat -z`: lines added and removed (0 for a binary file), under its new name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileLines {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

/// `git diff --numstat -z`: `added\tremoved\tpath\0`, or for a rename `added\tremoved\t\0old\0new\0`.
pub fn parse_numstat(out: &[u8]) -> Result<Vec<FileLines>, String> {
    let mut files = vec![];
    let mut fields = out.split(|&b| b == 0);
    while let Some(field) = fields.next().filter(|f| !f.is_empty()) {
        let text = lossy(field);
        let mut parts = text.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(format!("unexpected numstat line: {text:?}"));
        };
        let path = if path.is_empty() {
            fields.next().ok_or("numstat rename without an old name")?;
            lossy(fields.next().filter(|n| !n.is_empty()).ok_or("numstat rename without a new name")?)
        } else {
            path.to_string()
        };
        let lines = |n: &str| if n == "-" { Ok(0) } else { n.parse().map_err(|_| format!("unexpected numstat line: {text:?}")) };
        files.push(FileLines { added: lines(added)?, removed: lines(removed)?, path });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_reads_plain_binary_and_renamed_files() {
        let out = b"3\t1\tsrc/a.ts\0-\t-\tlogo.png\x002\t0\t\0old name.ts\0new name.ts\0";
        let f = |path: &str, added, removed| FileLines { path: path.into(), added, removed };
        assert_eq!(parse_numstat(out).unwrap(), [f("src/a.ts", 3, 1), f("logo.png", 0, 0), f("new name.ts", 2, 0)]);
        assert_eq!(parse_numstat(b"").unwrap(), []);
        assert!(parse_numstat(b"nope\0").is_err());
        assert!(parse_numstat(b"1\t1\t\0only-old\0").is_err());
    }

    #[test]
    fn left_right() {
        assert_eq!(parse_left_right(include_bytes!("../../tests/fixtures/rev-list-count.txt")).unwrap(), (1, 0));
        assert_eq!(parse_left_right(b"12\t7\n").unwrap(), (12, 7));
        assert!(parse_left_right(b"nope").is_err());
    }

    #[test]
    fn path_list_fixture_is_sorted_and_unique() {
        let p = parse_path_list(include_bytes!("../../tests/fixtures/ls-files.bin"));
        assert!(p.contains(&"dir/sub/deep.rs".to_string()));
        assert!(p.contains(&"ñew.txt".to_string()));
        let mut sorted = p.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(p, sorted);
    }

    #[test]
    fn unmerged_paths_listed_per_stage_appear_once() {
        assert_eq!(parse_path_list(b"b\0a\0a\0a\0"), vec!["a", "b"]);
    }
}
