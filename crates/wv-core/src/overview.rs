//! The Worktrees overview: every worktree's state at a glance, and the files
//! two worktrees both change, where merging one into the other may conflict.

use crate::host::GitHost;
use crate::porcelain::log::{parse_log, CommitSummary, LOG_FORMAT};
use crate::porcelain::misc::{parse_left_right, parse_path_list};
use crate::porcelain::name_status::ChangedFile;
use crate::porcelain::ChangeKind;
use crate::repo_ops::{run, run_text, status, succeeds};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSummary {
    pub path: String,
    /// None when HEAD is detached.
    pub branch: Option<String>,
    /// None before the first commit.
    pub head: Option<String>,
    /// What the Changes list shows: every status entry but ignored files.
    pub uncommitted: Vec<ChangedFile>,
    /// Files HEAD changed since it split from the base (renames as delete + add); empty without a base.
    pub committed: Vec<String>,
    /// Commits on HEAD that the base does not have, and the other way round.
    pub base_ahead: u32,
    pub base_behind: u32,
    pub upstream: Option<String>,
    pub upstream_ahead: u32,
    pub upstream_behind: u32,
    pub last_commit: Option<CommitSummary>,
}

impl WorktreeSummary {
    fn uncommitted_paths(&self) -> impl Iterator<Item = &str> {
        self.uncommitted.iter().flat_map(|f| std::iter::once(f.path.as_str()).chain(f.orig_path.as_deref()))
    }

    /// Every file the worktree changes against the base, committed or not.
    fn touched(&self) -> BTreeSet<&str> {
        self.committed.iter().map(String::as_str).chain(self.uncommitted_paths()).collect()
    }
}

/// Files that two worktrees both change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlap {
    pub a: String,
    pub b: String,
    /// Sorted.
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    /// In the order the worktrees were asked for, minus those that could not be read.
    pub worktrees: Vec<WorktreeSummary>,
    /// Worktree path → why it could not be read.
    pub errors: BTreeMap<String, String>,
    pub overlaps: Vec<Overlap>,
}

/// One worktree's state; `base` is the branch it is compared with ("Branch vs base").
pub fn summary(h: &dyn GitHost, cwd: &str, base: Option<&str>) -> Result<WorktreeSummary, String> {
    let st = status(h, cwd)?;
    let uncommitted = st
        .entries
        .into_iter()
        .filter(|e| e.kind != ChangeKind::Ignored)
        .map(|e| ChangedFile { path: e.path, orig_path: e.orig_path, kind: e.kind })
        .collect();
    let head = st.branch.oid.filter(|o| o.chars().all(|c| c.is_ascii_hexdigit()));
    let mut s = WorktreeSummary {
        path: cwd.to_string(),
        branch: st.branch.head,
        head: head.clone(),
        uncommitted,
        committed: vec![],
        base_ahead: 0,
        base_behind: 0,
        upstream: st.branch.upstream,
        upstream_ahead: st.branch.ahead,
        upstream_behind: st.branch.behind,
        last_commit: None,
    };
    let Some(head) = head else { return Ok(s) };
    s.last_commit = parse_log(&run(h, cwd, &["log", LOG_FORMAT, "--max-count=1", &head, "--"])?)?.into_iter().next();
    if let Some(base) = base {
        // A base without a common ancestor (an unrelated history) has nothing to compare.
        if let Ok(merge_base) = run_text(h, cwd, &["merge-base", base, &head]) {
            s.committed = parse_path_list(&run(h, cwd, &["diff", "--name-only", "-z", "--no-renames", &merge_base, &head, "--"])?);
            (s.base_behind, s.base_ahead) = parse_left_right(&run(h, cwd, &["rev-list", "--left-right", "--count", &format!("{base}...{head}")])?)?;
        }
    }
    Ok(s)
}

/// Every worktree in `cwds` side by side, and the files they both change.
pub fn overview(h: &dyn GitHost, cwds: &[String], base: Option<&str>) -> Overview {
    let results: Vec<_> = std::thread::scope(|sc| {
        let handles: Vec<_> = cwds.iter().map(|cwd| sc.spawn(move || summary(h, cwd, base))).collect();
        handles.into_iter().map(|t| t.join().unwrap_or_else(|_| Err("reading the worktree failed".into()))).collect()
    });
    let mut out = Overview::default();
    for (cwd, r) in cwds.iter().zip(results) {
        match r {
            Ok(s) => out.worktrees.push(s),
            Err(e) => {
                out.errors.insert(cwd.clone(), e);
            }
        }
    }
    if let Some(first) = out.worktrees.first().map(|w| w.path.clone()) {
        out.overlaps = overlaps(&out.worktrees, |a, b| diverging(h, &first, a, b));
    }
    out
}

