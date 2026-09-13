# Implementation Plan: IREE Concavity Export, Point Cloud Opacity & Wasm Level Curves

Export concavity/curvature data from the IREE sphere-detector pipeline, render non-concave points with half opacity (`alpha = 0.5`) in WebGPU, move 3D depth level curve calculation and closest-point search from JavaScript into Rust/Wasm (`cube_renderer`), update VR interaction so single grab inspects level curves without moving the scene, allow double grab to navigate without displaying curves, and animate the grab feedback bead to the closest point on the curve.

## User Review Required

> [!IMPORTANT]
> - **Dual Output from IREE Detector**: `sphere-detector.vmfb` will now export two outputs: `[8, 7]` candidate sphere parameters, and `[392, 518]` float32 concavity mask (`raster.depth.inwards`). `sphere_runtime.c` is updated to support optional transfer of both outputs.
> - **Point Cloud Opacity Shading**: The WebGPU point pipeline is upgraded from stride 24 (`vec3f` color, no blending) to stride 28 (`vec4f` color with `ALPHA_BLENDING`). Points failing the concavity test are rendered with `alpha = 0.5`, while valid concave points are `alpha = 1.0`.
> - **Navigation Change in Debug Mode**: When debug mode is active, single-hand pinch in VR will no longer move or pan the scene. Instead, it will dynamically slice the level curve at the hand's depth and guide the solid bead to the closest point on the contour. Two-hand pinch (double grab) still pans, rotates, and scales the cloud, but suppresses level curve rendering.
> - **Wasm Level Curve Engine**: The depth field is stored in `cube-renderer` in Wasm, and marching squares contours plus closest-point projections run directly in Rust, updating the GPU line vertex buffer with zero JS-to-Wasm line buffer serialization overhead.

---

## Proposed Changes

### Component 1: IREE Model & Detector Runtime (`scripts/`, `runtime/`, `web/`)

#### [MODIFY] [export_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/export_detector.py)
- Update `@jax.jit def detect(relative_inverse_depth)`:
  - Instantiate `raster = Raster(None, relative_inverse_depth, resolution=(HEIGHT, WIDTH))`.
  - Obtain `surface = raster.opt().surface`.
  - Retain `candidates` `[8, 7]` formatting.
  - Extract concavity mask: `concavity = raster.depth.inwards.astype(jnp.float32)` (shape `[392, 518]`).
  - Return `(candidates, concavity)`.
- Update `sphere-detector.json` metadata to document both outputs (`[8, 7]` and `[392, 518]`).
- Re-export `sphere-detector.mlir` and compile to `models/sphere-detector.vmfb`.

#### [MODIFY] [sphere_runtime.c](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/sphere_runtime.c)
- Update `sphere_run` signature:
  `int sphere_run(const float* input, unsigned int count, float* output, float* concavity)`
- Allocate `outputs` list with capacity 2:
  `TRY(iree_vm_list_create(iree_vm_make_undefined_type_def(), 2, allocator, &outputs));`
- Transfer output 0 (`56 * sizeof(float)`) to `output`.
- If `concavity != NULL`:
  - Retrieve buffer view 1 (`392 * 518 * sizeof(float)`).
  - Transfer buffer view 1 to `concavity`.
- Recompile with `sh scripts/build_detector.sh`.

#### [MODIFY] [inference-worker.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/inference-worker.js)
- Allocate concavity buffer in Wasm memory: `concavity = runtime._malloc(392 * 518 * 4)`.
- Call `runtime._sphere_run(input, depth.length, output, concavity)`.
- Slice concavity mask: `const concavityMask = runtime.HEAPF32.slice(concavity / 4, concavity / 4 + 392 * 518)`.
- Post result with concavity:
  `postMessage({id, type: 'result', candidates, concavity: concavityMask, elapsed: ...}, [candidates.buffer, concavityMask.buffer])`.
- Free concavity buffer in `finally` block.

#### [MODIFY] [validate_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/validate_detector.py)
- Unpack `expected_candidates, expected_concavity = detect(d)`.
- Unpack `actual_candidates, actual_concavity = ctx.modules[module.name].main(d)`.
- Verify shape and consistency of both outputs across JAX and native IREE VMVX.

