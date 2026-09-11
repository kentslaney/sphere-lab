#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Prerequisites: Python 3.12+, Node/npm, Rust + wasm-pack, Emscripten, CMake, Ninja.
if [ ! -d .venv ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -r scripts/requirements-browser.txt
npm ci --ignore-scripts
.venv/bin/python scripts/prepare_depth.py
.venv/bin/python scripts/export_font.py
sh scripts/build_detector.sh
sh scripts/build_wasm.sh
python3 scripts/stage_web.py
.venv/bin/python scripts/validate_detector.py
npm test
