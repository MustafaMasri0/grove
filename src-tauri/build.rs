//! Embeds every helper in `bin/` (built by scripts/build-helpers.sh), named
//! `wv-helper-<target>[.exe]`, as a table for `hosts.rs`. Each gets a hash of its
//! bytes for its install name, so a changed helper is re-installed automatically.
//! A system with no helper here just can't be connected to, so adding one needs
//! no change but the file.

use std::fmt::Write;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=bin");
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
