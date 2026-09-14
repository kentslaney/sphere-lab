# Export Scatter Locations, Calculate Expected Center Depth, and Plot 3D Center Estimate Point in Debug Mode

## 1. Overview & Problem Description

The user requested:
1. **Export the scatter locations for each pixel** and **calculate the expected corresponding depth for each**, resulting in a **3D point for the center estimate of each pixel that passes the convexity condition**.
2. In **debug mode, plot that point when a pixel is selected**.

This task bridges the upstream JAX/differential-geometry sphere detector model and the Web/WebXR visualization pipeline:
- The detector's mathematical foundation uses second-order differential geometry on the depth surface to determine where surface normals and curvatures focus into candidate sphere centers.
- Up to now, only candidate bounding boxes and raw curvature tensors were exported and rendered.
- We will now explicitly compute and export the full pixel-wise scatter center map $(x_c, y_c, z_c)$ from the detector, and when a pixel or point is selected in debug mode (via XR gesture, 3D pointer grab, or 2D canvas click), render that 3D center estimate in the spatial view.

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

### Component 1: Detector Export & Runtime

#### [MODIFY] [export_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/export_detector.py)
- Define `@jax.jit def centers(relative_inverse_depth)`:
  - Computes `depth.centers` ($y_c, x_c$) and expected depth $z_c = z + \frac{\|\nabla z\|^2}{da2 - db2}$.
  - Masks non-convex pixels with `NaN`.
  - Stacks into `centers_3d` with shape `[392, 518, 3]` ordered as $[x_c, y_c, z_c]$ (or returns scatter locations and depth).
- Lower `centers` to StableHLO, namespace private functions with `@_cent_`, and combine into `sphere-detector.mlir` and `sphere-detector.vmfb`.
- Update `sphere-detector.json` with the new `@centers` entry.

#### [MODIFY] [runtime/sphere_runtime.c](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/sphere_runtime.c)
- Add `static iree_vm_function_t centers_function;` and look up `@centers` in `sphere_init`.
- Implement `sphere_run_centers(const float* input, unsigned int count, float* centers_out)`:
  - Invokes `centers_function` and transfers `392 * 518 * 3 * sizeof(float)` to `centers_out`.

#### [MODIFY] [runtime/CMakeLists.txt](file:///Users/kds/Documents/antigravity/sphere-debug/runtime/CMakeLists.txt)
- Add `'_sphere_run_centers'` to `-sEXPORTED_FUNCTIONS`.

---

### Component 2: Geometric Computation & Visualization

#### [MODIFY] [web/geometry.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/geometry.js)
- Add `export function pixelCenterEstimate(x, y, depthMap, grad, rotated, range, spread = 1)`:
  - Computes scatter location $(x_c, y_c)$, verifies convexity, computes expected depth $z_c$, and projects to `center3D` via `pointAt`.
- Add `export function centerEstimateAt(closestPoint, level, grad, rotated, range, spread = 1)`:
  - Inverts model point $[cx, cy, cz]$ to subpixel $(x, y)$, samples `grad` and `rotated`, checks convexity, and computes the 3D center estimate point.
- Update `grabLevelCurveLines`:
  - When `closest` is present and `grad` & `rotated` are supplied, compute the center estimate.
  - If convex, append:
    1. A connecting ray line from surface point `closest` to `center3D` in bright gold (`[1.0, 0.75, 0.2]`).
    2. A wireframe sphere marker at `center3D` (`smallSphereLines(center3D, 0.015, [1.0, 0.75, 0.2])`).

#### [MODIFY] [renderer/src/lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Implement `center_estimate_lines(closest, level, grad, rotated, range, spread)`:
  - Evaluates subpixel $(x, y)$, samples bilinear `grad` and `rotated`, tests convexity $\det > 0, da2 \ge 0, da2 \ge db2 > 0$.
  - Computes $x_c = x - g_x / db2$, $y_c = y - g_y / db2$, $z_c = \text{level} + \frac{g_x^2 + g_y^2}{da2 - db2}$.
  - Projects to `center_pt = point_at(xc, yc, zc, range, spread)`.
  - Returns line vertices for connecting line + small wireframe sphere marker.
- In `update_grab_level_curve`:
  - Append `center_estimate_lines` into `combined` along with level curves and curvature vectors.

#### [MODIFY] [web/app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- In debug mode, allow clicking directly on `#depth` or `#photo` preview canvases to select that pixel:
  - Converts click $(px, py)$ to image coordinates $(x, y)$.
  - Samples depth $d = \text{depth}[y \cdot W + x]$.
  - Calculates 3D point `pointAt(x, y, d, range, spread)` and sets `currentGrabs = [pt]; updateLines();`.

---

### Component 3: Build & Verification Scripts

#### [MODIFY] [scripts/validate_detector.py](file:///Users/kds/Documents/antigravity/sphere-debug/scripts/validate_detector.py)
- Add verification for `@centers`:
  - Run `expected_centers = centers(d)` in JAX and `actual_centers = ctx.modules[module.name].centers(d)` in IREE.
  - Assert that on the synthetic sphere, both backends recover the center $(x_c, y_c, z_c) \approx (259, 196, 3.0)$ with tolerance $< 1\text{ px}$ and $< 0.05$ in depth.
  - Assert that non-convex background pixels match with `NaN`.

#### [MODIFY] [tests/geometry.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/geometry.test.js)
- Test `pixelCenterEstimate` on synthetic sphere fixtures:
  - Verify $(x_c, y_c, z_c)$ matches $(259, 196, 3.0)$ at various test points.
  - Verify flat/concave points return `{ isConvex: false, center3D: null }`.
- Test that `grabLevelCurveLines` produces center estimate line segments and sphere vertices when convexity holds.

#### [MODIFY] [tests/detector.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/detector.test.js)
- Test `_sphere_run_centers` via Wasm runtime against synthetic depth input.

---

## 4. Verification Plan

### Automated Tests
1. **Model & Pipeline Build**:
   - Run `sh scripts/build_detector.sh` to compile `models/sphere-detector.vmfb` with `@main`, `@curvature`, and `@centers`, and rebuild `runtime/generated/sphere_runtime.wasm`.
   - Run `sh scripts/build_wasm.sh` to recompile the Rust renderer into `renderer/pkg/`.
   - Run `python3 scripts/stage_web.py` to stage updated assets into `web/`.
2. **Detector Validation**:
   - Run `.venv/bin/python scripts/validate_detector.py`: ensures geometric recovery of center $(259, 196, 3.0)$ and cross-backend parity.
3. **Unit Tests**:
   - Run `npm test`: ensures all 63 existing tests pass, plus new tests in `tests/geometry.test.js` and `tests/detector.test.js`.

### Manual / Browser Verification
- Open the application, toggle debug mode, and select a point:
  - Verify the level curve, surface bead, curvature vectors, and the new 3D center estimate point (connecting ray + center sphere) are rendered.
  - Verify that selecting a non-convex point gracefully omits the center estimate without errors.
