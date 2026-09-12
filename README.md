# Sphere Lab — client-side depth and sphere detection

Upload a browser-supported photo, estimate depth with Depth Anything V2 Small,
explore a colored point cloud, and inspect candidates from the sphere-detector
submodule. All inference runs in the browser. The Python server only serves
files; it never receives the selected image or runs a model.

## Build and run

Prerequisites: Python 3.12+, Node/npm, Rust with the `wasm32-unknown-unknown`
target, wasm-pack, Emscripten, CMake, Ninja, curl, and patch.
On macOS, the build scripts recognize Homebrew's keg-only rustup path.

```sh
git submodule update --init
sh scripts/build_pipeline.sh
python3 scripts/serve_https.py
```

The page and app entry point live in `web/index.html` and `web/app.js`; renderer
builds write generated Wasm files to `web/pkg/`. Both Python servers serve only
`web/`; open `/` or `/index.html`. `scripts/stage_web.py` copies the models,
example, IREE runtime, and ONNX Runtime distribution into ignored directories
inside `web/`. The full build and both server startup paths run this staging
step automatically. After rebuilding individual inference components while a
server is running, run `python3 scripts/stage_web.py` to refresh those copies.

Browser asset URLs resolve relative to the page or importing module, so nginx
can strip a public prefix before proxying. Open the public URL with a trailing
slash (for example `/sphere/`) or with `index.html` (`/sphere/index.html`).
Configure nginx to redirect `/sphere` to `/sphere/`; without the trailing slash,
the browser resolves relative assets beside the prefix instead of inside it.
The authenticated server disables Flask's default-route canonical redirects so
requests for `index.html` retain the public prefix.

The first build downloads the 99 MB ONNX model and pinned build dependencies.
Follow the HTTPS server's printed certificate installation URL on Vision Pro,
install the profile, and enable full trust for the root CA in Settings → General
→ About → Certificate Trust Settings. Open the printed HTTPS page URL. Existing
certificates are reused. If the Mac hostname changes, the certificate must be
reissued and any new root trusted on the headset.

Select **Choose an image** or **Try example photo**. The analysis uses a center
crop at 518 × 392; the left preview shows exactly what is analyzed. Depth is shown
as soon as ONNX completes, before the detector runs. Drag with a mouse to look
around. Vertical scrolling moves along camera depth; holding Shift moves along
camera up/down instead. Horizontal trackpad
scrolling moves along camera right. On devices matching CSS `(pointer: coarse)`, tap the
viewport to enter full screen before interacting; the initial tap leaves the
camera in place. An **Exit full screen** button returns to the page. Browsers
without native fullscreen use a full-window view. One touch pans; multiple
touches pan and move the camera in depth at a fixed field of view. Each touch
anchors a raycast point; empty areas use the cloud's median visible depth plane
(or a two-meter plane without a cloud). Motion that cannot satisfy all anchors
with translation uses a least-squares fit.

Select **Enter VR** on a compatible headset. Pinch and hold with one hand to
move the cloud, or both hands to scale and rotate around the grab points.
Release to leave it in place. Scaling is limited to 0.1–10×. A short pinch
(up to 250 ms, moving no more than 2 cm) followed within 350 ms by another pinch
opens a context menu. Move the second pinch upward to highlight **config**, or
back down to **Cancel**; release to select. Cancel starts selected, so an
immediate release closes the menu. Config shows the same Depth spread,
Minimum score, and Show detections values as the page. Scene dragging is disabled while Config is open. Hover over a row without
pinching to highlight it, then pinch and move horizontally to adjust spread or
score. The grabbed row stays selected even if the hand moves vertically. Release
on Show detections to toggle it, or Done to close. Menu and config text and
styling are drawn in JavaScript and uploaded as an RGBA texture sampled by WGSL.
Missing hand tracking pauses the gesture and rebases on recovery.

