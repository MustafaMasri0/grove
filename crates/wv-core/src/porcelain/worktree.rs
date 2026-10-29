//! `git worktree list --porcelain -z`

use super::lossy;
use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub head: Option<String>,
    /// Short branch name, None when detached or bare.
    pub branch: Option<String>,
    pub detached: bool,
    pub bare: bool,
    pub locked: Option<String>,
    pub prunable: Option<String>,
    /// The first entry git lists is the main worktree.
    pub is_main: bool,
}

pub fn parse_worktree_list(out: &[u8]) -> Result<Vec<Worktree>, String> {
    let sep = if out.contains(&0) { 0 } else { b'\n' };
    let mut list = Vec::new();
    let mut current: Option<Worktree> = None;
    for line in out.split(|&b| b == sep) {
        if line.is_empty() {
            list.extend(current.take());
            continue;
        }
        let text = lossy(line);
        let (key, value) = match text.split_once(' ') {
            Some((k, v)) => (k, Some(v)),
            None => (text.as_str(), None),
        };
        if key == "worktree" {
            list.extend(current.take());
            current = Some(Worktree {
                path: value.unwrap_or_default().to_string(),
                is_main: list.is_empty(),
                ..Default::default()
            });
            continue;
        }
        let wt = current.as_mut().ok_or_else(|| format!("`{text}` before any `worktree` line"))?;
        let value = value.map(str::to_string);
        match key {
            "HEAD" => wt.head = value,
            "branch" => wt.branch = value.map(|v| v.strip_prefix("refs/heads/").map(str::to_string).unwrap_or(v)),
            "detached" => wt.detached = true,
            "bare" => wt.bare = true,
            "locked" => wt.locked = Some(value.unwrap_or_default()),
            "prunable" => wt.prunable = Some(value.unwrap_or_default()),
            _ => {}
        }
    }
    list.extend(current);
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_fixture_covers_branch_detached_locked_prunable() {
        let w = parse_worktree_list(include_bytes!("../../tests/fixtures/worktree-list.bin")).unwrap();
        assert_eq!(w.len(), 4);
        assert!(w[0].is_main && w[0].path.ends_with("/repo"));
        assert_eq!(w[0].branch.as_deref(), Some("main"));
        assert_eq!(w[0].head.as_deref(), Some("c9a01ad9a1f15e4b5501e2ed8ccc794313eafd03"));

        assert!(w[1].path.ends_with("/wt detached"), "space in path: {}", w[1].path);
        assert!(w[1].detached && w[1].branch.is_none() && !w[1].is_main);

        assert_eq!(w[2].branch.as_deref(), Some("wt-branch-name"));
        assert_eq!(w[2].locked.as_deref(), Some("locked for test"));

        assert_eq!(w[3].prunable.as_deref(), Some("gitdir file points to non-existent location"));
    }

    #[test]
    fn large_repo_list() {
        let w = parse_worktree_list(include_bytes!("../../tests/fixtures/large-worktree-list.bin")).unwrap();
        assert_eq!(w.len(), 10);
        assert!(w[0].path.ends_with("/example") && w[0].is_main, "{}", w[0].path);
        assert_eq!(w[0].branch.as_deref(), Some("rewrite"));
        assert_eq!(w[2].branch.as_deref(), Some("prototype/quick-open"));
        assert_eq!(w.iter().filter(|w| w.detached).count(), 6);
    }

    #[test]
    fn newline_separated_output_also_parses() {
        let out = b"worktree /a\nHEAD 1\nbranch refs/heads/x\n\nworktree /b\nbare\n\nworktree /c\nHEAD 2\nlocked\n\n";
        let w = parse_worktree_list(out).unwrap();
        assert_eq!(w.len(), 3);
        assert!(w[1].bare);
        assert_eq!(w[2].locked.as_deref(), Some(""));
    }

    #[test]
    fn missing_worktree_line_is_an_error() {
        assert!(parse_worktree_list(b"HEAD 1\0\0").is_err());
    }
}
