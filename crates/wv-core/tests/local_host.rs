//! LocalHost against real git in temporary repositories.

mod common;

use common::{git, temp_repo, wait_for};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use wv_core::host::{GitHost, WatchSpec};
use wv_core::local::LocalHost;

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn runs_read_only_git_and_returns_stdout() {
    let repo = temp_repo();
    let out = LocalHost::new().git(repo.path_str(), &s(&["status", "--porcelain=v2", "-z", "--branch"]), None).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    let status = wv_core::porcelain::status::parse_status_v2(&out.stdout).unwrap();
    assert_eq!(status.branch.head.as_deref(), Some("main"));
}

#[test]
fn refuses_mutating_commands_before_running_anything() {
    let repo = temp_repo();
    let err = LocalHost::new().git(repo.path_str(), &s(&["commit", "--allow-empty", "-m", "x"]), None).unwrap_err();
    assert!(err.contains("not allowed"), "{err}");
    assert_eq!(git(&repo.path, &["rev-list", "--count", "HEAD"]).trim(), "1");
}

#[test]
fn status_does_not_rewrite_the_index() {
    let repo = temp_repo();
    let index = repo.path.join(".git/index");
    // Make the index stat-dirty so a normal `git status` would refresh and rewrite it.
    std::thread::sleep(Duration::from_millis(1100));
    std::fs::write(repo.path.join("a.txt"), "one\n").unwrap();
    let before = std::fs::metadata(&index).unwrap().modified().unwrap();
    LocalHost::new().git(repo.path_str(), &s(&["status", "--porcelain=v2", "-z"]), None).unwrap();
    assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), before);
}

#[test]
fn failing_git_returns_code_and_stderr() {
    let repo = temp_repo();
    let out = LocalHost::new().git(repo.path_str(), &s(&["show", "nope:missing"]), None).unwrap();
    assert_ne!(out.code, 0);
    assert!(out.stderr.contains("nope"), "{}", out.stderr);
}

#[test]
fn network_commands_stream_progress_and_never_prompt() {
    let repo = temp_repo();
    let bare = repo.dir.path().join("remote.git");
    git(repo.dir.path(), &["init", "-q", "--bare", bare.to_str().unwrap()]);
    git(&repo.path, &["remote", "add", "origin", bare.to_str().unwrap()]);
    let lines = Mutex::new(Vec::<String>::new());
    let progress = |l: &str| lines.lock().unwrap().push(l.to_string());
    let host = LocalHost::new();
    let out = host.git(repo.path_str(), &s(&["push", "--progress", "-u", "origin", "main"]), Some(&progress)).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert!(!lines.lock().unwrap().is_empty(), "push --progress should report progress");
    assert_eq!(git(&bare, &["rev-parse", "main"]), git(&repo.path, &["rev-parse", "main"]));

    // An unreachable https remote must fail fast instead of waiting for a password.
    git(&repo.path, &["remote", "add", "nowhere", "https://127.0.0.1:9/x.git"]);
    let out = host.git(repo.path_str(), &s(&["fetch", "nowhere"]), None).unwrap();
    assert_ne!(out.code, 0);
}

#[test]
fn read_file_respects_the_size_limit() {
    let repo = temp_repo();
    let host = LocalHost::new();
    let p = repo.path.join("a.txt");
    let small = host.read_file(p.to_str().unwrap(), 100).unwrap();
    assert_eq!(small.data.as_deref(), Some(&b"one\ntwo\n"[..]));
    let big = host.read_file(p.to_str().unwrap(), 3).unwrap();
    assert_eq!((big.size, big.data), (8, None));
    assert!(host.read_file(repo.path.join("missing").to_str().unwrap(), 10).is_err());
}

#[test]
fn list_dir_and_mtime() {
    let repo = temp_repo();
    std::fs::create_dir(repo.path.join("sub dir")).unwrap();
    let host = LocalHost::new();
    let mut entries = host.list_dir(repo.path_str()).unwrap();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    let names: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
    assert_eq!(names, vec![(".git", true), ("a.txt", false), ("sub dir", true)]);
    assert!(host.mtime(repo.path.join("a.txt").to_str().unwrap()).unwrap().is_some());
    assert_eq!(host.mtime(repo.path.join("nope").to_str().unwrap()).unwrap(), None);
}

#[test]
fn watcher_fires_once_per_burst_and_ignores_node_modules() {
    let repo = temp_repo();
    std::fs::create_dir_all(repo.path.join("node_modules/pkg")).unwrap();
    std::fs::create_dir_all(repo.path.join("src")).unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let host = LocalHost::new();
    let spec = WatchSpec { root: repo.path_str().into(), git_dirs: vec![], exclude: vec![] };
    let id = host.watch(spec, Arc::new(move || { h.fetch_add(1, Ordering::SeqCst); })).unwrap();
    std::thread::sleep(Duration::from_millis(200));

    std::fs::write(repo.path.join("node_modules/pkg/index.js"), "x").unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(hits.load(Ordering::SeqCst), 0, "node_modules must be ignored");

    for i in 0..5 {
        std::fs::write(repo.path.join("src/f.txt"), format!("{i}")).unwrap();
    }
    assert!(wait_for(|| hits.load(Ordering::SeqCst) >= 1));
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(hits.load(Ordering::SeqCst), 1, "a burst is debounced into one refresh");

    // New directories are picked up too.
    std::fs::create_dir(repo.path.join("src/new")).unwrap();
    std::thread::sleep(Duration::from_millis(600));
    let before = hits.load(Ordering::SeqCst);
    std::fs::write(repo.path.join("src/new/x.txt"), "x").unwrap();
    assert!(wait_for(|| hits.load(Ordering::SeqCst) > before));

    host.unwatch(id);
}

#[test]
fn watcher_sees_git_dir_changes_like_a_new_commit() {
    let repo = temp_repo();
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let host = LocalHost::new();
    let git_dir = repo.path.join(".git");
    let spec = WatchSpec { root: repo.path_str().into(), git_dirs: vec![git_dir.to_str().unwrap().into()], exclude: vec![] };
    let id = host.watch(spec, Arc::new(move || { h.fetch_add(1, Ordering::SeqCst); })).unwrap();
    std::thread::sleep(Duration::from_millis(200));
    git(&repo.path, &["commit", "-q", "--allow-empty", "-m", "second"]);
    assert!(wait_for(|| hits.load(Ordering::SeqCst) >= 1));
    host.unwatch(id);
}
