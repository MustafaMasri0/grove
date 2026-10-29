//! `git grep -n -I --column -z`

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub hits: Vec<GrepHit>,
    /// More hits existed than `limit`.
    pub truncated: bool,
}

/// `rev_prefix` is the `<rev>:` git puts in front of paths when grepping a tree.
/// Lines longer than 500 characters are cut short.
pub fn parse_grep(out: &[u8], rev_prefix: Option<&str>, limit: usize) -> GrepResult {
    let mut result = GrepResult::default();
    let prefix = rev_prefix.map(|r| format!("{r}:"));
    for line in out.split(|&b| b == b'\n').filter(|l| !l.is_empty()) {
        let mut f = line.splitn(4, |&b| b == 0);
        let (Some(path), Some(ln), Some(col), Some(text)) = (f.next(), f.next(), f.next(), f.next()) else {
            continue;
        };
        if result.hits.len() == limit {
            result.truncated = true;
            break;
        }
        let path = String::from_utf8_lossy(path);
        let path = match &prefix {
            Some(p) => path.strip_prefix(p.as_str()).unwrap_or(&path).to_string(),
            None => path.into_owned(),
        };
        let text = String::from_utf8_lossy(text);
        result.hits.push(GrepHit {
            path,
            line: String::from_utf8_lossy(ln).parse().unwrap_or(0),
            column: String::from_utf8_lossy(col).parse().unwrap_or(0),
            text: text.trim_end_matches('\r').chars().take(500).collect(),
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixture() {
        let r = parse_grep(include_bytes!("../../tests/fixtures/grep.bin"), None, 1000);
        assert!(!r.truncated);
        assert_eq!(r.hits[0], GrepHit { path: "a.txt".into(), line: 1, column: 3, text: "one".into() });
        assert!(r.hits.iter().any(|h| h.path == "new name ✓.txt" && h.line == 2 && h.text == "line2"));
    }

    #[test]
    fn text_containing_nul_separated_like_fields_and_colons() {
        let r = parse_grep(b"p\x001\x002\x00a:b:c\n", None, 10);
        assert_eq!(r.hits[0].text, "a:b:c");
    }

    #[test]
    fn rev_prefix_is_stripped() {
        let r = parse_grep(b"feature/x:src/a.ts\x0010\x005\x00hit\n", Some("feature/x"), 10);
        assert_eq!(r.hits[0].path, "src/a.ts");
    }

    #[test]
    fn limit_truncates() {
        let r = parse_grep(b"a\x001\x001\x00x\na\x002\x001\x00y\na\x003\x001\x00z\n", None, 2);
        assert_eq!(r.hits.len(), 2);
        assert!(r.truncated);
    }

    #[test]
    fn long_lines_are_cut() {
        let long = "x".repeat(2000);
        let out = format!("a\x001\x001\x00{long}\n");
        let r = parse_grep(out.as_bytes(), None, 10);
        assert_eq!(r.hits[0].text.chars().count(), 500);
    }
}
