# Implementation Plan: Wasm Level Curves & Single Grab Debug Inspection

Move 3D depth level curve calculation and closest-point search from JavaScript into Rust/Wasm (`cube_renderer`), update VR interaction so single grab inspects level curves without moving the scene, allow double grab to navigate without displaying curves, and animate the grab feedback bead to the closest point on the curve.

## User Review Required

> [!IMPORTANT]
> - **Navigation Change in Debug Mode**: When debug mode is active, single-hand pinch in VR will no longer move or pan the scene. Instead, it will dynamically slice the level curve at the hand's depth and guide the solid bead to the closest point on the contour. To move, scale, or rotate the scene, the user can use a two-hand pinch (double grab).
> - **Wasm Level Curve Engine**: The depth field is stored in `cube-renderer` in Wasm, and marching squares contours plus closest-point projections run directly in Rust, updating the GPU line vertex buffer with zero JS-to-Wasm line buffer serialization overhead.

## Proposed Changes

### Component: Rust Wasm Renderer (`renderer/`)

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Add state to `Renderer`:
  - `depth_data: Option<Vec<f32>>` (518 × 392 depth map).
  - `depth_range: (f32, f32)` (`[lo, hi]`).
  - `depth_spread: f32`.
  - `base_lines: Vec<f32>` (retains detection outlines so they aren't lost when drawing/clearing level curves).
- Add methods:
  - `set_depth_map(&mut self, depth: &[f32], min_depth: f32, max_depth: f32, spread: f32)`: stores depth map and calibration in Wasm.
  - `set_spread(&mut self, spread: f32)`: updates depth spread without re-uploading the depth buffer.
  - `update_grab_level_curve(&mut self, grab_model_x: f32, grab_model_y: f32, grab_model_z: f32) -> Option<Vec<f32>>`:
    - Inverts display depth from $Z$: $z_{\text{disp}} = 2 - z_m$, $t = \frac{\frac{1}{1 - z_m / \text{spread}} - 0.45}{1.55}$, $d = \text{lo} + t (\text{hi} - \text{lo})$.
    - Runs marching squares contour extraction on `depth_data` at level $d$ with step size 2.
    - Projects 2D contour points to 3D model space via `point_at`.
    - Finds closest point $C_{\text{model}}$ on the contour segments to $[gx, gy, gz]$.
    - Combines `base_lines` + `contour_lines` and updates `self.lines` vertex buffer.
    - Returns `Some(vec![cx, cy, cz])`.
  - `clear_grab_level_curve(&mut self)`: resets `self.lines` back to `self.base_lines`.
  - Update `set_lines`: stores input into `self.base_lines` as well as uploading to GPU.

---

### Component: XR Interaction & Feedback (`web/`)

#### [MODIFY] [xr-feedback.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-feedback.js)
- Update `grabFeedbackVertices(markers, viewerPos, closestPointWorld = null, isSingleDebugGrab = false)`:
  - When `isSingleDebugGrab` is true and `markers.length === 1`:
    - Draw outer translucent sphere at grab position: `pushSphere(vertices, marker.position, 0.045, [1, 1, 1], 0.18)`.
    - Animate solid interior bead from `marker.position` toward `closestPointWorld`:
      - $t = \text{progress}(\text{elapsed} / 300\text{ms})$.
      - If `closestPointWorld` is available, interpolate: $C_{\text{bead}} = \text{marker.position} + (\text{closestPointWorld} - \text{marker.position}) \times t$.
      - Render solid interior bead: `pushSphere(vertices, C_{\text{bead}}, 0.009, [1, 1, 1], 1.0)`.

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
    - If a closest point $C_{\text{model}}$ is returned:
      - Transform $C_{\text{model}}$ to world space: $C_{\text{world}} = \text{grab.position} + \text{rotate}(\text{grab.rotation}, C_{\text{model}} \times \text{grab.scale})$.
      - Pass $C_{\text{world}}$ to `grabFeedbackVertices(markers, currentViewerPos, C_world, true)`.
  - If double grab (2 hands) or no grab:
    - Call `renderer.clear_grab_level_curve()`.
    - Render standard feedback.

#### [MODIFY] [app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- When depth completes or spread changes: forward depth map and calibration to `viewer.setDepthMap(depth, range[0], range[1], spread)`.
- Connect `onDebug` toggle to set debug state on viewer.

---

### Component: Verification & Tests

#### [MODIFY] [tests/xr-grab.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-grab.test.js)
- Add test verifying that in debug mode, single grab does not mutate cloud position or scale, while double grab still navigates.

#### [MODIFY] [tests/xr-feedback.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-feedback.test.js)
- Add test verifying `grabFeedbackVertices` renders the translucent shell at grab position and solid bead animating toward `closestPointWorld`.

## Verification Plan

### Automated Tests
- Run `sh scripts/build_wasm.sh && python3 scripts/stage_web.py` to compile Wasm.
- Run `npm test` to verify all unit tests pass (including XR grab, feedback, and geometry tests).
- Run `.venv/bin/python scripts/validate_detector.py` to confirm inference detector remains valid.

### Manual Verification
- In desktop viewport: test drag in debug mode vs normal mode.
- Verify that single grab creates level curve and solid bead at closest point without moving scene.
- Verify that double grab moves/scales the cloud without displaying curves.
