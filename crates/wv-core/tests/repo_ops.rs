//! Repository operations the UI calls, run against real git through LocalHost.

mod common;

use common::{git, temp_repo, TempRepo};
use std::sync::Mutex;
use wv_core::host::{DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec, WriteOutcome};
use wv_core::local::LocalHost;
use wv_core::overview::{self, Overview};
use wv_core::porcelain::ChangeKind;
use wv_core::repo_ops::{self as ops, Action, Content, GrepQuery, Source};

fn h() -> LocalHost {
    LocalHost::new()
}

#[test]
fn cloning_refuses_local_sources_and_an_occupied_folder_without_touching_it() {
    let r = temp_repo();
    let parent = r.dir.path().to_str().unwrap().to_string();
    // Addresses are limited to the network ones, so this never reaches git.
    let refused = ops::clone_repo(&h(), &parent, "file:///tmp/example", "copy", None).unwrap_err();
    assert!(refused.contains("can be cloned"), "{refused}");
    assert!(!r.dir.path().join("copy").exists());

    let taken = r.dir.path().join("taken");
    std::fs::create_dir(&taken).unwrap();
    std::fs::write(taken.join("keep.txt"), "mine").unwrap();
    // Port 9 is never listening, and git refuses the folder before it connects.
    let refused = ops::clone_repo(&h(), &parent, "https://127.0.0.1:9/example.git", "taken", None).unwrap_err();
    assert!(refused.contains("already exists"), "{refused}");
    assert_eq!(std::fs::read_to_string(taken.join("keep.txt")).unwrap(), "mine");
}

/// A LocalHost that remembers the git commands it ran.
struct RecordingHost {
    inner: LocalHost,
    commands: Mutex<Vec<Vec<String>>>,
}

impl RecordingHost {
    fn new() -> Self {
        Self { inner: h(), commands: Mutex::default() }
    }

    fn ran(&self, subcommand: &str) -> bool {
        self.commands.lock().unwrap().iter().any(|c| c.iter().any(|a| a == subcommand))
    }
}

impl GitHost for RecordingHost {
    fn git(&self, cwd: &str, args: &[String], progress: Option<Progress>) -> Result<GitOutput, String> {
        self.commands.lock().unwrap().push(args.to_vec());
        self.inner.git(cwd, args, progress)
    }
    fn read_file(&self, path: &str, max: u64) -> Result<FileRead, String> {
        self.inner.read_file(path, max)
    }
    fn check_writable(&self, root: &str, rel: &str) -> Result<(), String> {
        self.inner.check_writable(root, rel)
    }
    fn write_file(&self, root: &str, rel: &str, data: &[u8], expected: &[u8]) -> Result<WriteOutcome, String> {
        self.inner.write_file(root, rel, data, expected)
    }
    fn list_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        self.inner.list_dir(path)
    }
    fn mtime(&self, path: &str) -> Result<Option<i64>, String> {
        self.inner.mtime(path)
    }
    fn watch(&self, spec: WatchSpec, on_change: OnChange) -> Result<u64, String> {
        self.inner.watch(spec, on_change)
    }
    fn unwatch(&self, id: u64) {
        self.inner.unwatch(id)
    }
    fn overview(&self, cwds: &[String], base: Option<&str>, find_overlaps: bool) -> Result<Overview, String> {
        Ok(overview::overview(self, cwds, base, find_overlaps))
    }
}

/// main: a.txt; feature (from main): edits a.txt, adds f.txt, renames nothing; main moves on with m.txt.
fn branched_repo() -> TempRepo {
    let r = temp_repo();
    git(&r.path, &["checkout", "-q", "-b", "feature"]);
    std::fs::write(r.path.join("a.txt"), "one\nTWO\n").unwrap();
    std::fs::write(r.path.join("f.txt"), "feature\n").unwrap();
    git(&r.path, &["add", "."]);
    git(&r.path, &["commit", "-q", "-m", "feature work"]);
    git(&r.path, &["checkout", "-q", "main"]);
    std::fs::write(r.path.join("m.txt"), "main\n").unwrap();
    git(&r.path, &["add", "."]);
    git(&r.path, &["commit", "-q", "-m", "main work"]);
    r
}

#[test]
fn base_defaults_to_development_then_main_then_master() {
    let r = temp_repo();
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("main"));
    git(&r.path, &["branch", "development"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("development"));
    assert_eq!(ops::resolve_base(&h(), r.path_str(), Some("main")).unwrap().as_deref(), Some("main"));
    // A preferred base that no longer exists falls back to the defaults.
    assert_eq!(ops::resolve_base(&h(), r.path_str(), Some("gone")).unwrap().as_deref(), Some("development"));
}

