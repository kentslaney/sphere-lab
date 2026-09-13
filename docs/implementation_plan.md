# Implementation Plan: Multi-Function IREE IR, WGSL Curvature Determinants, Wasm Level Curves & VR Grab

Export multiple functions from the same IR (`@main` for detection and `@curvature` for `Depth.grad` and `Depth.rotated`), compute curvature determinants directly in WGSL to shade non-concave points at half opacity (`alpha = 0.5`), move 3D depth level curve calculation and closest-point search from JavaScript into Rust/Wasm (`cube_renderer`), update VR interaction so single grab inspects level curves without moving the scene, allow double grab to navigate without displaying curves, and animate the grab feedback bead to the closest point on the curve.

## User Review Required

> [!IMPORTANT]
> - **Multi-Function IR Export**: `sphere-detector.vmfb` now exports two entry points from the same IR:
>   - `@main`: fast candidate sphere detection `[8, 7]`.
>   - `@curvature`: returns `Depth.grad` `[392, 518, 2]` and `Depth.rotated` `[392, 518, 4]`.
>   This allows debug data to be queried on demand without slowing down regular inference.
> - **WGSL Determinants & Opacity**: Rather than computing a concavity mask on CPU, `Depth.rotated` is streamed to WebGPU. The WGSL vertex shader computes the $2 \times 2$ determinant `r00 * r11 - r01 * r10` and convexity/inwards conditions on the GPU, setting `alpha = 0.5` for non-concave points and `1.0` for concave points.
> - **Navigation Change in Debug Mode**: When debug mode is active, single-hand pinch in VR freezes navigation and slices the level curve at the hand's depth, animating the solid bead to the closest contour point. Two-hand pinch (double grab) navigates normally (pan, rotate, scale) and suppresses level curves.

---

## Proposed Changes

### Component 1: Multi-Function IREE IR & Runtime (`scripts/`, `runtime/`, `web/`)

#### [MODIFY] [export_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/export_detector.py)
- Define both entry functions:
  - `@jax.jit def detect(relative_inverse_depth)`: outputs `candidates` `[8, 7]`.
  - `@jax.jit def curvature(relative_inverse_depth)`: returns `(raster.depth.grad, raster.depth.rotated)`.
- Lower both functions to StableHLO, namespace private helper functions in `curvature` with `@_curv_`, rename its public export to `@curvature`, and merge into a single MLIR module.
- Compile to `models/sphere-detector.vmfb` targeting VMVX with index bits 32.
- Update `models/sphere-detector.json` metadata documenting both `@main` and `@curvature`.

#### [MODIFY] [sphere_runtime.c](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/sphere_runtime.c)
- Retain `function` for `@main` and add `curvature_function` for `@curvature`.
- Look up `@curvature` during `sphere_init`.
- Implement `sphere_run_curvature(const float* input, unsigned int count, float* grad_out, float* rotated_out)`:
  - Takes input `[392, 518]`.
  - Transcribes output 0 (`392 * 518 * 2` floats) to `grad_out`.
  - Transcribes output 1 (`392 * 518 * 4` floats) to `rotated_out`.
- In `runtime/CMakeLists.txt`: export `_sphere_run_curvature`.
- Rebuild via `sh scripts/build_detector.sh`.

#### [MODIFY] [inference-worker.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/inference-worker.js)
- When `type === 'infer'`:
  - Run depth model.
  - Run `_sphere_run` for sphere candidates.
  - If `debug` is requested (or in debug mode), run `_sphere_run_curvature` and return `grad` and `rotated`.
- Add handler for `type === 'curvature'`:
  - Runs `_sphere_run_curvature` on demand and posts `{ type: 'curvature', grad, rotated }`.

#### [MODIFY] [validate_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/validate_detector.py)
- Validate `@main` candidate recovery against JAX.
- Validate `@curvature` `grad` and `rotated` recovery against JAX.

---

### Component 2: WGSL Curvature Determinants & Point Opacity (`renderer/`, `web/`)

#### [MODIFY] [cloud.wgsl](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/cloud.wgsl)
- Update vertex shader `@vertex fn point`:
  - Inputs: `@location(0) position: vec3f`, `@location(1) color: vec3f`, `@location(2) rotated: vec4f`.
  - Compute determinant: `let det = rotated.x * rotated.w - rotated.y * rotated.z;`.
  - Check convexity & inwards:
    `let is_convex = (det > 0.0) && (rotated.x >= 0.0);`
    `let is_inward = is_convex && (rotated.x >= rotated.w);`
  - Compute `alpha = select(1.0, select(0.5, 1.0, is_inward), has_rotated);`.
  - Return `PointOut(p, vec4f(color, alpha))`.
- Update fragment shader `@fragment fn point_color(in: PointOut) -> @location(0) vec4f { return in.color; }`.

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Update `point_pipeline`:
  - Stride 40 (10 floats: 3 position, 3 color, 4 rotated).
  - Blend state: `Some(wgpu::BlendState::ALPHA_BLENDING)`.
  - Fragment entry: `"point_color"`.
