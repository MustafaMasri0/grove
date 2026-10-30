#!/usr/bin/env bash
# Builds the helper for every system this machine can target and drops the
# binaries where the app build embeds them. Any target left out here only means
# that system can't be connected to; the app finds what is there.
#
# The Linux helpers are static and link with Rust's own lld, so they build on any
# OS. The Windows and macOS ones need that OS (or a CI runner of it). Run this on
# each, copy every src-tauri/bin/wv-helper-* into one place, then build the app.
set -euo pipefail
cd "$(dirname "$0")/.."

targets=(x86_64-unknown-linux-musl aarch64-unknown-linux-musl)
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*) targets+=(x86_64-pc-windows-msvc) ;;
  Darwin) targets+=(aarch64-apple-darwin x86_64-apple-darwin) ;;
esac

export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=rust-lld
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=rust-lld
rustup target add "${targets[@]}"

target_dir="${CARGO_TARGET_DIR:-target}"
mkdir -p src-tauri/bin
for target in "${targets[@]}"; do
  cargo build -q -p wv-helper --release --target "$target"
  ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  cp "$target_dir/$target/release/wv-helper$ext" "src-tauri/bin/wv-helper-$target$ext"
done
ls -la src-tauri/bin