#[test]
fn base_can_come_from_the_remote_when_there_is_no_local_branch() {
    let r = temp_repo();
    git(&r.path, &["branch", "-m", "main", "trunk"]);
    git(&r.path, &["update-ref", "refs/remotes/origin/master", "HEAD"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("origin/master"));
}

#[test]
fn base_falls_back_to_the_remotes_default_branch() {
    let r = temp_repo();
    git(&r.path, &["branch", "-m", "main", "feature"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap(), None, "no known name and no origin/HEAD");

    // As `git clone` leaves it: origin/HEAD points at the remote's default branch.
    git(&r.path, &["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
    git(&r.path, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("origin/trunk"));
    git(&r.path, &["branch", "trunk"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("trunk"), "a local branch of that name comes first");

    // The known names still win, so repositories keep the base they had.
    git(&r.path, &["branch", "main"]);
    assert_eq!(ops::resolve_base(&h(), r.path_str(), None).unwrap().as_deref(), Some("main"));
}

#[test]
fn branch_vs_base_lists_only_what_the_branch_changed() {
    let r = branched_repo();
    let d = ops::branch_changes(&h(), r.path_str(), "main", "feature").unwrap();
    let mut files: Vec<_> = d.files.iter().map(|f| (f.path.as_str(), f.kind)).collect();
    files.sort();
    assert_eq!(files, vec![("a.txt", ChangeKind::Modified), ("f.txt", ChangeKind::Added)]);
    assert_eq!(d.merge_base, git(&r.path, &["rev-parse", "main~1"]).trim());
}

#[test]
fn log_pages_and_commit_detail_lists_files_against_first_parent() {
    let r = branched_repo();
    let page1 = ops::log(&h(), r.path_str(), "feature", 0, 1).unwrap();
    let page2 = ops::log(&h(), r.path_str(), "feature", 1, 1).unwrap();
    assert_eq!(page1[0].subject, "feature work");
    assert_eq!(page2[0].subject, "first");

    let c = ops::commit(&h(), r.path_str(), &page1[0].sha).unwrap();
    assert_eq!(c.detail.message, "feature work");
    assert_eq!(c.files.len(), 2);

    // The root commit lists its files as added.
    let root = ops::commit(&h(), r.path_str(), &page2[0].sha).unwrap();
    assert_eq!(root.files.iter().map(|f| (f.path.as_str(), f.kind)).collect::<Vec<_>>(), vec![("a.txt", ChangeKind::Added)]);
}

#[test]
fn merge_commits_diff_against_their_first_parent() {
    let r = branched_repo();
    git(&r.path, &["merge", "-q", "--no-ff", "--no-edit", "feature"]);
    let sha = git(&r.path, &["rev-parse", "HEAD"]).trim().to_string();
    let c = ops::commit(&h(), r.path_str(), &sha).unwrap();
    let mut paths: Vec<_> = c.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort();
    assert_eq!(paths, vec!["a.txt", "f.txt"]);
}

#[test]
fn sources_read_from_revisions_worktree_and_handle_missing_binary_and_large() {
    let r = temp_repo();
    std::fs::write(r.path.join("a.txt"), "one\nchanged\n").unwrap();
    std::fs::write(r.path.join("bin.dat"), [0u8, 1, 2, 3]).unwrap();
    std::fs::write(r.path.join("bom.txt"), "\u{feff}hi\n").unwrap();
    let host = h();
    let read = |s: Source| ops::read_source(&host, r.path_str(), &s).unwrap();

    assert_eq!(read(Source::Rev { rev: "HEAD".into(), path: "a.txt".into() }), Content::Text { text: "one\ntwo\n".into() });
    assert_eq!(read(Source::Worktree { path: "a.txt".into() }), Content::Text { text: "one\nchanged\n".into() });
    assert_eq!(read(Source::Rev { rev: "HEAD".into(), path: "nope.txt".into() }), Content::Missing);
    assert_eq!(read(Source::Worktree { path: "nope.txt".into() }), Content::Missing);
    assert_eq!(read(Source::Empty), Content::Text { text: String::new() });
    assert_eq!(read(Source::Worktree { path: "bin.dat".into() }), Content::Binary { size: 4 });
    assert_eq!(read(Source::Worktree { path: "bom.txt".into() }), Content::Text { text: "hi\n".into() });

    let big = "x".repeat(ops::MAX_FILE_BYTES as usize + 1);
    std::fs::write(r.path.join("big.txt"), &big).unwrap();
    git(&r.path, &["add", "big.txt"]);
    git(&r.path, &["commit", "-q", "-m", "big"]);
    let size = big.len() as u64;
    assert_eq!(read(Source::Worktree { path: "big.txt".into() }), Content::TooLarge { size });
    assert_eq!(read(Source::Rev { rev: "HEAD".into(), path: "big.txt".into() }), Content::TooLarge { size });
}

#[test]
fn file_lists_hide_ignored_unless_asked_and_work_on_branch_tips() {
    let r = branched_repo();
    std::fs::write(r.path.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
    std::fs::create_dir_all(r.path.join("node_modules/pkg")).unwrap();
    std::fs::write(r.path.join("node_modules/pkg/i.js"), "x").unwrap();
    std::fs::write(r.path.join("debug.log"), "x").unwrap();
    std::fs::write(r.path.join("new.txt"), "x").unwrap();

    let l = ops::list_files(&h(), r.path_str(), None, false).unwrap();
    assert_eq!(l.files, vec![".gitignore", "a.txt", "m.txt", "new.txt"]);
    assert!(l.ignored.is_empty());

    let l = ops::list_files(&h(), r.path_str(), None, true).unwrap();
    assert_eq!(l.ignored, vec!["debug.log", "node_modules/"]);

    let tip = ops::list_files(&h(), r.path_str(), Some("feature"), false).unwrap();
    assert_eq!(tip.files, vec!["a.txt", "f.txt"]);
}

#[test]
fn grep_worktree_and_branch_tip() {
    let r = branched_repo();
    std::fs::write(r.path.join("untracked.txt"), "needle here\n").unwrap();
    let q = GrepQuery { pattern: "NEEDLE".into(), regex: false, case_sensitive: false, limit: 100 };
    let hits = ops::grep(&h(), r.path_str(), None, &q).unwrap();
    assert_eq!(hits.hits.len(), 1);
    assert_eq!(hits.hits[0].path, "untracked.txt");

    let q = GrepQuery { pattern: "feat.re".into(), regex: true, case_sensitive: true, limit: 100 };
    let hits = ops::grep(&h(), r.path_str(), Some("feature"), &q).unwrap();
    assert_eq!(hits.hits[0].path, "f.txt");

    // No matches is not an error.
    let q = GrepQuery { pattern: "zzz-not-there".into(), regex: false, case_sensitive: true, limit: 100 };
    assert!(ops::grep(&h(), r.path_str(), None, &q).unwrap().hits.is_empty());
}

#[test]
fn branch_status_tracks_upstream_and_last_fetch() {
    let r = temp_repo();
    let bare = r.dir.path().join("remote.git");
    git(r.dir.path(), &["init", "-q", "--bare", bare.to_str().unwrap()]);
    let s = ops::branch_status(&h(), r.path_str(), "main").unwrap();
    assert_eq!((s.upstream.clone(), s.has_origin), (None, false));

    git(&r.path, &["remote", "add", "origin", bare.to_str().unwrap()]);
    let out = ops::run_action(&h(), r.path_str(), Action::Publish, "main", None).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    let s = ops::branch_status(&h(), r.path_str(), "main").unwrap();
    assert_eq!(s.upstream.as_deref(), Some("origin/main"));
    assert!(s.has_origin);

    git(&r.path, &["commit", "-q", "--allow-empty", "-m", "two"]);
    let s = ops::branch_status(&h(), r.path_str(), "main").unwrap();
    assert_eq!((s.ahead, s.behind), (1, 0));
    assert_eq!(ops::run_action(&h(), r.path_str(), Action::Push, "main", None).unwrap().code, 0);

    assert_eq!(s.last_fetched, None);
    assert_eq!(ops::run_action(&h(), r.path_str(), Action::Fetch, "main", None).unwrap().code, 0);
    assert!(ops::branch_status(&h(), r.path_str(), "main").unwrap().last_fetched.is_some());
}

#[test]
fn watch_spec_includes_git_dirs_and_excludes_nested_worktrees() {
    let r = temp_repo();
    let nested = r.path.join(".claude/worktrees/wt1");
    git(&r.path, &["worktree", "add", "-q", nested.to_str().unwrap(), "-b", "wt1"]);
    let spec = ops::watch_spec(&h(), r.path_str()).unwrap();
    assert!(spec.root.ends_with("/repo"), "{}", spec.root);
    assert!(spec.git_dirs.iter().any(|g| g.ends_with(".git")));
    assert!(spec.exclude.iter().any(|e| e.ends_with(".claude/worktrees/wt1")), "{:?}", spec.exclude);

    let inner = ops::watch_spec(&h(), nested.to_str().unwrap()).unwrap();
    assert!(inner.git_dirs.iter().any(|g| g.contains(".git/worktrees/wt1")), "{:?}", inner.git_dirs);
    assert!(inner.exclude.is_empty());
}

#[test]
fn raw_bytes_for_markdown_images() {
    let r = temp_repo();
    let png = [0x89u8, b'P', b'N', b'G', 0, 1, 2];
    std::fs::write(r.path.join("img.png"), png).unwrap();
    git(&r.path, &["add", "img.png"]);
    git(&r.path, &["commit", "-q", "-m", "img"]);
    let host = h();
    let wt = Source::Worktree { path: "img.png".into() };
    let rev = Source::Rev { rev: "HEAD".into(), path: "img.png".into() };
    assert_eq!(ops::read_bytes(&host, r.path_str(), &wt).unwrap().as_deref(), Some(&png[..]));
    assert_eq!(ops::read_bytes(&host, r.path_str(), &rev).unwrap().as_deref(), Some(&png[..]));
    assert_eq!(ops::read_bytes(&host, r.path_str(), &Source::Worktree { path: "nope.png".into() }).unwrap(), None);
    assert_eq!(ops::read_bytes(&host, r.path_str(), &Source::Empty).unwrap(), None);
}

#[test]
fn image_sources_report_size_missing_and_too_large() {
    let r = temp_repo();
    let png = vec![7u8; 3000];
    std::fs::write(r.path.join("big.png"), &png).unwrap();
    git(&r.path, &["add", "big.png"]);
    git(&r.path, &["commit", "-q", "-m", "img"]);
    let host = h();
    let wt = Source::Worktree { path: "big.png".into() };
    let rev = Source::Rev { rev: "HEAD".into(), path: "big.png".into() };
    let gone = Source::Rev { rev: "HEAD".into(), path: "nope.png".into() };
    assert_eq!(ops::source_size(&host, r.path_str(), &wt).unwrap(), Some(3000));
    assert_eq!(ops::source_size(&host, r.path_str(), &rev).unwrap(), Some(3000));
    assert_eq!(ops::source_size(&host, r.path_str(), &gone).unwrap(), None);
    assert_eq!(ops::source_size(&host, r.path_str(), &Source::Worktree { path: "nope.png".into() }).unwrap(), None);
    assert_eq!(ops::source_size(&host, r.path_str(), &Source::Empty).unwrap(), None);

    // Images have their own, larger limit than text; above it nothing is read.
    assert!(ops::MAX_IMAGE_BYTES > ops::MAX_FILE_BYTES);
    assert_eq!(ops::read_bytes_max(&host, r.path_str(), &rev, 3000).unwrap().map(|b| b.len()), Some(3000));
    assert_eq!(ops::read_bytes_max(&host, r.path_str(), &rev, 2999).unwrap(), None);
    assert_eq!(ops::read_bytes_max(&host, r.path_str(), &wt, 2999).unwrap(), None);
    assert_eq!(ops::read_bytes_max(&host, r.path_str(), &gone, 9999).unwrap(), None);
}

#[test]
fn image_versions_change_only_when_the_file_does() {
    let r = temp_repo();
    std::fs::write(r.path.join("p.png"), [1u8; 64]).unwrap();
    git(&r.path, &["add", "p.png"]);
    git(&r.path, &["commit", "-q", "-m", "one"]);
    let host = h();
    let wt = Source::Worktree { path: "p.png".into() };
    let head = Source::Rev { rev: "HEAD".into(), path: "p.png".into() };
    let stat = |s: &Source| ops::source_stat(&host, r.path_str(), s).unwrap().unwrap();
    let (w1, h1) = (stat(&wt), stat(&head));
    assert_eq!((w1.size, h1.size), (64, 64));
    assert_eq!(stat(&wt), w1);
    assert_eq!(stat(&head), h1);

    // Same size, new content: a new version on disk, and at HEAD once committed.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    std::fs::write(r.path.join("p.png"), [2u8; 64]).unwrap();
    assert_ne!(stat(&wt).version, w1.version);
    assert_eq!(stat(&head), h1);
    git(&r.path, &["commit", "-q", "-am", "two"]);
    assert_ne!(stat(&head).version, h1.version);
    assert_eq!(ops::source_stat(&host, r.path_str(), &Source::Rev { rev: "HEAD".into(), path: "nope.png".into() }).unwrap(), None);
}

/// main: a.txt "first", "edit", then moved to `s/b c.txt` ("move it"), then an unrelated "other".
/// Commits by "Ana Author <ana@example.com>" except "edit", by T.
fn renamed_repo() -> TempRepo {
    let r = temp_repo();
    let ana = ["-c", "user.name=Ana Author", "-c", "user.email=ana@example.com"];
    std::fs::write(r.path.join("a.txt"), "one\nTWO\nthree\n").unwrap();
    git(&r.path, &["commit", "-q", "-am", "edit: Fix [bug] a.b"]);
    std::fs::create_dir(r.path.join("s")).unwrap();
    git(&r.path, &["mv", "a.txt", "s/b c.txt"]);
    git(&r.path, &[&ana[..], &["commit", "-q", "-m", "move it"]].concat());
    std::fs::write(r.path.join("o.txt"), "x\n").unwrap();
    git(&r.path, &["add", "o.txt"]);
    git(&r.path, &[&ana[..], &["commit", "-q", "-m", "other\n\nBody mentions --output=x"]].concat());
    r
}

#[test]
fn file_history_follows_renames_and_pages() {
    let r = renamed_repo();
    let l = ops::file_history(&h(), r.path_str(), "HEAD", "s/b c.txt", 0, 50).unwrap();
    let got: Vec<_> = l.iter().map(|f| (f.commit.subject.as_str(), f.file.path.as_str(), f.file.kind)).collect();
    assert_eq!(
        got,
        vec![
            ("move it", "s/b c.txt", ChangeKind::Renamed),
            ("edit: Fix [bug] a.b", "a.txt", ChangeKind::Modified),
            ("first", "a.txt", ChangeKind::Added),
        ]
    );
    assert_eq!(l[0].file.orig_path.as_deref(), Some("a.txt"));
    // Each entry knows what to diff against: the first parent, or the empty tree for the root commit.
    assert_eq!(l[0].parent, l[1].commit.sha);
    assert_eq!(l[2].parent, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");

    let page2 = ops::file_history(&h(), r.path_str(), "HEAD", "s/b c.txt", 1, 1).unwrap();
    assert_eq!(page2.iter().map(|f| f.commit.subject.as_str()).collect::<Vec<_>>(), vec!["edit: Fix [bug] a.b"]);
    // From an older revision the file has its old name.
    let old = ops::file_history(&h(), r.path_str(), &l[1].commit.sha, "a.txt", 0, 50).unwrap();
    assert_eq!(old.len(), 2);
    assert!(ops::file_history(&h(), r.path_str(), "HEAD", "never.txt", 0, 50).unwrap().is_empty());
}

#[test]
fn blame_worktree_and_revision() {
    let r = renamed_repo();
    std::fs::write(r.path.join("s/b c.txt"), "one\nTWO\nthree\nnew\n").unwrap();
    let wt = ops::blame(&h(), r.path_str(), &Source::Worktree { path: "s/b c.txt".into() }).unwrap();
    let spans: Vec<_> = wt.hunks.iter().map(|x| (wt.commits[&x.sha].summary.as_str(), x.start, x.count)).collect();
    assert_eq!(spans[0], ("first", 1, 1));
    assert_eq!(spans[1], ("edit: Fix [bug] a.b", 2, 2));
    assert_eq!((spans[2].1, spans[2].2), (4, 1));
    assert!(wt.commits[&wt.hunks[2].sha].uncommitted);
    assert_eq!(wt.commits[&wt.hunks[0].sha].author_name, "T");

    let first = git(&r.path, &["rev-list", "--max-parents=0", "HEAD"]).trim().to_string();
    let rev = ops::blame(&h(), r.path_str(), &Source::Rev { rev: first.clone(), path: "a.txt".into() }).unwrap();
    assert_eq!(rev.hunks.len(), 1);
    assert_eq!(rev.hunks[0].sha, first);
    assert_eq!(rev.hunks[0].count, 2);

    assert!(ops::blame(&h(), r.path_str(), &Source::Worktree { path: "untracked.txt".into() }).is_err());
    assert!(ops::blame(&h(), r.path_str(), &Source::Empty).is_err());
}

fn subjects(r: &ops::HistorySearch) -> Vec<&str> {
    r.commits.iter().map(|c| c.subject.as_str()).collect()
}

#[test]
fn history_search_matches_message_author_and_sha_across_all_history() {
    let r = renamed_repo();
    let s = |q: &str| ops::search_log(&h(), r.path_str(), "HEAD", q, 100).unwrap();
    // Message, case-insensitive, including the body; newest first.
    assert_eq!(subjects(&s("MOVE")), vec!["move it"]);
    assert_eq!(subjects(&s("body mentions")), vec!["other"]);
    // Author name or email.
    assert_eq!(subjects(&s("ana author")), vec!["other", "move it"]);
    assert_eq!(subjects(&s("ana@example")), vec!["other", "move it"]);
    // Message and author matches together, each commit once.
    assert_eq!(subjects(&s("t")), vec!["other", "move it", "edit: Fix [bug] a.b", "first"]);
    // A SHA prefix of any commit in the history.
    let first = git(&r.path, &["rev-list", "--max-parents=0", "HEAD"]).trim().to_string();
    assert_eq!(subjects(&s(&first[..7])), vec!["first"]);
    assert_eq!(subjects(&s(&first.to_uppercase())), vec!["first"]);
    // Plain text, not a regex or an option.
    assert_eq!(subjects(&s("[bug] a.b")), vec!["edit: Fix [bug] a.b"]);
    assert!(s("a.c").commits.is_empty());
    assert_eq!(subjects(&s("--output=x")), vec!["other"]);
    assert!(s("  ").commits.is_empty());
    assert!(s("nothing like this").commits.is_empty());
}

#[test]
fn history_search_stays_on_the_revision_and_reports_truncation() {
    let r = renamed_repo();
    let main = git(&r.path, &["rev-parse", "HEAD"]).trim().to_string();
    git(&r.path, &["checkout", "-q", "-b", "side", "HEAD~2"]);
    std::fs::write(r.path.join("side.txt"), "s\n").unwrap();
    git(&r.path, &["add", "side.txt"]);
    git(&r.path, &["commit", "-q", "-m", "side only"]);
    let side = git(&r.path, &["rev-parse", "HEAD"]).trim().to_string();
    // Commits of other branches are not part of this history, by message or by SHA.
    assert!(ops::search_log(&h(), r.path_str(), "main", "side only", 100).unwrap().commits.is_empty());
    assert!(ops::search_log(&h(), r.path_str(), "main", &side[..10], 100).unwrap().commits.is_empty());
    assert_eq!(subjects(&ops::search_log(&h(), r.path_str(), "side", &side[..10], 100).unwrap()), vec!["side only"]);
    assert_eq!(subjects(&ops::search_log(&h(), r.path_str(), "side", &main[..10], 100).unwrap()), Vec::<&str>::new());

    let t = ops::search_log(&h(), r.path_str(), "main", "t", 2).unwrap();
    assert_eq!(t.commits.len(), 2);
    assert!(t.truncated);
    assert!(!ops::search_log(&h(), r.path_str(), "main", "move", 2).unwrap().truncated);
}

#[test]
fn summary_counts_what_the_changes_list_shows() {
    let r = temp_repo();
    assert!(overview::summary(&h(), r.path_str(), None, true).unwrap().uncommitted.is_empty());
    std::fs::write(r.path.join("a.txt"), "edited\n").unwrap();
    std::fs::write(r.path.join("staged.txt"), "s\n").unwrap();
    git(&r.path, &["add", "staged.txt"]);
    std::fs::create_dir(r.path.join("new")).unwrap();
    std::fs::write(r.path.join("new/u1.txt"), "u\n").unwrap();
    std::fs::write(r.path.join("new/u2.txt"), "u\n").unwrap();
    // Ignored files are not changes.
    std::fs::write(r.path.join(".git/info/exclude"), "*.log\n").unwrap();
    std::fs::write(r.path.join("x.log"), "l\n").unwrap();
    let s = overview::summary(&h(), r.path_str(), None, true).unwrap();
    let paths: Vec<_> = s.uncommitted.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths.len(), 4, "{paths:?}");
    assert_eq!(s.branch.as_deref(), Some("main"));
    assert_eq!(s.last_commit.unwrap().subject, "first");
    assert!(s.committed.is_empty());
}

#[test]
fn summary_compares_with_the_base_and_the_upstream() {
    let r = branched_repo();
    let wt = r.dir.path().join("feature-wt");
    git(&r.path, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature"]);
    let s = overview::summary(&h(), wt.to_str().unwrap(), Some("main"), true).unwrap();
    assert_eq!(s.branch.as_deref(), Some("feature"));
    assert_eq!(s.committed, vec!["a.txt", "f.txt"]);
    assert_eq!((s.base_ahead, s.base_behind), (1, 1));
    assert_eq!(s.last_commit.unwrap().subject, "feature work");

    git(&wt, &["branch", "-q", "--set-upstream-to=main"]);
    let s = overview::summary(&h(), wt.to_str().unwrap(), None, true).unwrap();
    assert_eq!(s.upstream.as_deref(), Some("main"));
    assert_eq!((s.upstream_ahead, s.upstream_behind), (1, 1));
    assert!(s.committed.is_empty(), "no base, nothing compared");

    assert!(overview::summary(&h(), r.dir.path().join("gone").to_str().unwrap(), None, true).is_err());
}

#[test]
fn summary_counts_only_uncommitted_files_and_lines() {
    let r = branched_repo();
    let wt = r.dir.path().join("feature-wt");
    git(&r.path, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature"]);
    let cwd = wt.to_str().unwrap();
    let s = overview::summary(&h(), cwd, Some("main"), false).unwrap();
    assert!(s.base_ahead > 0, "the branch has commits the base lacks");
    assert_eq!((s.changed_files, s.lines_added, s.lines_removed), (0, 0, 0), "commits do not count");

    // The untracked file adds a file but no lines.
    std::fs::write(wt.join("a.txt"), "one\nTWO\nthree\n").unwrap();
    std::fs::write(wt.join("untracked.txt"), "one\ntwo\n").unwrap();
    let s = overview::summary(&h(), cwd, Some("main"), false).unwrap();
    assert_eq!((s.changed_files, s.lines_added, s.lines_removed), (2, 1, 0));

    // The base changes nothing here.
    let without = overview::summary(&h(), cwd, None, false).unwrap();
    assert_eq!((without.changed_files, without.lines_added, without.lines_removed), (2, 1, 0));
}

#[test]
fn summary_of_a_repository_without_commits_counts_its_files() {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q"]);
    std::fs::write(dir.path().join("a.txt"), "a\n").unwrap();
    let s = overview::summary(&h(), dir.path().to_str().unwrap(), Some("main"), false).unwrap();
    assert_eq!((s.changed_files, s.lines_added), (1, 0));
}

#[test]
fn a_push_the_remote_refuses_is_rejected_and_an_unreachable_remote_is_not() {
    let r = temp_repo();
    let bare = r.dir.path().join("remote.git");
    git(r.dir.path(), &["init", "-q", "--bare", bare.to_str().unwrap()]);
    git(&r.path, &["remote", "add", "origin", bare.to_str().unwrap()]);
    let lines = Mutex::new(vec![]);
    let progress = |l: &str| lines.lock().unwrap().push(l.to_string());
    let published = ops::action_result(&ops::run_action(&h(), r.path_str(), Action::Publish, "main", Some(&progress)).unwrap());
    assert!(published.ok && !published.rejected, "{published:?}");
    assert!(!lines.lock().unwrap().is_empty(), "progress still arrives with --porcelain");

    // Another clone moves the branch on, so this one's next push is refused.
    let other = r.dir.path().join("other");
    git(r.dir.path(), &["clone", "-q", "-b", "main", bare.to_str().unwrap(), other.to_str().unwrap()]);
    git(&other, &["-c", "user.name=Dev Example", "-c", "user.email=dev@example.com", "commit", "-q", "--allow-empty", "-m", "theirs"]);
    git(&other, &["push", "-q", "origin", "HEAD:main"]);
    git(&r.path, &["commit", "-q", "--allow-empty", "-m", "ours"]);
    let refused = ops::action_result(&ops::run_action(&h(), r.path_str(), Action::Push, "main", None).unwrap());
    assert!(!refused.ok && refused.rejected, "{refused:?}");
    assert!(refused.text.starts_with("! main "), "{}", refused.text);

    git(&r.path, &["remote", "set-url", "origin", r.dir.path().join("gone.git").to_str().unwrap()]);
    let unreachable = ops::action_result(&ops::run_action(&h(), r.path_str(), Action::Push, "main", None).unwrap());
    assert!(!unreachable.ok && !unreachable.rejected, "{unreachable:?}");
}

#[test]
fn overview_finds_files_two_worktrees_both_change() {
    let r = temp_repo();
    let add = |name: &str, from: &str| {
        let p = r.dir.path().join(name);
        git(&r.path, &["worktree", "add", "-q", "-b", name, p.to_str().unwrap(), from]);
        p
    };
    let commit = |wt: &std::path::Path, file: &str, text: &str| {
        std::fs::write(wt.join(file), text).unwrap();
        git(wt, &["add", "."]);
        git(wt, &["commit", "-q", "-m", file]);
    };
    let a = add("agent-a", "main");
    commit(&a, "a.txt", "from a\n");
    let b = add("agent-b", "main");
    commit(&b, "a.txt", "from b\n");
    // Stacked on agent-a: a fast-forward of it, so their shared a.txt cannot conflict.
    let c = add("agent-c", "agent-a");
    commit(&c, "c.txt", "c\n");
    // Uncommitted work in the main worktree touches the file agent-c added.
    std::fs::write(r.path.join("c.txt"), "main\n").unwrap();

    let cwds: Vec<String> = [&r.path, &a, &b, &c, &r.dir.path().join("gone")].iter().map(|p| p.to_str().unwrap().to_string()).collect();
    let o = overview::overview(&h(), &cwds, Some("main"), true);
    assert_eq!(o.worktrees.len(), 4);
    assert!(o.errors.contains_key(&cwds[4]));
    let name = |p: &str| std::path::Path::new(p).file_name().unwrap().to_str().unwrap().to_string();
    let pairs: Vec<_> = o.overlaps.iter().map(|x| format!("{} {} {}", name(&x.a), name(&x.b), x.files.join(","))).collect();
    assert_eq!(pairs, ["repo agent-c c.txt", "agent-a agent-b a.txt", "agent-b agent-c a.txt"]);
}

#[test]
fn overview_runs_no_overlap_commands_unless_asked() {
    let r = branched_repo();
    let wt = r.dir.path().join("feature-wt");
    git(&r.path, &["worktree", "add", "-q", wt.to_str().unwrap(), "feature"]);
    std::fs::write(r.path.join("f.txt"), "uncommitted\n").unwrap();
    let cwds = [r.path_str().to_string(), wt.to_str().unwrap().to_string()];

    let off = RecordingHost::new();
    let o = off.overview(&cwds, Some("main"), false).unwrap();
    assert!(o.overlaps.is_empty());
    assert!(!off.ran("--name-only"));
    assert!(o.worktrees.iter().all(|w| w.committed.is_empty()));
    assert_eq!((o.worktrees[1].base_ahead, o.worktrees[1].base_behind), (1, 1), "the cards keep their numbers");

    let on = RecordingHost::new();
    let o = on.overview(&cwds, Some("main"), true).unwrap();
    assert_eq!(o.overlaps[0].files, ["f.txt"]);
    assert!(on.ran("--name-only"));
}

#[test]
fn file_access_follows_the_patterns_and_reports_tracking() {
    let r = temp_repo();
    std::fs::write(r.path.join(".env"), "A=1\n").unwrap();
    std::fs::write(r.path.join(".env.example"), "A=\n").unwrap();
    std::fs::write(r.path.join("bin.env"), b"\0\x01").unwrap();
    git(&r.path, &["add", ".env.example"]);
    git(&r.path, &["commit", "-q", "-m", "example"]);
    let rules = wv_core::editable::Rules::new(vec![".env*".into(), "*.env".into()]);
    let access = |p: &str| ops::file_access(&h(), r.path_str(), p, &rules).unwrap();
    assert_eq!(access(".env"), ops::FileAccess { editable: true, reason: None, tracked: false });
    assert_eq!(access(".env.example"), ops::FileAccess { editable: true, reason: None, tracked: true });
    // Tracking is only asked for files that can be edited: a.txt is tracked, but read-only.
    assert_eq!(access("a.txt"), ops::FileAccess { editable: false, reason: None, tracked: false });
    let binary = access("bin.env");
    assert!(!binary.editable && binary.reason.as_deref().is_some_and(|r| r.contains("UTF-8")), "{binary:?}");
    // Saving would rewrite every line ending of a file that mixes them.
    std::fs::write(r.path.join("mixed.env"), "A=1\r\nB=2\n").unwrap();
    let mixed = access("mixed.env");
    assert!(!mixed.editable && mixed.reason.as_deref().is_some_and(|r| r.contains("line endings")), "{mixed:?}");
    // `[d].env` is a name, not a pattern matching the tracked `d.env`.
    std::fs::write(r.path.join("d.env"), "A=1\n").unwrap();
    std::fs::write(r.path.join("[d].env"), "A=1\n").unwrap();
    git(&r.path, &["add", "d.env"]);
    git(&r.path, &["commit", "-q", "-m", "d"]);
    assert_eq!(access("[d].env"), ops::FileAccess { editable: true, reason: None, tracked: false });
    assert!(access("d.env").tracked);
}

#[test]
fn save_file_writes_allowed_files_and_detects_changes_on_disk() {
    let r = temp_repo();
    std::fs::write(r.path.join(".env"), b"\xEF\xBB\xBFA=1\r\n").unwrap();
    let rules = wv_core::editable::Rules::default();
    let save = |base: Option<&str>, text: &str| ops::save_file(&h(), r.path_str(), ".env", base, text, &rules);
    assert_eq!(save(Some("A=1\r\n"), "A=2\r\n").unwrap(), WriteOutcome::Written);
    // The BOM the file had stays.
    assert_eq!(std::fs::read(r.path.join(".env")).unwrap(), b"\xEF\xBB\xBFA=2\r\n");
    // The editor started from older text: nothing is written.
    assert_eq!(save(Some("A=1\r\n"), "A=3\r\n").unwrap(), WriteOutcome::ChangedOnDisk);
    assert_eq!(std::fs::read(r.path.join(".env")).unwrap(), b"\xEF\xBB\xBFA=2\r\n");
    // Without a base it overwrites.
    assert_eq!(save(None, "A=4\n").unwrap(), WriteOutcome::Written);
    assert_eq!(std::fs::read(r.path.join(".env")).unwrap(), b"\xEF\xBB\xBFA=4\n");
}

#[test]
fn save_file_refuses_what_the_patterns_do_not_name() {
    let r = temp_repo();
    let rules = wv_core::editable::Rules::default();
    let err = ops::save_file(&h(), r.path_str(), "a.txt", None, "changed\n", &rules).unwrap_err();
    assert!(err.contains("read-only"), "{err}");
    assert!(ops::save_file(&h(), r.path_str(), "../.env", None, "x", &rules).is_err());
    assert_eq!(std::fs::read_to_string(r.path.join("a.txt")).unwrap(), "one\ntwo\n");
}