**Config** (or right-clicking the viewport) opens the controls outside VR only
while the viewport is in full screen. The ordinary embedded viewport has no
Config menu; its existing controls remain below it. Depth spread uses a logarithmic 0.25–4× range,
with 1× at the midpoint. **Reset view** restores placement, rotation, and scale
after exiting VR. **Export results** saves the
raw candidates, filtered image detections, settings, and timings as JSON.
**Cancel** terminates the inference worker; a later job creates a fresh runtime.

The inference worker requires WebGPU. Immersive rendering additionally requires
WebXR's `XRGPUBinding` (Safari on visionOS 26.2+). ONNX Runtime is configured with
one Wasm thread, so cross-origin isolation is not required. Files remain local to
the browser; downloads are same-origin model/runtime resources. No CDN is used
at runtime.

## GitHub Pages

The public deployment repository is [`kentslaney/sphere-lab`](https://github.com/kentslaney/sphere-lab),
available locally as the `public` remote. The site is
<https://kentslaney.github.io/sphere-lab/>.

`.github/workflows/pages.yml` builds and validates the app on pushes to `main`
and manual runs on `main` in that public repository, then publishes only `web/`.
All jobs are skipped in the private `origin` repository and other copies. Before
building, a lightweight check confirms Pages is accessible and its publishing
source is GitHub Actions; otherwise the build and deployment are skipped.
The workflow installs Python, Node, Rust, wasm-pack, Emscripten, and native build
tools and runs the same `scripts/build_pipeline.sh` used locally. Generated models
and runtime files are uploaded as a Pages artifact; they do not belong in Git.
Only the public `sphere-detector` submodule is checked out, over HTTPS.

Pages is configured to use **GitHub Actions** in the public repository's
**Settings → Pages → Build and deployment**. After committing changes, publish
them with:

```sh
git push public main
```

You can also start **Deploy GitHub Pages** on `main` from the public repository's
Actions tab. Keep the site URL's trailing slash so relative asset URLs resolve
correctly. See GitHub's [custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Pages serves the static app over HTTPS, without the remote authentication
launcher. The published app and its model/example assets are publicly accessible;
selected photos are still processed locally in the browser.
WebGPU and WebXR browser requirements remain the same as for local hosting.

## Remote authentication launcher

With the `login` submodule checked out and your existing
`login/run/login_secret_session_key` and `login/run/public.pem` in place, run:

```sh
python3 scripts/run_remote.py
```

The launcher checks those files before doing setup, creates `.venv` if needed,
and ensures `login` is installed there as an editable package. It runs the full
build on the first launch, when build inputs change, or when required outputs
are missing. Successful builds are recorded in an ignored `.build-deps` stamp.
Use `--rebuild` to force a build. Browser assets are staged on every launch.

It starts the SSH login-server tunnel on local port 8001, the pubsub client,
the reverse SSH tunnel from remote port 8081 to local port 8080, and the Flask
auth server. Existing listeners on local ports 8001 or 8080 cause an error;
stop manually started copies before launching. Before starting the pubsub client,
the launcher waits up to 60 seconds for the WebSocket server’s HTTP 426
upgrade-required response through the local SSH tunnel; a listening TCP port
alone is not sufficient. It then waits for the pubsub client’s Unix socket to
accept connections before starting Flask. The probe avoids opening a login
WebSocket, which would log an error when closed without a login message. SSH uses your usual credentials
and configuration, detects forwarding failures, and sends keepalives. The remote
server command gets a PTY so closing SSH sends it a hangup. SSH receives no
terminal input, and its output is normalized so it cannot change the shared
terminal’s line handling or print doubled carriage returns.

Ctrl-C (or SIGTERM) sends termination to every managed process group, allows
8 seconds for graceful shutdown, then kills remaining local group members and
reaps direct children. Setup/build commands are supervised too. A second signal
exits immediately without further cleanup, so processes may remain. If any
service exits unexpectedly, the launcher shuts down the others and reports an
error. Remote cleanup relies on SSH hangup delivery; it cannot be guaranteed
through a network failure.

## Pipeline

- `web/inference-worker.js`: ONNX Runtime Web 1.29.0 with the WebGPU provider runs
  Depth Anything V2 Small. RGB is center-cropped/resampled, normalized with
  ImageNet mean/std, and packed as float32 NCHW `[1,3,392,518]`. Float depth is
  resized if necessary. Exact zero inverse-depth values are clamped to `1e-6`
  before the detector's reciprocal; invalid/nonfinite output fails explicitly.
- `scripts/export_detector.py`: imports the real `Raster(...).opt().predict()`
  graph from `sphere-detector`, exports StableHLO, and compiles it to IREE VMVX.
  Default detector configuration: 392 × 518, 8 candidates, 64 rays, float32.
  Input is DA2 relative inverse depth; the graph performs the inversion itself.
  Output is `[8,5]`: score, y-min, x-min, y-max, x-max in analysis-crop pixels.
- `runtime/sphere_runtime.c`: IREE 3.11.0 embedded in an Emscripten module. This
  graph runs on **Wasm CPU**, in the worker, not on GPU. Runtime errors propagate
  to the UI. The graph and context are retained for repeat invocations.
- `web/geometry.js`: builds the cloud and applies score filtering and 0.75 IoU
  suppression to the graph's candidates. It does not reimplement the detector.
- `renderer/src/lib.rs` and `cloud.wgsl`: Rust wgpu owns rendering of RGB point
  splats and gold detection outlines, in both the page and WebXR. See
  `renderer/README.md` for the pinned wgpu adapter patch.

## Interpretation and validation

Depth Anything V2 Small estimates **relative inverse depth**, not meters. The
viewer maps its 2nd–98th percentile range to bounded display distances and uses
an assumed 60° horizontal field of view. Depth spread changes only visualization;
it does not change the tensor passed to the detector. Gold sphere outlines are
base fitted depth profiles using the exported center depth and depth scale,
including the detector’s radial sampling offset but excluding its RMSE skew
correction. The nonlinear display mapping can distort these profiles; they are
**not physical measurements**. The browser graph exports `[8,7]` rows containing
confidence, four bounds, center depth, and depth scale without modifying the
upstream detector. Center depth is in reciprocal input units, and depth scale
converts those depth units to pixels for the fit. Scores are not calibrated probabilities.

The graph's reductions and numerically sensitive fitting can produce different
candidate scores/order on JAX, native IREE, and Wasm IREE. The synthetic-sphere
check verifies center/radius recovery and repeatability; it records each backend's
scores rather than asserting false numerical equivalence. See generated
`tests/generated/detector-reference.json`. On the initial synthetic check, top
scores were approximately JAX 0.257, native IREE 0.264, Wasm IREE 0.280; center and
radius errors were under one pixel. Do not use tiny score differences to rank
physical certainty.

```sh
.venv/bin/python scripts/validate_detector.py
npm test
```

Browser validation used the example photo and a separate JPEG selected through
the file chooser. Initial example timings on the development Mac were about
0.68 s for ONNX depth and 1.98 s for the sphere graph, excluding first-load setup.
These are not Vision Pro benchmarks. Actual headset inference and stereo viewing
still need a device check.

## Rebuilding individual components

```sh
sh scripts/build_wasm.sh                # renderer only
sh scripts/build_detector.sh            # graph and IREE runtime
.venv/bin/python scripts/prepare_depth.py # model and example image
```

Generated source, models, runtime binaries, and package caches are ignored by
Git. The ONNX model is pinned by repository revision and SHA-256; IREE is pinned
by commit and Python package versions; wgpu is downloaded and patched as part of
its build. `package-lock.json` and `renderer/Cargo.lock` pin JS/Rust dependencies.

## Third-party notices

Depth Anything V2 Small and its ONNX conversion are Apache-2.0 licensed:
https://huggingface.co/onnx-community/depth-anything-v2-small
Model revision: `4472b7362082ad9968fee890ca0f1e5aca36b93d`.
ONNX Runtime is MIT licensed; IREE is Apache-2.0 with LLVM exceptions; wgpu is
MIT/Apache-2.0. Their downloaded distributions retain their license files.
The sphere detector and example assets are supplied by the existing submodule.