---

### Component 2: Point Cloud Opacity & Shading (`renderer/`, `web/`)

#### [MODIFY] [cloud.wgsl](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/cloud.wgsl)
- Update `PointOut` to carry `color: vec4f`:
  ```wgsl
  struct PointOut { @builtin(position) position: vec4f, @location(0) color: vec4f }
  @vertex fn point(@location(0) position: vec3f, @location(1) color: vec4f,
                  @builtin(vertex_index) index: u32) -> PointOut {
      let corners = array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
      var p = uniforms.mvp * vec4f(position,1);
      p = vec4f(p.xy + corners[index] * 0.0028 * p.w, p.zw);
      return PointOut(p, color);
  }
  @fragment fn point_color(in: PointOut) -> @location(0) vec4f { return in.color; }
  ```

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Update `point_pipeline`:
  - `array_stride: if is_point || is_shell || is_hud { 28 } else { 24 }`.
  - `attributes: if is_point || is_shell || is_hud { &rgba_attributes } else { &rgb_attributes }`.
  - `blend: if is_point || is_shell || is_hud { Some(wgpu::BlendState::ALPHA_BLENDING) } else { None }`.
  - `entry_point: Some(if is_point { "point_color" } else if is_shell || is_hud { "shell_color" } else { "color" })`.
- Update `set_cloud`:
  - Accept 7-float stride points (`points.len() % 7 == 0`), computing `cloud_count = (points.len() / 7) as u32`.
  - Also provide backward-compatible fallback if 6-float stride is passed (expand to stride 7 with alpha 1.0).

#### [MODIFY] [geometry.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/geometry.js)
- In `pointCloud(depth, rgba, spread = 1, step = 1, concavity = null)`:
  - If `concavity` is provided, set `alpha = concavity[i] > 0.5 ? 1.0 : 0.5`. If null, `alpha = 1.0`.
  - Push 7 values per point: `[...pointAt(x, y, d, range, spread), r, g, b, alpha]`.
- Update `cloudBounds` and `computeViewportPinchScale` to dynamically support stride 7 (or 6).

#### [MODIFY] [app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- Cache `lastConcavity` from detector result.
- Re-run `pointCloud(lastDepth, rgba, spread, step, lastConcavity)` when concavity becomes available or spread changes, updating point opacity in real-time.

---

### Component 3: Wasm Level Curve Engine (`renderer/src/lib.rs`)

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Add state to `Renderer`:
  - `depth_data: Option<Vec<f32>>` (518 × 392 depth map).
  - `depth_range: (f32, f32)` (`[lo, hi]`).
  - `depth_spread: f32`.
  - `base_lines: Vec<f32>` (retains detection sphere outlines).
- Add methods:
  - `set_depth_map(&mut self, depth: &[f32], min_depth: f32, max_depth: f32, spread: f32)`: stores depth map and calibration in Wasm.
  - `set_spread(&mut self, spread: f32)`: updates depth spread without re-uploading the depth buffer.
  - `update_grab_level_curve(&mut self, grab_model_x: f32, grab_model_y: f32, grab_model_z: f32) -> Option<Vec<f32>>`:
    - Inverts display depth from $Z$: $z_{\text{disp}} = 2 - z_m$, $t = \frac{\frac{1}{1 - z_m / \text{spread}} - 0.45}{1.55}$, $d = \text{lo} + t (\text{hi} - \text{lo})$.
    - Runs marching squares contour extraction on `depth_data` at level $d$ with step size 2.
    - Projects 2D contour points to 3D model space via pinhole formula.
    - Finds closest point $C_{\text{model}}$ on the contour segments to $[gx, gy, gz]$.
    - Combines `base_lines` + `contour_lines` and updates `self.lines` vertex buffer.
    - Returns `Some(vec![cx, cy, cz])`.
  - `clear_grab_level_curve(&mut self)`: resets `self.lines` back to `self.base_lines`.
  - Update `set_lines`: stores input into `self.base_lines` as well as uploading to GPU.

---

### Component 4: XR Interaction & Visual Feedback (`web/`)

