#!/usr/bin/env bash
# Builds the Linux helper inside WSL and drops it where the Windows build embeds it.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/wv-target}"
cargo build -q -p wv-helper --release --target x86_64-unknown-linux-gnu
mkdir -p src-tauri/bin
cp "$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/wv-helper" src-tauri/bin/wv-helper
ls -la src-tauri/bin/wv-helper
