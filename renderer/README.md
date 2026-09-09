# Rust wgpu / Wasm cube

Build from the project root with `sh scripts/build_wasm.sh`, then run
`python3 scripts/serve_https.py`. Open
`https://Kents-MacBook-Pro.local:8443/index.html` on Vision Pro.
Install Rust (including `wasm32-unknown-unknown`) and wasm-pack before the first build.
Generated browser files live in `pkg/`; the browser needs no CDN dependencies.

`src/lib.rs` owns the wgpu device, geometry, uniforms, pipeline and draw commands.
`src/cube.wgsl` shades the rotating 0.5-meter cube positioned two meters ahead.
`../app.js` handles the canvas preview and WebXR session, poses and projection layer.
Both paths import browser-owned textures into wgpu without copying or destroying them.
Each eye is submitted before updating the shared camera uniform for the next eye.

Immersive rendering requires trusted HTTPS and WebXR's WebGPU binding (Safari on
visionOS 26.2+). An unsupported browser gets a preview or a capability error.
The session requests the `webgpu` feature and uses its WebGPU projection matrices
(0..1 depth). A `local` reference space keeps the cube relative to the initial pose.
Headset rendering must be tested on the actual device.

## Patched dependency

wgpu is pinned to `=30.0.1`. The build script runs `scripts/prepare_wgpu.py`, which
downloads the published crate, verifies its pinned SHA-256, and applies
`patches/wgpu-30.0.1-xr-compatible.patch`. The archive and patched source are kept
in the ignored `.build-deps/` directory. Subsequent builds reuse the archive and
apply the patch to a fresh extraction, so it is never applied twice to a file.
Only the patch and setup script belong in Git. Cargo builds with `--locked`.
The first build requires network access; preparation also requires Python 3.12+
(for safe tar extraction), curl, and patch.

The patch sets `xrCompatible: true` on adapter requests. Upstream's Rust options
do not expose this WebXR option. When upgrading, update the Cargo version,
script version/checksum, patch, and lockfile together. Remove the patch once
upstream offers the equivalent option. The same GPU device is used by wgpu and
`XRGPUBinding`; importing textures from another device would be invalid.
