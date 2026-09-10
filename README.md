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

The first build downloads the 99 MB ONNX model and pinned build dependencies.
Follow the HTTPS server's printed certificate installation URL on Vision Pro,
install the profile, and enable full trust for the root CA in Settings → General
→ About → Certificate Trust Settings. Open the printed HTTPS page URL. Existing
certificates are reused. If the Mac hostname changes, the certificate must be
reissued and any new root trusted on the headset.

Select **Choose an image** or **Try example photo**. The analysis uses a center
crop at 518 × 392; the left preview shows exactly what is analyzed. Depth is shown
as soon as ONNX completes, before the detector runs. Drag the point cloud to orbit,
scroll to zoom, or select **Enter VR** on a compatible headset. Adjust the score
threshold, depth spread, and detection visibility. **Export results** saves the
raw candidates, filtered image detections, settings, and timings as JSON.
**Cancel** terminates the inference worker; a later job creates a fresh runtime.

The inference worker requires WebGPU. Immersive rendering additionally requires
WebXR's `XRGPUBinding` (Safari on visionOS 26.2+). ONNX Runtime is configured with
one Wasm thread, so cross-origin isolation is not required. Files remain local to
the browser; downloads are same-origin model/runtime resources. No CDN is used
at runtime.

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
annotations derived from 2D bounds and sampled display depth, **not fitted 3D
spheres or physical measurements**. Scores are not calibrated probabilities.

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
