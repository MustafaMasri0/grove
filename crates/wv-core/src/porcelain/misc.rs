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

#[cfg(test)]
mod tests {
    use super::*;

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
