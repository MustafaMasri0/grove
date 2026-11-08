//! Everything the UI asks of a repository, written once against [`GitHost`]
//! so Windows and WSL repositories behave the same.

use crate::editable::Rules;
use crate::host::{join, GitHost, GitOutput, Progress, WatchSpec, WriteOutcome};
use crate::porcelain::blame::{parse_blame, Blame};
use crate::porcelain::grep::{parse_grep, GrepResult};
use crate::porcelain::log::{parse_commit, parse_file_log, parse_log, CommitDetail, CommitSummary, COMMIT_FORMAT, FILE_LOG_FORMAT, LOG_FORMAT};
use crate::porcelain::misc::parse_path_list;
use crate::porcelain::name_status::{parse_name_status, ChangedFile};
use crate::porcelain::refs::{parse_refs, BranchRef, REF_FORMAT};
use crate::porcelain::status::{parse_status_v2, Status};
use crate::porcelain::worktree::{parse_worktree_list, Worktree};
use serde::{Deserialize, Serialize};

/// Files larger than this are not shown.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// Images are shown up to this size; above it the view says so instead.
pub const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
const BINARY_SNIFF: usize = 8000;
const EMPTY_TREE_SHA1: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const EMPTY_TREE_SHA256: &str = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

pub(crate) fn run(h: &dyn GitHost, cwd: &str, a: &[&str]) -> Result<Vec<u8>, String> {
    h.git(cwd, &args(a), None)?.ok()
}

pub(crate) fn run_text(h: &dyn GitHost, cwd: &str, a: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&run(h, cwd, a)?).trim().to_string())
}

pub(crate) fn succeeds(h: &dyn GitHost, cwd: &str, a: &[&str]) -> Result<bool, String> {
    Ok(h.git(cwd, &args(a), None)?.code == 0)
}

fn is_absolute(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/') || p.starts_with('\\') || (b.len() >= 2 && b[1] == b':')
}

fn absolute(cwd: &str, p: &str) -> String {
    if is_absolute(p) { p.to_string() } else { join(cwd, p) }
}

/// The top-level folder of the worktree containing `path`; fails if it is not a git repository.
pub fn toplevel(h: &dyn GitHost, path: &str) -> Result<String, String> {
    run_text(h, path, &["rev-parse", "--show-toplevel"])
}

pub fn worktrees(h: &dyn GitHost, cwd: &str) -> Result<Vec<Worktree>, String> {
    parse_worktree_list(&run(h, cwd, &["worktree", "list", "--porcelain", "-z"])?)
}

pub fn status(h: &dyn GitHost, cwd: &str) -> Result<Status, String> {
    parse_status_v2(&run(h, cwd, &["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"])?)
}

pub fn branches(h: &dyn GitHost, cwd: &str) -> Result<Vec<BranchRef>, String> {
    parse_refs(&run(h, cwd, &["for-each-ref", REF_FORMAT, "--sort=-committerdate", "refs/heads", "refs/remotes"])?)
}

/// The base branch for "Branch vs base": the preferred one if it still exists,
/// else development, main, master (local first, then origin/), else origin's
/// default branch (`origin/HEAD`, set by `git clone`; local first again).
pub fn resolve_base(h: &dyn GitHost, cwd: &str, preferred: Option<&str>) -> Result<Option<String>, String> {
    if let Some(p) = preferred.filter(|p| !p.is_empty()) {
        if succeeds(h, cwd, &["rev-parse", "--verify", "--quiet", &format!("{p}^{{commit}}")])? {
            return Ok(Some(p.to_string()));
        }
    }
    let local_or_origin = |name: &str| -> Result<Option<String>, String> {
        if succeeds(h, cwd, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")])? {
            return Ok(Some(name.to_string()));
        }
        if succeeds(h, cwd, &["rev-parse", "--verify", "--quiet", &format!("refs/remotes/origin/{name}")])? {
            return Ok(Some(format!("origin/{name}")));
        }
        Ok(None)
    };
    for name in ["development", "main", "master"] {
        if let Some(base) = local_or_origin(name)? {
            return Ok(Some(base));
        }
    }
    match origin_default_branch(h, cwd)? {
        Some(name) => local_or_origin(&name),
        None => Ok(None),
    }
}

