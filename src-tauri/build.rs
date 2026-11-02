//! Embeds every helper in `bin/` (built by scripts/build-helpers.sh), named
//! `wv-helper-<target>[.exe]`, as a table for `hosts.rs`. Each gets a hash of its
//! bytes for its install name, so a changed helper is re-installed automatically.
//! A system with no helper here just can't be connected to, so adding one needs
//! no change but the file.
//!
//! The helpers are not built with the app, so one built from older sources would
//! embed quietly and then fail at run time on whatever the protocol gained since:
//! the build stops instead.

use std::fmt::Write;
use std::path::Path;
use std::time::SystemTime;

/// What the helpers are built from.
const HELPER_SOURCES: [&str; 2] = ["../crates/wv-core/src", "../crates/wv-helper/src"];

/// When the newest file under `dir` was last changed.
fn newest_change(dir: &Path) -> Option<SystemTime> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| if e.path().is_dir() { newest_change(&e.path()) } else { e.metadata().ok()?.modified().ok() })
        .max()
}

fn stop_if_stale(names: &[String]) {
    let Some(sources) = HELPER_SOURCES.iter().filter_map(|d| newest_change(Path::new(d))).max() else { return };
    let is_stale = |name: &&String| std::fs::metadata(Path::new("bin").join(name)).and_then(|m| m.modified()).is_ok_and(|built| built < sources);
    let stale: Vec<_> = names.iter().filter(is_stale).map(String::as_str).collect();
    if !stale.is_empty() {
        panic!("{} older than the code in crates/: run scripts/build-helpers.sh first.", stale.join(", "));
    }
}

fn main() {
    println!("cargo:rerun-if-changed=bin");
    for dir in HELPER_SOURCES {
        println!("cargo:rerun-if-changed={dir}");
    }
    let mut names: Vec<String> = std::fs::read_dir("bin")
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with("wv-helper-"))
        .collect();
    names.sort();
    if names.is_empty() {
        println!("cargo:warning=src-tauri/bin has no helpers: WSL and SSH repositories will not open. Run scripts/build-helpers.sh first.");
    }
    stop_if_stale(&names);

    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let mut table = String::from("static HELPERS: &[HelperBinary] = &[\n");
    for name in &names {
        let bytes = std::fs::read(Path::new("bin").join(name)).unwrap();
        // FNV-1a, enough to tell builds apart.
        let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3));
        let target = name.trim_start_matches("wv-helper-").trim_end_matches(".exe");
        writeln!(table, "    HelperBinary {{ target: {target:?}, hash: \"{hash:016x}\", bytes: include_bytes!({:?}) }},", format!("{dir}/bin/{name}")).unwrap();
    }
    table.push_str("];\n");
    std::fs::write(Path::new(&std::env::var("OUT_DIR").unwrap()).join("helpers.rs"), table).unwrap();
    tauri_build::build()
}
