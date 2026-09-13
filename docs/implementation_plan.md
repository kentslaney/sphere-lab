# Level Curve Multi-Grab Suppression and Curvature Vector Visualization

## Problem Statement
1. **Multi-grab level curves**: Currently, when two hands pinch in VR (or multiple pointers are active), level curves are still displaying for each grab. Level curves should be displayed only for a single grab in debug mode. Double grab navigates without displaying any level curves.
2. **Curvature vectors at selected point**: For the selected point along a level curve (the closest point on the contour to the grab), plot:
   - The normalized 2D direction of the gradient $\hat{\mathbf{g}} = \text{basis}_0 = \frac{\nabla D}{\|\nabla D\|}$.
   - The diagonal terms in `rotated` ($da2 = R_{00}$, $db2 = R_{11}$) as a single normalized vector with respect to the rotated gradient:
     $\mathbf{v}_2 = \frac{da2 \cdot \text{basis}_0 + db2 \cdot \text{basis}_1}{\sqrt{da2^2 + db2^2}}$.

## Proposed Changes

### 1. `web/geometry.js`
- Implement `curvatureVectorLines(closestPoint, grad, rotated, arrowLength = 0.08)`:
  - Inverts $(c_x, c_y, c_z)$ to image raster coordinates $(x, y)$.
  - Bilinearly samples `grad` ($g_y, g_x$) and `rotated` ($da2 = R_{00}, db2 = R_{11}$).
  - Computes $\text{basis}_0 = (\hat{g}_x, \hat{g}_y)$ and $\text{basis}_1 = (\hat{g}_y, -\hat{g}_x)$.
  - Normalizes $(da2, db2)$ to $(w_0, w_1)$ and rotates:
    $v_{2,x} = w_0 \hat{g}_x + w_1 \hat{g}_y$, $v_{2,y} = w_0 \hat{g}_y - w_1 \hat{g}_x$.
  - Maps both 2D vectors to 3D tangent vectors:
    $\mathbf{v}_1 = [\hat{g}_x, -\hat{g}_y, 0]$ (emerald green `[0.2, 1.0, 0.3]`).
    $\mathbf{v}_2 = [v_{2,x}, -v_{2,y}, 0]$ (magenta `[1.0, 0.25, 0.75]`).
  - Generates 3D line segments with stems and barbs.
- Update `grabLevelCurveLines(depth, range, spread = 1, grabPositions = [], grad = null, rotated = null)`:
  - Guard `if (!depth || !range || !grabPositions || grabPositions.length !== 1) return new Float32Array();`.
  - When `closest` is found, append both the small marker sphere and `curvatureVectorLines(...)`.

### 2. `renderer/src/lib.rs`
- Add `grad_data: Option<Vec<f32>>` and `rotated_data: Option<Vec<f32>>` to `Renderer`.
- Implement `pub fn set_curvature(&mut self, grad: &[f32], rotated: &[f32])`.
- Add helper `curvature_vector_lines(closest: [f32; 3], grad: &[f32], rotated: &[f32], arrow_len: f32) -> Vec<f32>`.
- In `update_grab_level_curve(mx, my, mz)`:
  - When `closest` point is computed, generate the curvature vector lines and append to `combined` line buffer.
- Recompile Wasm with `sh scripts/build_wasm.sh && python3 scripts/stage_web.py`.

### 3. `web/viewer.js`
- In VR grab callback:
  - When `isSingleDebugGrab` is true: call `renderer.update_grab_level_curve(modelPos[0], modelPos[1], modelPos[2])`.
  - When `isSingleDebugGrab` is false (including double grab): call `renderer.clear_grab_level_curve()`.
  - Do not call `options.onGrabMove` with grab points during VR session to avoid triggering JS marching squares or clobbering `base_lines`.
- Expose `setCurvature(grad, rotated)` on viewer object.

### 4. `web/app.js`
- In `updateLines()`:
  - Ensure `if (!debugMode || currentGrabs.length !== 1 || !depth || !range) { viewer.setLines(baseLines); return; }`.
  - Pass `lastGrad` and `lastRotated` to `grabLevelCurveLines(depth, range, spread, currentGrabs, lastGrad, lastRotated)`.
- In worker `curvature` handler and `rebuild()`:
  - Pass `viewer.setCurvature(lastGrad, lastRotated)`.

### 5. `tests/geometry.test.js`
- Add unit test for `curvatureVectorLines`.
- Add unit tests verifying `grabLevelCurveLines` returns empty array for multiple grabs (`grabPositions.length > 1`) and includes vector arrows when curvature is provided.

## Verification Plan
### Automated Tests
- Run `npm test` (all tests passing including new vector tests).
- Run `PYTHONPATH=sphere-detector/src .venv/bin/python scripts/validate_detector.py`.