/// The branch `origin/HEAD` points at: the remote's default branch, as `git clone` sets it.
fn origin_default_branch(h: &dyn GitHost, cwd: &str) -> Result<Option<String>, String> {
    let out = h.git(cwd, &args(&["rev-parse", "--abbrev-ref", "--verify", "--quiet", "refs/remotes/origin/HEAD"]), None)?;
    let name = String::from_utf8_lossy(&out.stdout).trim().strip_prefix("origin/").map(str::to_string);
    Ok(name.filter(|n| out.code == 0 && !n.is_empty() && n != "HEAD"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseDiff {
    pub merge_base: String,
    pub files: Vec<ChangedFile>,
}

/// What `rev` changed since it split from `base`.
pub fn branch_changes(h: &dyn GitHost, cwd: &str, base: &str, rev: &str) -> Result<BaseDiff, String> {
    let merge_base = run_text(h, cwd, &["merge-base", base, rev])?;
    let files = parse_name_status(&run(h, cwd, &["diff", "--name-status", "-z", "-M", &merge_base, rev, "--"])?)?;
    Ok(BaseDiff { merge_base, files })
}

pub fn log(h: &dyn GitHost, cwd: &str, rev: &str, skip: u32, limit: u32) -> Result<Vec<CommitSummary>, String> {
    let skip = format!("--skip={skip}");
    let limit = format!("--max-count={limit}");
    parse_log(&run(h, cwd, &["log", LOG_FORMAT, &skip, &limit, rev, "--"])?)
}

/// A commit in a file's history, and what to compare it with.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntry {
    pub commit: CommitSummary,
    pub file: ChangedFile,
    /// The first parent, or the empty tree for a root commit.
    pub parent: String,
}

/// The commits of `rev` that touched `path`, newest first, following renames.
pub fn file_history(h: &dyn GitHost, cwd: &str, rev: &str, path: &str, skip: u32, limit: u32) -> Result<Vec<FileHistoryEntry>, String> {
    // With --follow, git applies --skip before it filters by the file, so pages are cut here instead.
    let max = format!("--max-count={}", skip + limit);
    let out = run(h, cwd, &["log", "--follow", "--name-status", "-z", "-M", FILE_LOG_FORMAT, &max, rev, "--", path])?;
    Ok(parse_file_log(&out, path)?
        .into_iter()
        .skip(skip as usize)
        .map(|f| FileHistoryEntry { parent: parent_of(&f.commit.parents, &f.commit.sha), commit: f.commit, file: f.file })
        .collect())
}

/// What a commit's files are compared with: its first parent, or the empty tree.
fn parent_of(parents: &[String], sha: &str) -> String {
    match parents.first() {
        Some(p) => p.clone(),
        None if sha.len() == 64 => EMPTY_TREE_SHA256.to_string(),
        None => EMPTY_TREE_SHA1.to_string(),
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearch {
    pub commits: Vec<CommitSummary>,
    /// More commits match than were returned.
    pub truncated: bool,
}

/// Commits of `rev` whose message, author or SHA contains `query` (plain text, any case).
/// git ANDs `--grep` with `--author`, so messages and authors are two walks, merged newest first.
pub fn search_log(h: &dyn GitHost, cwd: &str, rev: &str, query: &str, limit: u32) -> Result<HistorySearch, String> {
    let q = query.trim();
    if q.is_empty() || limit == 0 {
        return Ok(HistorySearch::default());
    }
    let max = format!("--max-count={}", limit + 1);
    let walk = |filter: String| -> Result<Vec<CommitSummary>, String> {
        // One `--grep=<text>` argument, so the text can never be read as an option.
        parse_log(&run(h, cwd, &["log", LOG_FORMAT, "-i", "-F", &filter, &max, rev, "--"])?)
    };
    let mut lists = vec![walk(format!("--grep={q}"))?, walk(format!("--author={q}"))?];
    let mut truncated = lists.iter().any(|l| l.len() > limit as usize);

    let mut by_sha = Vec::new();
    if (4..=64).contains(&q.len()) && q.bytes().all(|b| b.is_ascii_hexdigit()) {
        let resolved = h.git(cwd, &args(&["rev-parse", "--verify", "--quiet", &format!("{}^{{commit}}", q.to_lowercase())]), None)?;
        let sha = String::from_utf8_lossy(&resolved.stdout).trim().to_string();
        if resolved.code == 0 && succeeds(h, cwd, &["merge-base", "--is-ancestor", &sha, rev])? {
            by_sha = parse_log(&run(h, cwd, &["log", LOG_FORMAT, "--max-count=1", &sha, "--"])?)?;
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut found: Vec<CommitSummary> = lists.iter_mut().flat_map(std::mem::take).filter(|c| seen.insert(c.sha.clone())).collect();
    // ISO dates with offsets do not sort as text.
    found.sort_by_key(|c| std::cmp::Reverse(iso_to_unix(&c.author_date)));
    let mut commits: Vec<CommitSummary> = by_sha.into_iter().filter(|c| seen.insert(c.sha.clone())).collect();
    commits.extend(found);
    if commits.len() > limit as usize {
        commits.truncate(limit as usize);
        truncated = true;
    }
    Ok(HistorySearch { commits, truncated })
}

/// Unix seconds of git's strict ISO 8601 (`2026-01-02T03:04:05+01:00`); 0 when unreadable.
fn iso_to_unix(s: &str) -> i64 {
    let n = |r: std::ops::Range<usize>| s.get(r).and_then(|x| x.parse::<i64>().ok());
    let (Some(y), Some(mo), Some(d), Some(hh), Some(mm), Some(ss)) = (n(0..4), n(5..7), n(8..10), n(11..13), n(14..16), n(17..19)) else {
        return 0;
    };
    let offset = match (s.get(19..20), n(20..22), n(23..25)) {
        (Some(sign @ ("+" | "-")), Some(oh), Some(om)) => (oh * 3600 + om * 60) * if sign == "-" { -1 } else { 1 },
        _ => 0,
    };
    // Days since 1970-01-01 (Howard Hinnant's days_from_civil).
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    days * 86400 + hh * 3600 + mm * 60 + ss - offset
}

/// Who last changed each line of a file in the worktree or in a revision.
pub fn blame(h: &dyn GitHost, cwd: &str, source: &Source) -> Result<Blame, String> {
    let out = match source {
        Source::Worktree { path } => h.git(cwd, &args(&["blame", "--porcelain", "--", path]), None)?,
        Source::Rev { rev, path } => h.git(cwd, &args(&["blame", "--porcelain", rev, "--", path]), None)?,
        Source::Empty => return Err("nothing to blame".into()),
    };
    if out.code != 0 {
        return Err(out.stderr.trim().trim_start_matches("fatal: ").to_string());
    }
    parse_blame(&out.stdout)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitWithFiles {
    pub detail: CommitDetail,
    /// The revision the files are compared against: the first parent, or the empty tree.
    pub parent: String,
    pub files: Vec<ChangedFile>,
}

pub fn commit(h: &dyn GitHost, cwd: &str, sha: &str) -> Result<CommitWithFiles, String> {
    let detail = parse_commit(&run(h, cwd, &["show", "-s", COMMIT_FORMAT, sha, "--"])?)?;
    let parent = parent_of(&detail.parents, &detail.sha);
    let files = parse_name_status(&run(h, cwd, &["diff", "--name-status", "-z", "-M", &parent, &detail.sha, "--"])?)?;
    Ok(CommitWithFiles { detail, parent, files })
}

/// One side of a diff, or a file to view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    /// A file as stored in a commit or branch.
    Rev { rev: String, path: String },
    /// A file in the worktree on disk, relative to the worktree root.
    Worktree { path: String },
    /// Nothing (the missing side of an added or deleted file).
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Content {
    Text { text: String },
    Binary { size: u64 },
    TooLarge { size: u64 },
    Missing,
}

pub fn decode(bytes: &[u8]) -> Content {
    if bytes[..bytes.len().min(BINARY_SNIFF)].contains(&0) {
        return Content::Binary { size: bytes.len() as u64 };
    }
    let bytes = bytes.strip_prefix(BOM).unwrap_or(bytes);
    Content::Text { text: String::from_utf8_lossy(bytes).into_owned() }
}

pub fn read_source(h: &dyn GitHost, cwd: &str, source: &Source) -> Result<Content, String> {
    match source {
        Source::Empty => Ok(Content::Text { text: String::new() }),
        Source::Rev { rev, path } => {
            let object = format!("{rev}:{path}");
            let size = h.git(cwd, &args(&["cat-file", "-s", &object]), None)?;
            if size.code != 0 {
                return Ok(Content::Missing);
            }
            let size: u64 = String::from_utf8_lossy(&size.stdout).trim().parse().unwrap_or(0);
            if size > MAX_FILE_BYTES {
                return Ok(Content::TooLarge { size });
            }
            Ok(decode(&run(h, cwd, &["cat-file", "blob", &object])?))
        }
        Source::Worktree { path } => {
            let full = join(cwd, path);
            match h.read_file(&full, MAX_FILE_BYTES) {
                Ok(f) => Ok(match f.data {
                    Some(data) => decode(&data),
                    None => Content::TooLarge { size: f.size },
                }),
                Err(e) => match h.mtime(&full)? {
                    None => Ok(Content::Missing),
                    Some(_) => Err(e),
                },
            }
        }
    }
}

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Whether a worktree file may be edited, and whether git tracks it (then a saved edit
/// is a change to commit, which matters for a file that holds secrets).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAccess {
    pub editable: bool,
    /// Why it is read-only, for files the editable patterns name but Grove cannot edit.
    pub reason: Option<String>,
    pub tracked: bool,
}

pub fn file_access(h: &dyn GitHost, cwd: &str, rel: &str, rules: &Rules) -> Result<FileAccess, String> {
    let editable = rules
        .check(rel)
        .and_then(|()| h.check_writable(cwd, rel))
        .and_then(|()| editable_text(h, &join(cwd, rel)).map(|_| ()));
    // Only an editable file shows whether git tracks it; the literal pathspec keeps `[`, `*` and `?` in names as they are.
    let tracked = editable.is_ok() && !run(h, cwd, &["ls-files", "-z", "--", &format!(":(literal){rel}")])?.is_empty();
    Ok(FileAccess { editable: editable.is_ok(), reason: editable.err().filter(|_| rules.allows(rel)), tracked })
}

/// Whether `text` ends its lines in more than one way (CRLF, LF, CR). The editor keeps one, so a save would change them all.
fn mixed_line_endings(text: &[u8]) -> bool {
    let (mut crlf, mut lf, mut cr) = (false, false, false);
    let mut i = 0;
    while i < text.len() {
        match text[i] {
            b'\r' if text.get(i + 1) == Some(&b'\n') => {
                crlf = true;
                i += 1;
            }
            b'\r' => cr = true,
            b'\n' => lf = true,
            _ => {}
        }
        i += 1;
    }
    [crlf, lf, cr].iter().filter(|&&k| k).count() > 1
}

/// The file's bytes, and where its text starts (after a BOM), when Grove can edit it as text.
fn editable_text(h: &dyn GitHost, full: &str) -> Result<(Vec<u8>, usize), String> {
    let read = h.read_file(full, MAX_FILE_BYTES)?;
    let data = read.data.ok_or_else(|| "the file is too large to edit".to_string())?;
    let start = if data.starts_with(BOM) { BOM.len() } else { 0 };
    // Text Grove would show with replacement characters would be saved with them.
    if data[..data.len().min(BINARY_SNIFF)].contains(&0) || std::str::from_utf8(&data[start..]).is_err() {
        return Err("only UTF-8 text files can be edited".into());
    }
    if mixed_line_endings(&data[start..]) {
        return Err("the file mixes line endings (CRLF and LF), and saving it would change every line".into());
    }
    Ok((data, start))
}

/// Saves `text` to the worktree file `rel` if the user's patterns allow it, keeping a BOM the file
/// had. With `base`, the text the editor started from, a file changed on disk since then is left
/// alone and reported; without it, the edit replaces whatever the file holds now.
pub fn save_file(h: &dyn GitHost, cwd: &str, rel: &str, base: Option<&str>, text: &str, rules: &Rules) -> Result<WriteOutcome, String> {
    rules.check(rel)?;
    let full = join(cwd, rel);
    let (current, start) = editable_text(h, &full)?;
    if base.is_some_and(|b| b.as_bytes() != &current[start..]) {
        return Ok(WriteOutcome::ChangedOnDisk);
    }
    let mut data = current[..start].to_vec();
    data.extend_from_slice(text.as_bytes());
    h.write_file(cwd, rel, &data, &current)
}

/// Raw bytes (images in Markdown previews); None when missing, empty or over [`MAX_FILE_BYTES`].
pub fn read_bytes(h: &dyn GitHost, cwd: &str, source: &Source) -> Result<Option<Vec<u8>>, String> {
    read_bytes_max(h, cwd, source, MAX_FILE_BYTES)
}

/// Raw bytes of a source, None when it is missing or larger than `max`.
pub fn read_bytes_max(h: &dyn GitHost, cwd: &str, source: &Source, max: u64) -> Result<Option<Vec<u8>>, String> {
    match source {
        Source::Empty => Ok(None),
        Source::Rev { rev, path } => {
            let object = format!("{rev}:{path}");
            let size = h.git(cwd, &args(&["cat-file", "-s", &object]), None)?;
            let size: u64 = String::from_utf8_lossy(&size.stdout).trim().parse().unwrap_or(u64::MAX);
            if size > max {
                return Ok(None);
            }
            Ok(Some(run(h, cwd, &["cat-file", "blob", &object])?))
        }
        Source::Worktree { path } => match h.read_file(&join(cwd, path), max) {
            Ok(f) => Ok(f.data),
            Err(_) => Ok(None),
        },
    }
}

/// A source's size in bytes without reading it; None when it does not exist (or is [`Source::Empty`]).
pub fn source_size(h: &dyn GitHost, cwd: &str, source: &Source) -> Result<Option<u64>, String> {
    Ok(source_stat(h, cwd, source)?.map(|s| s.size))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStat {
    pub size: u64,
    /// Changes when the content does: the blob id at a revision, size and modification time on disk.
    pub version: String,
}

/// Size and version of a source without reading it; None when it does not exist (or is [`Source::Empty`]).
pub fn source_stat(h: &dyn GitHost, cwd: &str, source: &Source) -> Result<Option<SourceStat>, String> {
    match source {
        Source::Empty => Ok(None),
        Source::Rev { rev, path } => {
            let object = format!("{rev}:{path}");
            let out = h.git(cwd, &args(&["rev-parse", "--verify", "--quiet", &object]), None)?;
            if out.code != 0 {
                return Ok(None);
            }
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let size = h.git(cwd, &args(&["cat-file", "-s", &version]), None)?;
            let size = (size.code == 0).then(|| String::from_utf8_lossy(&size.stdout).trim().parse().ok()).flatten();
            Ok(size.map(|size| SourceStat { size, version }))
        }
        Source::Worktree { path } => {
            let full = join(cwd, path);
            match h.read_file(&full, 0) {
                Ok(f) => {
                    let mtime = h.mtime(&full)?.unwrap_or(0);
                    Ok(Some(SourceStat { size: f.size, version: format!("{}-{mtime}", f.size) }))
                }
                Err(e) => match h.mtime(&full)? {
                    None => Ok(None),
                    Some(_) => Err(e),
                },
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<String>,
    /// Ignored files and folders (folders end in `/`), only when asked for.
    pub ignored: Vec<String>,
}

/// Files of the worktree (tracked + untracked, minus ignored), or of a branch tip when `rev` is given.
pub fn list_files(h: &dyn GitHost, cwd: &str, rev: Option<&str>, include_ignored: bool) -> Result<FileList, String> {
    if let Some(rev) = rev {
        let files = parse_path_list(&run(h, cwd, &["ls-tree", "-r", "-z", "--name-only", "--full-tree", rev])?);
        return Ok(FileList { files, ignored: vec![] });
    }
    let files = parse_path_list(&run(h, cwd, &["ls-files", "-co", "--exclude-standard", "-z"])?);
    let ignored = if include_ignored {
        parse_path_list(&run(h, cwd, &["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"])?)
    } else {
        vec![]
    };
    Ok(FileList { files, ignored })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepQuery {
    pub pattern: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub limit: usize,
}

pub fn grep(h: &dyn GitHost, cwd: &str, rev: Option<&str>, q: &GrepQuery) -> Result<GrepResult, String> {
    let mut a = vec!["grep", "-n", "-I", "--column", "-z", "--no-color", "--full-name"];
    a.push(if q.regex { "-E" } else { "-F" });
    if !q.case_sensitive {
        a.push("-i");
    }
    if rev.is_none() {
        a.push("--untracked");
    }
    a.extend(["-e", &q.pattern]);
    if let Some(r) = rev {
        a.push(r);
    }
    let out = h.git(cwd, &args(&a), None)?;
    // grep exits 1 when nothing matched.
    match out.code {
        0 => Ok(parse_grep(&out.stdout, rev, q.limit)),
        1 if out.stderr.trim().is_empty() => Ok(GrepResult::default()),
        _ => Err(out.stderr.trim().to_string()),
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStatus {
    pub branch: String,
    pub upstream: Option<String>,
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
    pub has_origin: bool,
    /// Unix seconds of the last fetch (FETCH_HEAD), if any.
    pub last_fetched: Option<i64>,
}

pub fn branch_status(h: &dyn GitHost, cwd: &str, branch: &str) -> Result<BranchStatus, String> {
    let refs = parse_refs(&run(h, cwd, &["for-each-ref", REF_FORMAT, &format!("refs/heads/{branch}")])?)?;
    let r = refs.into_iter().find(|r| r.name == branch);
    let remotes = run_text(h, cwd, &["remote"])?;
    let common = absolute(cwd, &run_text(h, cwd, &["rev-parse", "--git-common-dir"])?);
    Ok(BranchStatus {
        branch: branch.to_string(),
        upstream: r.as_ref().and_then(|r| r.upstream.clone()),
        upstream_gone: r.as_ref().is_some_and(|r| r.upstream_gone),
        ahead: r.as_ref().map_or(0, |r| r.ahead),
        behind: r.as_ref().map_or(0, |r| r.behind),
        has_origin: remotes.lines().any(|l| l.trim() == "origin"),
        last_fetched: h.mtime(&join(&common, "FETCH_HEAD"))?,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Fetch,
    Push,
    Publish,
}

/// The only commands in the app that change anything, and only on the remote.
pub fn run_action(h: &dyn GitHost, cwd: &str, action: Action, branch: &str, progress: Option<Progress>) -> Result<GitOutput, String> {
    let a = match action {
        Action::Fetch => args(&["fetch", "--progress", "origin"]),
        Action::Push => args(&["push", "--progress", "--porcelain"]),
        Action::Publish => args(&["push", "--progress", "--porcelain", "-u", "origin", branch]),
    };
    h.git(cwd, &a, progress)
}

/// Clones `url` into a new folder `name` inside `parent`. Nothing outside that folder is touched, and git removes it if the clone fails.
pub fn clone_repo(h: &dyn GitHost, parent: &str, url: &str, name: &str, progress: Option<Progress>) -> Result<(), String> {
    let out = h.git(parent, &args(&["clone", "--progress", "--", url, name]), progress)?;
    if out.code == 0 { Ok(()) } else { Err(out.stderr.trim().to_string()) }
}

/// How a fetch, push or publish ended, for the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub ok: bool,
    /// The remote refused a ref. A failure to reach it, or to log in, is not this.
    pub rejected: bool,
    /// What git said: progress when it worked, why when it did not.
    pub text: String,
}

/// Reads `run_action`'s output. `push --porcelain` marks each refused ref with a `!` flag on stdout
/// in every language; git prints no ref lines when it cannot reach the remote.
pub fn action_result(out: &GitOutput) -> ActionResult {
    let stderr = out.stderr.trim();
    if out.code == 0 {
        return ActionResult { ok: true, rejected: false, text: stderr.to_string() };
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let refused: Vec<String> = stdout.lines().filter_map(refused_ref).collect();
    let text = refused.iter().map(String::as_str).chain([stderr]).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n");
    ActionResult {
        ok: false,
        rejected: !refused.is_empty(),
        text: if text.is_empty() { format!("git exited with code {}", out.code) } else { text },
    }
}

/// A `push --porcelain` line `!\t<from>:<to>\t<why>`, as `! <branch> <why>`.
fn refused_ref(line: &str) -> Option<String> {
    let mut parts = line.strip_prefix("!\t")?.splitn(2, '\t');
    let refs = parts.next()?;
    let to = refs.rsplit(':').next()?;
    Some(format!("! {} {}", to.strip_prefix("refs/heads/").unwrap_or(to), parts.next().unwrap_or("").trim()))
}

/// What to watch for one worktree: its files, its git dirs, minus worktrees nested inside it.
pub fn watch_spec(h: &dyn GitHost, cwd: &str) -> Result<WatchSpec, String> {
    let out = run_text(h, cwd, &["rev-parse", "--show-toplevel", "--absolute-git-dir", "--git-common-dir"])?;
    let mut lines = out.lines();
    let (Some(root), Some(git_dir), Some(common)) = (lines.next(), lines.next(), lines.next()) else {
        return Err(format!("unexpected rev-parse output: {out}"));
    };
    let mut git_dirs = vec![git_dir.to_string()];
    let common = absolute(cwd, common);
    if !git_dirs.iter().any(|g| same_path(g, &common)) {
        git_dirs.push(common);
    }
    let prefix = format!("{}/", root.trim_end_matches('/'));
    let exclude = worktrees(h, cwd)?
        .into_iter()
        .map(|w| w.path)
        .filter(|p| p.starts_with(&prefix))
        .collect();
    Ok(WatchSpec { root: root.to_string(), git_dirs, exclude })
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b) || norm(&format!("{a}/.")) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(code: i32, stdout: &str, stderr: &str) -> GitOutput {
        GitOutput { code, stdout: stdout.as_bytes().to_vec(), stderr: stderr.to_string() }
    }

    #[test]
    fn a_refused_ref_is_a_rejection() {
        let out = output(1, "To example\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\nDone\n", "error: failed to push\n");
        assert_eq!(action_result(&out), ActionResult { ok: false, rejected: true, text: "! main [rejected] (fetch first)\nerror: failed to push".into() });
        let hook = output(1, "To example\n!\trefs/heads/a:refs/heads/a\t[remote rejected] (pre-receive hook declined)\nDone\n", "");
        assert!(action_result(&hook).rejected);
    }

    #[test]
    fn other_failures_are_not_rejections() {
        let out = output(128, "", "fatal: Could not read from remote repository.\n");
        assert_eq!(action_result(&out), ActionResult { ok: false, rejected: false, text: "fatal: Could not read from remote repository.".into() });
        assert_eq!(action_result(&output(1, "", "")).text, "git exited with code 1");
        assert_eq!(action_result(&output(0, "To example\n", "done\n")), ActionResult { ok: true, rejected: false, text: "done".into() });
    }

    #[test]
    fn decode_detects_binary_and_strips_bom() {
        assert_eq!(decode(b"a\0b"), Content::Binary { size: 3 });
        assert_eq!(decode(b"\xEF\xBB\xBFx"), Content::Text { text: "x".into() });
        assert_eq!(decode("ü\r\n".as_bytes()), Content::Text { text: "ü\r\n".into() });
    }

    #[test]
    fn iso_dates_with_offsets() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), 0);
        assert_eq!(iso_to_unix("2026-01-02T03:04:05+01:00"), 1767319445);
        assert_eq!(iso_to_unix("2026-01-02T02:04:05+00:00"), iso_to_unix("2026-01-01T21:04:05-05:00"));
        assert_eq!(iso_to_unix("2024-02-29T12:00:00+00:00"), 1709208000);
        assert_eq!(iso_to_unix("garbage"), 0);
    }

    #[test]
    fn absolute_paths() {
        assert!(is_absolute("/a") && is_absolute("D:/a") && is_absolute(r"C:\a") && !is_absolute(".git"));
        assert_eq!(absolute("/r", ".git"), "/r/.git");
    }
}