#### [MODIFY] [xr-feedback.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-feedback.js)
- Update `grabFeedbackVertices(markers, viewerPos, closestPointWorld = null, isSingleDebugGrab = false)`:
  - When `isSingleDebugGrab` is true and `markers.length === 1`:
    - Draw outer translucent sphere at grab position: `pushSphere(vertices, marker.position, 0.045, [1, 1, 1], 0.18)`.
    - Animate solid interior bead from `marker.position` toward `closestPointWorld`:
      - Smooth ease-out interpolation over ~300ms.
      - Render solid interior bead at animated position: `pushSphere(vertices, C_bead, 0.009, [1, 1, 1], 1.0)`.

#### [MODIFY] [xr-grab.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-grab.js)
- Accept `isDebug` callback option in `attachCloudGrab`:
  - When `isDebug()` is true:
    - If `activeEntries.length === 1`:
      - Release `grab` navigation (`grab.release()`), keeping cloud translation, rotation, and scale static.
      - Pass `{ markers, isSingleDebugGrab: true }` to feedback callback.
    - If `activeEntries.length === 2`:
      - Call `grab.update(hands)` to allow two-hand navigation (pan, rotate, scale).
      - Pass `{ markers, isSingleDebugGrab: false }` to feedback callback (measurement line active, no level curves).

#### [MODIFY] [viewer.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/viewer.js)
- Expose `setDepthMap(depth, minDepth, maxDepth, spread)` and `setSpread(spread)` on viewer instance.
- Track `debugMode`.
- In XR frame loop:
  - If single grab in debug mode:
    - Compute model-space grab position via inverse grab transform.
    - Call `renderer.update_grab_level_curve(mx, my, mz)`.
    - If closest point $C_{\text{model}}$ is returned:
      - Transform $C_{\text{model}}$ to world space: $C_{\text{world}} = \text{grab.position} + \text{rotate}(\text{grab.rotation}, C_{\text{model}} \times \text{grab.scale})$.
      - Pass $C_{\text{world}}$ to `grabFeedbackVertices(markers, currentViewerPos, C_world, true)`.
  - If double grab (2 hands) or no grab:
    - Call `renderer.clear_grab_level_curve()`.
    - Render standard feedback.

---

### Component 5: Tests & Verification

#### [MODIFY] [tests/geometry.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/geometry.test.js)
- Verify `pointCloud` emits 7 floats per vertex with `alpha = 1.0` (or `alpha = 0.5` when `concavity` flag indicates non-concave).
- Verify `cloudBounds` handles 7-float stride.

#### [MODIFY] [tests/detector.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/detector.test.js)
- Update test to run `_sphere_run` with `out` and `concavity` buffer, asserting that concavity is populated with finite binary values (0.0 or 1.0).

#### [MODIFY] [tests/xr-grab.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-grab.test.js)
- Add test verifying that in debug mode, single grab does not mutate cloud position or scale, while double grab still navigates.

#### [MODIFY] [tests/xr-feedback.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-feedback.test.js)
- Add test verifying `grabFeedbackVertices` renders the translucent shell at grab position and solid bead animating toward `closestPointWorld`.

---

## Verification Plan

### Automated Tests
1. `.venv/bin/python scripts/export_detector.py`: compiles dual-output VMFB.
2. `sh scripts/build_detector.sh`: compiles Wasm IREE runtime with concavity extraction.
3. `.venv/bin/python scripts/validate_detector.py`: asserts candidate detection and concavity export match between JAX and IREE VMVX.
4. `sh scripts/build_wasm.sh && python3 scripts/stage_web.py`: builds Rust Wasm renderer.
5. `npm test`: executes test suite verifying geometry (7-stride opacity), detector runtime, xr-grab single/double behavior, and xr-feedback animation.

### Manual Verification
1. Open web application, load image with depth inference.
2. Observe point cloud: verify points failing concavity test appear translucent (`alpha = 0.5`) against the concave regions.
3. Enter VR / debug mode:
   - Perform single grab: verify the cloud remains stationary, a level curve appears at the grab depth, the grab point shows the translucent shell, and the solid bead snaps/animates to the closest point on the contour.
   - Perform double grab: verify two-hand navigation (panning/scaling/rotating) works smoothly and level curves disappear.
