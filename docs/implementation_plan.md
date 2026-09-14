# Export Scatter Locations, 3D Center Estimates, Debug Selection Plotting & VR Flying Centers Toggle

## 1. Overview & Problem Description

The user requested:
1. **Export the scatter locations for each pixel** and **calculate the expected corresponding depth for each**, resulting in a **3D point for the center estimate of each pixel that passes the convexity condition**.
2. In **debug mode, plot that point when a pixel is selected**.
3. **Add a VR context menu toggle that causes the pixels to fly between their original position and their center estimates**.
4. The **debug menu option should be greyed out/disabled while all the centers are being displayed**.

This integrates second-order differential geometry from the sphere detector directly into the WebGPU visualization pipeline:
- The full pixel-wise scatter center map $(x_c, y_c, z_c)$ is exported from the StableHLO/IREE detector pipeline.
- When an individual point is selected in debug mode (via XR gesture, 3D pointer grab, or 2D canvas click), its estimated 3D sphere center is plotted with a connecting ray and sphere wireframe.
- When the VR context menu's new toggle (`centers` $\leftrightarrow$ `surface`) is activated, all convex pixels smoothly animate ("fly") in parallel via WebGPU shaders between their original surface depth positions and their 3D center estimates, while the `debug` menu option is disabled and greyed out.

---

## 2. Mathematical Derivation

### Surface Geometry & Rotated Hessian
Given the metric depth surface $z(x, y)$ (where $z = 1 / \text{relative\_inverse\_depth}$), let:
- $\nabla z = (\partial_x z, \partial_y z)$ be the spatial depth gradient (in `grad`: $[g_y, g_x]$).
- $\text{rotated}$ be the $2 \times 2$ Hessian rotated into the intrinsic frame formed by the normalized gradient $\mathbf{n} = \nabla z / \|\nabla z\|$ and tangent $\mathbf{t} = \mathbf{n}^\perp$:
  $$\text{rotated} = \begin{pmatrix} da2 & c \\ c & db2 \end{pmatrix}$$
  where:
  - $da2 = \text{rotated}[0, 0]$ is the normal curvature along the gradient direction (units: $\Delta z / \text{px}^2$).
  - $db2 = \text{rotated}[1, 1]$ is the curvature along the level curve isocontour (units: $\Delta z / \text{px}^2$).

### 2D Scatter Location $(x_c, y_c)$
For an osculating circle of the level curve on the image plane:
$$\text{radius of level curve} = \rho = \frac{\|\nabla z\|}{db2}$$
The 2D center offset along the inward gradient direction is $-\frac{\nabla z}{db2}$:
$$x_c = x - \frac{\partial_x z}{db2}, \quad y_c = y - \frac{\partial_y z}{db2}$$
In `sphere-detector/src/sphere_detector/detect.py`, this is identically `depth.centers` (which is scattered by `Scatter2d` to form the accumulator bins).

### Convexity Condition
A pixel corresponds to a convex spherical dome bulging towards the camera (smaller depth $z$ at the apex, larger depth at the equator) if and only if:
1. $\det(\text{rotated}) = da2 \cdot db2 - c^2 > 0$ and $da2 \ge 0$ (`depth.convex`, ensuring positive definite curvature).
2. $da2 \ge db2 > 0$ (`depth.inwards`, ensuring the surface curves inwards toward the sphere axis and avoids hyperbolic or inverted saddles).
3. If not convex (or $da2 - db2 \le 10^{-6}$ or $db2 \le 10^{-6}$), the pixel does not possess a valid sphere center estimate and is masked with `NaN`.

### Expected Center Depth $z_c$
A sphere of 3D radius $R_{3D}$ with center at $(x_c, y_c, z_c)$ has surface:
$$z(x, y) = z_c - \frac{\sqrt{R_{3D}^2 - \rho^2}}{w}$$
Differentiating along the radial direction gives the depth offset $\Delta z = z_c - z$:
$$\Delta z = \frac{\|\nabla z\|^2}{da2 - db2}$$
Thus, the expected corresponding depth for the sphere center is:
$$z_c = z + \Delta z = z + \frac{\|\nabla z\|^2}{da2 - db2}$$

> [!NOTE]
> **Numerical Verification**:
> Tested on the ground-truth synthetic sphere ($x_0 = 259, y_0 = 196, z_0 = 3.0, R = 65, w = 80$):
> Across all radii and angles, the formulas yield $(x_c, y_c) \approx (259.00, 196.00)$ and $z_c \approx 2.998$ (absolute error $< 0.01\text{ px}$ in 2D and $< 0.002$ in depth). Flat background pixels yield `NaN`.