/// The files that both commits change in a way a merge has to reconcile: none when one contains
/// the other (a fast-forward), else those whose content differs at the two commits.
fn diverging(h: &dyn GitHost, cwd: &str, a: &str, b: &str) -> Result<HashSet<String>, String> {
    if a == b || succeeds(h, cwd, &["merge-base", "--is-ancestor", a, b])? || succeeds(h, cwd, &["merge-base", "--is-ancestor", b, a])? {
        return Ok(HashSet::new());
    }
    Ok(parse_path_list(&run(h, cwd, &["diff", "--name-only", "-z", "--no-renames", a, b, "--"])?).into_iter().collect())
}

/// Pairs of worktrees that change the same files. A file only committed on both sides counts when
/// `diverging(head_a, head_b)` lists it; an uncommitted change always counts, since git cannot know yet
/// how it will end up. When `diverging` fails, every shared file counts.
pub fn overlaps(worktrees: &[WorktreeSummary], mut diverging: impl FnMut(&str, &str) -> Result<HashSet<String>, String>) -> Vec<Overlap> {
    let touched: Vec<_> = worktrees.iter().map(WorktreeSummary::touched).collect();
    let dirty: Vec<HashSet<&str>> = worktrees.iter().map(|w| w.uncommitted_paths().collect()).collect();
    let mut found = vec![];
    for i in 0..worktrees.len() {
        for j in i + 1..worktrees.len() {
            let shared: Vec<&str> = touched[i].intersection(&touched[j]).copied().collect();
            if shared.is_empty() {
                continue;
            }
            let (a, b) = (&worktrees[i], &worktrees[j]);
            let committed_only = |f: &&str| !dirty[i].contains(f) && !dirty[j].contains(f);
            let differ = match (&a.head, &b.head) {
                _ if !shared.iter().any(committed_only) => None,
                (Some(ha), Some(hb)) => diverging(ha, hb).ok(),
                _ => None,
            };
            let files: Vec<String> = shared
                .into_iter()
                .filter(|f| !committed_only(f) || differ.as_ref().is_none_or(|d| d.contains(*f)))
                .map(str::to_string)
                .collect();
            if !files.is_empty() {
                found.push(Overlap { a: a.path.clone(), b: b.path.clone(), files });
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wt(path: &str, head: &str, committed: &[&str], uncommitted: &[&str]) -> WorktreeSummary {
        WorktreeSummary {
            path: path.into(),
            branch: Some(path.into()),
            head: Some(head.into()),
            uncommitted: uncommitted.iter().map(|p| ChangedFile { path: p.to_string(), orig_path: None, kind: ChangeKind::Modified }).collect(),
            committed: committed.iter().map(|p| p.to_string()).collect(),
            base_ahead: 0,
            base_behind: 0,
            upstream: None,
            upstream_ahead: 0,
            upstream_behind: 0,
            last_commit: None,
        }
    }

    fn set(files: &[&str]) -> HashSet<String> {
        files.iter().map(|f| f.to_string()).collect()
    }

    #[test]
    fn shared_files_are_reported_once_per_pair() {
        let w = [wt("a", "1", &["x", "y"], &["z"]), wt("b", "2", &["y"], &["z", "q"]), wt("c", "3", &["other"], &[])];
        let o = overlaps(&w, |_, _| Ok(set(&["x", "y", "z", "q"])));
        assert_eq!(o, vec![Overlap { a: "a".into(), b: "b".into(), files: vec!["y".into(), "z".into()] }]);
    }

    #[test]
    fn committed_files_with_the_same_content_on_both_sides_do_not_count() {
        let w = [wt("a", "1", &["same", "differs"], &[]), wt("b", "2", &["same", "differs"], &[])];
        let o = overlaps(&w, |_, _| Ok(set(&["differs"])));
        assert_eq!(o[0].files, vec!["differs"]);
        // A fast-forward (or identical tips) cannot conflict.
        assert!(overlaps(&w, |_, _| Ok(set(&[]))).is_empty());
    }

    #[test]
    fn uncommitted_changes_always_count_and_skip_the_git_check() {
        let w = [wt("a", "1", &[], &["f"]), wt("b", "2", &["f"], &[])];
        let o = overlaps(&w, |_, _| panic!("no committed-only files to check"));
        assert_eq!(o[0].files, vec!["f"]);
    }

    #[test]
    fn renamed_files_overlap_under_both_names() {
        let mut a = wt("a", "1", &[], &[]);
        a.uncommitted.push(ChangedFile { path: "new".into(), orig_path: Some("old".into()), kind: ChangeKind::Renamed });
        let w = [a, wt("b", "2", &[], &["old"])];
        assert_eq!(overlaps(&w, |_, _| Ok(set(&[])))[0].files, vec!["old"]);
    }

    #[test]
    fn when_the_check_fails_every_shared_file_counts() {
        let w = [wt("a", "1", &["f"], &[]), wt("b", "2", &["f"], &[])];
        assert_eq!(overlaps(&w, |_, _| Err("boom".into()))[0].files, vec!["f"]);
    }
}
