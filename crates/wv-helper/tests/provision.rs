//! Installs and starts the real helper the way the app does on a machine it
//! reaches through a shell. `sh` stands in for that shell, with a throwaway home
//! folder; a test against a real server runs when WV_TEST_SSH names one.

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use wv_core::helper_client::HelperClient;
use wv_core::host::GitHost;
use wv_core::paths::{route, Route};
use wv_core::remote::{connect, provision, Arch, HelperBinary, Os, Platform, Shell};

struct Sh {
    home: std::path::PathBuf,
}

impl Shell for Sh {
    fn name(&self) -> String {
        "sh".into()
    }

    fn command(&self, line: &str) -> Command {
        let mut c = Command::new("sh");
        c.arg("-c").arg(line).env("HOME", &self.home);
        c
    }
}

const LINUX: Platform = Platform { os: Os::Linux, arch: Arch::X86_64 };

fn helper(hash: &'static str) -> HelperBinary {
    let bytes = std::fs::read(env!("CARGO_BIN_EXE_wv-helper")).unwrap();
    HelperBinary { target: "x86_64-unknown-linux-musl", hash, bytes: bytes.leak() }
}

fn installed(home: &std::path::Path) -> Vec<String> {
    let mut names: Vec<_> = std::fs::read_dir(home.join(".local/share/grove"))
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

#[test]
fn the_first_connection_installs_and_a_new_build_replaces_the_old_one() {
    let dir = tempfile::tempdir().unwrap();
    let shell = Sh { home: dir.path().into() };
    let quiet = || Arc::new(|| {});

    let client = provision(&shell, LINUX, &[helper("aaa")], quiet()).unwrap();
    assert_eq!(client.version(), env!("CARGO_PKG_VERSION"));
    assert_eq!(installed(dir.path()), ["helper-aaa"]);
    drop(client);

    // Installed already: it just starts.
    let client = provision(&shell, LINUX, &[helper("aaa")], quiet()).unwrap();
    assert!(client.is_alive());
    drop(client);

    provision(&shell, LINUX, &[helper("bbb")], quiet()).unwrap();
    assert_eq!(installed(dir.path()), ["helper-bbb"]);
}

#[test]
fn a_helper_that_cannot_run_is_an_error_not_a_hang() {
    let dir = tempfile::tempdir().unwrap();
    let shell = Sh { home: dir.path().into() };
    let junk = HelperBinary { target: "x86_64-unknown-linux-musl", hash: "ccc", bytes: b"not a program" };
    assert!(provision(&shell, LINUX, &[junk], Arc::new(|| {})).is_err());
}

#[test]
fn a_system_without_a_helper_is_named() {
    let dir = tempfile::tempdir().unwrap();
    let shell = Sh { home: dir.path().into() };
    let mac = Platform { os: Os::Macos, arch: Arch::Aarch64 };
    let err = provision(&shell, mac, &[helper("ddd")], Arc::new(|| {})).err().unwrap();
    assert!(err.contains("aarch64-apple-darwin"), "{err}");
}

#[test]
fn losing_a_connection_that_was_up_is_reported_once() {
    let dir = tempfile::tempdir().unwrap();
    let shell = Sh { home: dir.path().into() };
    let lost = Arc::new(AtomicUsize::new(0));
    let l = lost.clone();
    let client = provision(&shell, LINUX, &[helper("eee")], Arc::new(move || { l.fetch_add(1, Ordering::SeqCst); })).unwrap();
    drop(client);
    let start = std::time::Instant::now();
    while lost.load(Ordering::SeqCst) == 0 && start.elapsed().as_secs() < 5 {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert_eq!(lost.load(Ordering::SeqCst), 1);
}

#[test]
fn a_helper_that_fails_to_start_says_why() {
    let dir = tempfile::tempdir().unwrap();
    let shell = Sh { home: dir.path().into() };
    let fails = HelperBinary { target: "x86_64-unknown-linux-musl", hash: "fff", bytes: b"#!/bin/sh\necho no git here >&2\nexit 3\n" };
    let err = provision(&shell, LINUX, &[fails], Arc::new(|| {})).err().unwrap();
    assert!(err.contains("no git here"), "{err}");
}

/// The connection to a real host. `scripts/test-ssh-host.sh` runs these against a stock sshd in a
/// container; for another host, `WV_TEST_SSH=ssh://user@host/path/to/repo cargo test -p wv-helper
/// --test provision -- --ignored`, with `WV_TEST_HELPER=<path>` the helper built for that host,
/// `WV_TEST_TARGET` its target and `WV_TEST_BASE` the overview's base branch if any.
fn real_host() -> (HelperClient, String) {
    let address = std::env::var("WV_TEST_SSH").expect("WV_TEST_SSH");
    let Route::Ssh { target, path } = route(&address).unwrap() else { panic!("not an ssh address") };
    let bytes = std::fs::read(std::env::var("WV_TEST_HELPER").expect("WV_TEST_HELPER")).unwrap();
    let helper = HelperBinary {
        target: std::env::var("WV_TEST_TARGET").expect("WV_TEST_TARGET").leak(),
        // By content, like the app, so that running these twice does not reinstall.
        hash: format!("test{:x}", bytes.iter().fold(0u64, |h, &b| h.wrapping_mul(31).wrapping_add(b as u64))).leak(),
        bytes: bytes.leak(),
    };
    (connect(&target, &[helper], Arc::new(|| {})).unwrap(), path)
}

#[test]
#[ignore = "needs a real SSH server"]
fn a_real_ssh_host_serves_a_repository() {
    let (h, path) = real_host();
    let out = h.git(&path, &["rev-parse".to_string(), "--show-toplevel".to_string()], None).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    let root = String::from_utf8(out.stdout).unwrap();
    assert!(h.list_dir(root.trim()).unwrap().iter().any(|e| e.name == ".git"));
}

/// The real overview of every worktree, as the app does on opening a repository.
#[test]
#[ignore = "needs a real SSH server"]
fn a_real_ssh_host_serves_the_overview() {
    let (h, path) = real_host();
    // Like the app, which leaves out worktrees whose folder is gone.
    let cwds: Vec<String> = wv_core::repo_ops::worktrees(&h, &path).unwrap().into_iter().filter(|w| w.prunable.is_none()).map(|w| w.path).collect();
    let base = std::env::var("WV_TEST_BASE").ok();
    for round in 0..3 {
        let started = std::time::Instant::now();
        let o = h.overview(&cwds, base.as_deref()).unwrap();
        eprintln!("round {round}: {} worktrees, {} overlaps in {:?}", o.worktrees.len(), o.overlaps.len(), started.elapsed());
        assert!(o.errors.is_empty(), "{:?}", o.errors);
    }
}