- Update `set_cloud`:
  - Support stride 10 natively.
  - Support stride 6 with automatic padding `[0, 0, 0, 0]` for backwards compatibility.

#### [MODIFY] [geometry.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/geometry.js)
- Update `pointCloud(depth, rgba, spread = 1, step = 1, rotated = null)`:
  - If `rotated` is provided, append `[rotated[i*4], rotated[i*4+1], rotated[i*4+2], rotated[i*4+3]]` to each point.
  - Otherwise append `[0, 0, 0, 0]`.
- Update `cloudBounds` and `computeViewportPinchScale` to handle stride 10 or 6.

#### [MODIFY] [app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- Store `lastGrad` and `lastRotated`.
- When debug mode is active or toggled on, request curvature from inference worker if not already cached.
- Update point cloud with `lastRotated` to trigger WGSL opacity shading.

---

### Component 3: Wasm Level Curve Engine (`renderer/src/lib.rs`)

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Add state to `Renderer`:
  - `depth_data: Option<Vec<f32>>` (518 × 392 depth map).
  - `depth_range: (f32, f32)` (`[lo, hi]`).
  - `depth_spread: f32`.
  - `base_lines: Vec<f32>` (retains detection outlines).
- Add methods:
  - `set_depth_map(&mut self, depth: &[f32], min_depth: f32, max_depth: f32, spread: f32)`.
  - `set_spread(&mut self, spread: f32)`.
  - `update_grab_level_curve(&mut self, mx: f32, my: f32, mz: f32) -> Option<Vec<f32>>`:
    - Marching squares contour extraction in Rust at level corresponding to grab depth.
    - 3D pinhole projection to model space.
    - Closest-point search against grab model position.
    - Updates line buffer (`base_lines` + contour).
    - Returns `Some(vec![cx, cy, cz])`.
  - `clear_grab_level_curve(&mut self)`: restores `base_lines`.

---

### Component 4: XR Interaction & Visual Feedback (`web/`)

#### [MODIFY] [xr-feedback.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-feedback.js)
- When `isSingleDebugGrab` is true:
  - Draw outer translucent sphere at grab position: `pushSphere(vertices, marker.position, 0.045, [1, 1, 1], 0.18)`.
  - Animate solid interior bead from `marker.position` toward `closestPointWorld`:
    - Smooth ease-out interpolation over ~300ms.
    - Render solid bead at animated position: `pushSphere(vertices, C_bead, 0.009, [1, 1, 1], 1.0)`.

#### [MODIFY] [xr-grab.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-grab.js)
- Pass `isDebug` callback option.
- When `isDebug()` is true:
  - If single hand: bypass `grab.update()`, pass `{ markers, isSingleDebugGrab: true }`.
  - If two hands: call `grab.update(hands)`, pass `{ markers, isSingleDebugGrab: false }`.

#### [MODIFY] [viewer.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/viewer.js)
- Expose `setDepthMap(depth, minDepth, maxDepth, spread)` and `setSpread(spread)`.
- In XR frame loop:
  - If single grab in debug mode: compute model grab position, call `renderer.update_grab_level_curve`, and pass closest point to feedback.
  - If double grab or release: call `renderer.clear_grab_level_curve()`.

---

### Component 5: Tests & Verification

#### [MODIFY] [tests/geometry.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/geometry.test.js)
- Verify `pointCloud` output formatting with `rotated` data (10 floats per vertex).
- Verify `cloudBounds` and `computeViewportPinchScale` handle stride 10.

#### [MODIFY] [tests/detector.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/detector.test.js)
- Test `_sphere_run` for `@main`.
- Test `_sphere_run_curvature` for `@curvature`, checking `grad` and `rotated` shapes and values.

#### [MODIFY] [tests/xr-grab.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-grab.test.js)
- Verify debug single grab keeps cloud transform static while double grab navigates.

#### [MODIFY] [tests/xr-feedback.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-feedback.test.js)
- Verify feedback renders translucent outer shell and solid animated bead.

---

## Verification Plan

### Automated Tests
1. `.venv/bin/python scripts/export_detector.py`: build multi-function MLIR and VMFB.
2. `sh scripts/build_detector.sh`: compile Wasm IREE runtime with `_sphere_run_curvature`.
3. `.venv/bin/python scripts/validate_detector.py`: validate `@main` and `@curvature` outputs against JAX.
4. `sh scripts/build_wasm.sh && python3 scripts/stage_web.py`: build Rust Wasm renderer.
5. `npm test`: run entire unit test suite.

### Manual Verification
1. Load image, run inference: verify sphere candidates render as usual.
2. Toggle Debug mode: verify `grad` and `rotated` are retrieved, points failing concavity in WGSL render at half opacity (`0.5`).
3. In VR:
   - Single grab: verify level curve slices at grab depth and bead animates to closest point without scene motion.
   - Double grab: verify two-hand rotation/scaling/panning functions without level curves.