### 3D Center Point in Spatial Display Coordinates
Using the camera projection intrinsic to the viewer (`pointAt` / `point_at`):
$$Z_{\text{disp}} = \text{displayZ}(z_c, \text{range}, \text{spread})$$
$$X_c = (x_c - \frac{W-1}{2}) \cdot \frac{Z_{\text{disp}}}{f}, \quad Y_c = (\frac{H-1}{2} - y_c) \cdot \frac{Z_{\text{disp}}}{f}, \quad Z_c = 2 - Z_{\text{disp}}$$
where $f = \frac{W}{2 \tan(30^\circ)}$. This maps $(x_c, y_c, z_c)$ to the 3D model/world position $[X_c, Y_c, Z_c]$.

---

## 3. Proposed Changes

### Component 1: Detector Export & Wasm Runtime

#### [MODIFY] [export_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/export_detector.py)
- Define `@jax.jit def centers(relative_inverse_depth)`:
  - Computes `depth.centers` ($y_c, x_c$) and expected depth $z_c = z + \frac{\|\nabla z\|^2}{da2 - db2}$.
  - Masks non-convex pixels with `NaN`.
  - Returns `centers_3d` with shape `[392, 518, 3]` ordered as $[x_c, y_c, z_c]$.
- Lower `centers` to StableHLO, namespace private functions with `@_cent_`, and combine into `sphere-detector.mlir` and `sphere-detector.vmfb`.
- Update `sphere-detector.json` with the new `@centers` entry.

#### [MODIFY] [runtime/sphere_runtime.c](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/sphere_runtime.c)
- Add `static iree_vm_function_t centers_function;` and look up `@centers` in `sphere_init`.
- Implement `sphere_run_centers(const float* input, unsigned int count, float* centers_out)`:
  - Invokes `centers_function` and transfers `392 * 518 * 3 * sizeof(float)` to `centers_out`.

#### [MODIFY] [runtime/CMakeLists.txt](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/CMakeLists.txt)
- Add `'_sphere_run_centers'` to `-sEXPORTED_FUNCTIONS`.

#### [MODIFY] [web/inference-worker.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/inference-worker.js)
- When computing curvature in debug mode or on demand, allocate memory and run `_sphere_run_centers`.
- Return `centers` (`Float32Array [392, 518, 3]`) alongside `grad` and `rotated`.

---

### Component 2: Flying Pixel Animation & Point Cloud Shader

#### [MODIFY] [renderer/src/cloud.wgsl](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/cloud.wgsl)
- Update `Uniforms` struct:
  ```wgsl
  struct Uniforms { mvp: mat4x4f, model: mat4x4f, params: vec4f }
  ```
  where `params.x` is `anim_t` ($0.0 \to 1.0$).
- Extend point vertex layout to include center estimate:
  ```wgsl
  @vertex fn point(
      @location(0) position: vec3f,
      @location(1) color: vec3f,
      @location(2) rotated: vec4f,
      @location(3) center: vec4f,
      @builtin(vertex_index) index: u32
  ) -> PointOut
  ```
  where `center.xyz` is the 3D center estimate in model coordinates, and `center.w` is $1.0$ if convex, $0.0$ if non-convex.
- In `point`:
  - When $t = \text{params.x} > 0.0$:
    - For convex points (`center.w > 0.5`), interpolate position:
      `let current_pos = mix(position, center.xyz, t);`
    - For non-convex points (`center.w <= 0.5`), keep position and fade opacity:
      `alpha = alpha * (1.0 - t);`
  - When $t = 0.0$: exact original surface point cloud.
  - When $t = 1.0$: all convex pixels have flown to their exact 3D center estimates!

#### [MODIFY] [renderer/src/lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Update uniform buffer allocation from 128 bytes to 144 bytes (to accommodate `params: vec4f`).
- In `set_cloud`: accept stride 14 (`[X, Y, Z, R, G, B, R00, R01, R10, R11, CX, CY, CZ, Valid]`), while continuing to support stride 10 and 6 as fallbacks.
- Add `pub fn set_center_animation(&mut self, t: f32)` to set `self.center_anim_t` which is written into `uniforms[32]` each frame.
- Implement `center_estimate_lines` in Rust for debug point selection plotting.

---

### Component 3: VR Context Menu & Debug Option Disabling

