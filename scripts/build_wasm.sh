#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Homebrew rustup is keg-only on macOS.
if [ -d /opt/homebrew/opt/rustup/bin ]; then
  export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
fi
python3 scripts/prepare_wgpu.py
wasm-pack build renderer --target web --out-dir ../pkg --release --locked
