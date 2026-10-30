//! Spawns the real helper binary and drives it through `HelperClient`, the same
//! client the app uses behind `wsl.exe` and `ssh`.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use wv_core::helper_client::HelperClient;
use wv_core::host::{GitHost, WatchSpec};

fn helper() -> HelperClient {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_wv-helper"));
    cmd.stderr(Stdio::null());
    HelperClient::spawn(cmd, Box::new(|| {})).expect("helper starts and says hello")
}

fn repo() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("my repo ü");
    std::fs::create_dir(&p).unwrap();
    let g = |args: &[&str]| {
        let ok = Command::new("git")
            .current_dir(&p)
            .args(["-c", "user.name=T", "-c", "user.email=t@e", "-c", "commit.gpgsign=false"])
            .args(args)
            .status()
            .unwrap()
            .success();
        assert!(ok, "{args:?}");
    };
    g(&["init", "-q", "-b", "main"]);
    std::fs::write(p.join("a.txt"), "hello\n").unwrap();
    g(&["add", "."]);
    g(&["commit", "-q", "-m", "first"]);
    let s = p.to_str().unwrap().to_string();
    (dir, s)
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn hello_reports_version() {
    assert_eq!(helper().version(), env!("CARGO_PKG_VERSION"));
}

#[test]
fn git_runs_inside_the_helper() {
    let (_d, repo) = repo();
    let h = helper();
    let out = h.git(&repo, &s(&["log", "--format=%s"]), None).unwrap();
    assert_eq!(out.code, 0);
    assert_eq!(out.stdout, b"first\n");
    let err = h.git(&repo, &s(&["show", "nope"]), None).unwrap();
    assert_ne!(err.code, 0);
    assert!(!err.stderr.is_empty());
}

#[test]
fn helper_enforces_the_allowlist_itself() {
    let (_d, repo) = repo();
    let h = helper();
    // Bypass the client-side check to prove the helper refuses on its own.
    let err = h.raw_git_unchecked(&repo, &s(&["commit", "--allow-empty", "-m", "x"])).unwrap_err();
    assert!(err.contains("not allowed"), "{err}");
    let count = h.git(&repo, &s(&["rev-list", "--count", "HEAD"]), None).unwrap();
    assert_eq!(count.stdout, b"1\n");
}

#[test]
fn client_also_refuses_before_sending() {
    let (_d, repo) = repo();
    assert!(helper().git(&repo, &s(&["reset", "--hard"]), None).unwrap_err().contains("not allowed"));
}

#[test]
fn files_dirs_and_mtime() {
    let (_d, repo) = repo();
    let h = helper();
    let f = h.read_file(&format!("{repo}/a.txt"), 1000).unwrap();
    assert_eq!(f.data.as_deref(), Some(&b"hello\n"[..]));
    assert_eq!(h.read_file(&format!("{repo}/a.txt"), 2).unwrap().data, None);
    assert!(h.read_file(&format!("{repo}/missing"), 10).is_err());
    let names: Vec<_> = h.list_dir(&repo).unwrap().into_iter().map(|e| e.name).collect();
    assert!(names.contains(&"a.txt".to_string()));
    assert!(h.mtime(&format!("{repo}/a.txt")).unwrap().is_some());
}

#[test]
fn binary_content_survives_the_json_hop() {
    let (_d, repo) = repo();
    let bytes: Vec<u8> = (0..=255u8).collect();
    std::fs::write(format!("{repo}/bin.dat"), &bytes).unwrap();
    assert_eq!(helper().read_file(&format!("{repo}/bin.dat"), 1000).unwrap().data, Some(bytes));
}

#[test]
fn concurrent_requests_are_matched_to_their_callers() {
    let (_d, repo) = repo();
    let h = Arc::new(helper());
    let threads: Vec<_> = (0..16)
        .map(|i| {
            let h = h.clone();
            let repo = repo.clone();
            std::thread::spawn(move || {
                let fmt = format!("--format=tformat:{i}");
                let out = h.git(&repo, &s(&["log", &fmt]), None).unwrap();
                assert_eq!(out.stdout, format!("{i}\n").into_bytes(), "code {} stderr {}", out.code, out.stderr);
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
}

#[test]
fn large_replies_arrive_whole_among_small_ones() {
    let (_d, repo) = repo();
    let data = vec![b'x'; 900_000];
    std::fs::write(format!("{repo}/big.dat"), &data).unwrap();
    let h = Arc::new(helper());
    let threads: Vec<_> = (0..24)
        .map(|i| {
            let (h, repo, data) = (h.clone(), repo.clone(), data.clone());
            std::thread::spawn(move || {
                if i % 2 == 0 {
                    assert_eq!(h.read_file(&format!("{repo}/big.dat"), 1_000_000).unwrap().data, Some(data));
                } else {
                    assert_eq!(h.git(&repo, &s(&["rev-list", "--count", "HEAD"]), None).unwrap().stdout, b"1\n");
                }
            })
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
}

#[test]
fn progress_lines_are_forwarded() {
    let (d, repo) = repo();
    let bare = d.path().join("remote.git");
    assert!(Command::new("git").args(["init", "-q", "--bare"]).arg(&bare).status().unwrap().success());
    assert!(Command::new("git").current_dir(&repo).args(["remote", "add", "origin"]).arg(&bare).status().unwrap().success());
    let h = helper();
    let lines = Mutex::new(Vec::new());
    let p = |l: &str| lines.lock().unwrap().push(l.to_string());
    let out = h.git(&repo, &s(&["push", "--progress", "-u", "origin", "main"]), Some(&p)).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    assert!(!lines.lock().unwrap().is_empty());
}

#[test]
fn watch_events_arrive_and_stop_after_unwatch() {
    let (_d, repo) = repo();
    let h = helper();
    let hits = Arc::new(AtomicUsize::new(0));
    let c = hits.clone();
    let spec = WatchSpec { root: repo.clone(), git_dirs: vec![format!("{repo}/.git")], exclude: vec![] };
    let id = h.watch(spec, Arc::new(move |_| { c.fetch_add(1, Ordering::SeqCst); })).unwrap();
    std::thread::sleep(Duration::from_millis(200));
    std::fs::write(format!("{repo}/a.txt"), "changed\n").unwrap();
    let start = Instant::now();
    while hits.load(Ordering::SeqCst) == 0 && start.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);

    h.unwatch(id);
    std::thread::sleep(Duration::from_millis(200));
    std::fs::write(format!("{repo}/a.txt"), "again\n").unwrap();
    std::thread::sleep(Duration::from_millis(800));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_dead_helper_fails_calls_instead_of_hanging() {
    let mut cmd = Command::new("sh");
    cmd.args(["-c", r#"echo '{"type":"hello","version":"x"}'; read line; exit 0"#]);
    let h = HelperClient::spawn(cmd, Box::new(|| {})).unwrap();
    let start = Instant::now();
    assert!(h.list_dir("/").is_err());
    assert!(start.elapsed() < Duration::from_secs(5));
    assert!(!h.is_alive());
}

#[test]
fn blame_runs_in_the_helper_but_not_with_options_that_read_other_files() {
    let (_d, repo) = repo();
    let h = helper();
    let out = h.git(&repo, &s(&["blame", "--porcelain", "--", "a.txt"]), None).unwrap();
    assert_eq!(out.code, 0);
    assert!(String::from_utf8_lossy(&out.stdout).contains("\thello\n"));
    let err = h.raw_git_unchecked(&repo, &s(&["blame", "--porcelain", "--contents", "/etc/passwd", "--", "a.txt"])).unwrap_err();
    assert!(err.contains("only `git blame --porcelain"), "{err}");
}
