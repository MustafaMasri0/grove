//! Installs and starts the real helper the way the app does on a machine it
//! reaches through a shell. `sh` stands in for that shell, with a throwaway home
//! folder; a test against a real server runs when WV_TEST_SSH names one.

use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
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

/// `WV_TEST_SSH=ssh://user@host/path/to/repo cargo test -p wv-helper --test provision -- --ignored`,
/// with `WV_TEST_HELPER=<path>` the helper built for that host and `WV_TEST_TARGET` its target.
#[test]
#[ignore = "needs a real SSH server"]
fn a_real_ssh_host_serves_a_repository() {
    let address = std::env::var("WV_TEST_SSH").expect("WV_TEST_SSH");
    let Route::Ssh { target, path } = route(&address).unwrap() else { panic!("not an ssh address") };
    let bytes = std::fs::read(std::env::var("WV_TEST_HELPER").expect("WV_TEST_HELPER")).unwrap();
    let hash = format!("test{}", bytes.len());
    let helper = HelperBinary {
        target: std::env::var("WV_TEST_TARGET").expect("WV_TEST_TARGET").leak(),
        hash: hash.leak(),
        bytes: bytes.leak(),
    };
    let h = connect(&target, &[helper], Arc::new(|| {})).unwrap();
    let out = h.git(&path, &["rev-parse".to_string(), "--show-toplevel".to_string()], None).unwrap();
    assert_eq!(out.code, 0, "{}", out.stderr);
    let root = String::from_utf8(out.stdout).unwrap();
    assert!(h.list_dir(root.trim()).unwrap().iter().any(|e| e.name == ".git"));
}

/// As above, with `WV_TEST_HASH` the hash of a helper already on the host: runs the real
/// overview of every worktree, as the app does on opening a repository.
#[test]
#[ignore = "needs a real SSH server"]
fn a_real_ssh_host_serves_the_overview() {
    let address = std::env::var("WV_TEST_SSH").expect("WV_TEST_SSH");
    let Route::Ssh { target, path } = route(&address).unwrap() else { panic!("not an ssh address") };
    let bytes = std::fs::read(std::env::var("WV_TEST_HELPER").expect("WV_TEST_HELPER")).unwrap();
    let helper = HelperBinary {
        target: std::env::var("WV_TEST_TARGET").expect("WV_TEST_TARGET").leak(),
        hash: std::env::var("WV_TEST_HASH").expect("WV_TEST_HASH").leak(),
        bytes: bytes.leak(),
    };
    let h = connect(&target, &[helper], Arc::new(|| {})).unwrap();
    let cwds: Vec<String> = wv_core::repo_ops::worktrees(&h, &path).unwrap().into_iter().map(|w| w.path).collect();
    let base = std::env::var("WV_TEST_BASE").ok();
    for round in 0..3 {
        let started = std::time::Instant::now();
        let o = wv_core::overview::overview(&h, &cwds, base.as_deref());
        eprintln!("round {round}: {} worktrees in {:?}", o.worktrees.len(), started.elapsed());
        assert!(o.errors.is_empty(), "{:?}", o.errors);
    }
}