#### [MODIFY] [web/xr-menu.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-menu.js)
- Update `getMenuItems(debug = false, centers = false)`:
  - Returns `['config', debug ? 'reset' : 'debug', centers ? 'surface' : 'centers', 'Cancel']`.
- Update `menuPixels(selected, items, hint, disabledIndices = [])`:
  - Items in `disabledIndices` are drawn with gray text (`#9aa0a6` instead of `#000000`).
  - Disabled rows do NOT display the highlight selection box when hovered.
- Update `menuVertices` anchor row so `'Cancel'` remains anchored at hand height:
  - `anchorRow = items.length - 1` (row index 3 for a 4-item menu).

#### [MODIFY] [web/viewer.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/viewer.js)
- Track `centersActive` (boolean) and `centerAnimT` ($0.0 \leftrightarrow 1.0$).
- When `centersActive` is true (centers being displayed):
  - Pass `disabledIndices: [1]` to `menuPixels`.
  - If the user selects row 1 ('debug'/'reset'), ignore it because it is disabled!
- Handle row 2: toggling `centersActive = !centersActive`.
- In the frame animation loop:
  - Smoothly interpolate `centerAnimT` towards target (1.0 when `centersActive`, 0.0 when false) over ~1.0s.
  - Call `renderer.set_center_animation(centerAnimT)`.

---

### Component 4: Point Selection Plotting in Debug Mode

#### [MODIFY] [web/geometry.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/geometry.js)
- Update `pointCloud(depth, rgba, spread, step, rotated, centers)`:
  - If `centers` (shape $[392, 518, 3]$) is passed, project each pixel's center estimate to model space using `pointAt(xc, yc, zc, range, spread)`.
  - Emit 14 floats per point: `[...pt, ...color, ...rot, ...cPt, isValid ? 1.0 : 0.0]`.
- Add `pixelCenterEstimate(x, y, depthMap, grad, rotated, range, spread = 1)`:
  - Returns `{ xc, yc, zc, center3D, isConvex }`.
- In `grabLevelCurveLines`:
  - When `closest` surface point is selected, evaluate its center estimate.
  - If convex, append a connecting ray line and a wireframe sphere marker (`smallSphereLines(center3D, 0.015, [1.0, 0.75, 0.2])`).

#### [MODIFY] [web/app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- Store `lastCenters` received from worker and pass to `pointCloud` on rebuild.
- In debug mode, allow clicking directly on `#depth` or `#photo` preview canvases to select that pixel in 3D:
  - Finds depth $d$, computes `pointAt(x, y, d, range, spread)`, sets `currentGrabs = [pt]`, and updates lines.

---

### Component 5: Tests & Validation

#### [MODIFY] [scripts/validate_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/validate_detector.py)
- Validate `@centers` on synthetic sphere:
  - Verify JAX `centers(d)` vs IREE VMVX `actual_centers` match with high precision.
  - Verify ground-truth center recovery $(259, 196, 3.0)$ across the sphere.

#### [MODIFY] [tests/geometry.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/geometry.test.js)
- Test `pixelCenterEstimate` against synthetic sphere fixtures.
- Test `pointCloud` with 14-float stride when `centers` is provided.
- Test `grabLevelCurveLines` includes center connecting line and sphere.

#### [MODIFY] [tests/config.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/config.test.js)
- Test 4-item menu: `getMenuItems(debug, centers)`.
- Test `menuPixels` with `disabledIndices: [1]`.

---

## 4. Verification Plan

### Automated Tests
1. `sh scripts/build_detector.sh` (builds StableHLO, IREE VMVX, and Wasm runtime).
2. `sh scripts/build_wasm.sh` (builds Rust WebGPU renderer Wasm).
3. `python3 scripts/stage_web.py` (stages assets into `web/`).
4. `.venv/bin/python scripts/validate_detector.py` (cross-backend verification).
5. `npm test` (all unit tests, ensuring 63+ pass).

### Manual / Browser Verification
- In desktop / 2D mode:
  - Toggle debug mode. Select a pixel/point: confirm the level curve, surface bead, and the 3D center estimate point (connecting ray + center sphere) appear.
- In VR context menu:
  - Confirm menu shows `['config', 'debug', 'centers', 'Cancel']`.
  - Toggle `centers`: confirm pixels smoothly fly into their center estimates, and the `debug` menu option is greyed out and disabled.
  - Toggle `surface`: confirm pixels smoothly fly back to their original positions, and `debug` becomes enabled again.
