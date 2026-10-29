//! Embeds the Linux helper binary (built in WSL by scripts/build-helper.sh) and
//! derives its install name from a hash of its bytes, so a changed helper is
//! re-installed into the distro automatically.

use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=bin/wv-helper");
    let src = Path::new("bin/wv-helper");
    let bytes = std::fs::read(src).unwrap_or_default();
    if bytes.is_empty() {
        println!("cargo:warning=bin/wv-helper is missing: WSL repositories will not open. Run scripts/build-helper.sh in WSL first.");
    }
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("wv-helper");
    std::fs::write(&out, &bytes).unwrap();
    // FNV-1a, enough to tell builds apart.
    let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3));
    println!("cargo:rustc-env=WV_HELPER_HASH={hash:016x}");
    tauri_build::build()
}
