#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

pub struct TempRepo {
    pub dir: tempfile::TempDir,
    pub path: PathBuf,
}

impl TempRepo {
    pub fn path_str(&self) -> &str {
        self.path.to_str().unwrap()
    }
}

/// A repo on `main` with one commit containing `a.txt`.
pub fn temp_repo() -> TempRepo {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("repo");
    std::fs::create_dir(&path).unwrap();
    git(&path, &["init", "-q", "-b", "main"]);
    std::fs::write(path.join("a.txt"), "one\ntwo\n").unwrap();
    git(&path, &["add", "a.txt"]);
    git(&path, &["commit", "-q", "-m", "first"]);
    TempRepo { dir, path }
}

/// Test setup only; the code under test never runs mutating git.
pub fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

pub fn wait_for(cond: impl Fn() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if cond() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}
