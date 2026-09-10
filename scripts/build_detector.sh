#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
iree_revision=e4a3b0405d7d23554da26403658d0e8c3c5ecf25
if [ ! -d .build-deps/iree ]; then
  mkdir -p .build-deps
  git clone --depth 1 --branch v3.11.0 https://github.com/iree-org/iree.git .build-deps/iree
fi
if [ "$(git -C .build-deps/iree rev-parse HEAD)" != "$iree_revision" ]; then
  echo 'Unexpected IREE revision in .build-deps/iree; expected pinned 3.11.0.' >&2
  exit 1
fi
git -C .build-deps/iree submodule update --init --depth 1 third_party/flatcc third_party/printf
.venv/bin/python scripts/export_detector.py
emcmake cmake -G Ninja -S runtime -B .build-deps/iree-wasm \
  -DCMAKE_BUILD_TYPE=Release -DIREE_ERROR_ON_MISSING_SUBMODULES=OFF
cmake --build .build-deps/iree-wasm --target sphere_runtime -j 6
mkdir -p runtime/generated
cp .build-deps/iree-wasm/sphere_runtime.mjs .build-deps/iree-wasm/sphere_runtime.wasm runtime/generated/
