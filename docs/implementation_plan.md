# Sphere Estimation Wireframe Distortion Analysis, Context Menu Toggle, and Point Selection Gesture

## 1. Mathematical Analysis: Why the Sphere Estimate Wireframe is an Egg (Ovoid)

The sphere estimate wireframe exhibits an asymmetric egg (ovoid) profile with higher curvature (narrower/sharper tip) on the camera-near side and lower curvature (broader/flatter dome) on the camera-far side due to the composition of non-linear transformations and perspective projection:

1. **Reciprocal Depth-to-Disparity Transformation ($z \to d = 1/z$):**
   - In `sphere-detector/src/sphere_detector/detect.py` and `web/geometry.js` (`sphereLines`), the sphere profile is fitted as a Euclidean circle in $(x, y, z)$ space:
     $$(\Delta x)^2 + (\Delta y)^2 + (\text{depthScale} \cdot \Delta z)^2 = R^2$$
     This profile is symmetric in $\pm \Delta z$: $z_{\text{near}} = z_c - |\Delta z|$ and $z_{\text{far}} = z_c + |\Delta z|$.
   - When generating outlines, `sphereLines` passes inverse depth (disparity) $d = 1/z$ to `pointAt`:
     $$d_{\text{near}} = \frac{1}{z_c - |\Delta z|}, \quad d_{\text{far}} = \frac{1}{z_c + |\Delta z|}$$
   - Since $f(z) = 1/z$ is strictly convex ($f''(z) = 2/z^3 > 0$), equal metric depth steps $\Delta z$ produce an asymmetric disparity step:
     $$\Delta d_{\text{near}} = \frac{|\Delta z|}{z_c (z_c - |\Delta z|)} > \frac{|\Delta z|}{z_c (z_c + |\Delta z|)} = \Delta d_{\text{far}}$$
     The near side is expanded in disparity space while the far side is compressed.

2. **Hyperbolic Display Mapping in `displayZ(d)`:**
   - In `web/geometry.js`:
     $$Z_{\text{disp}}(d) = 2 + \text{spread} \cdot \left(\frac{1}{0.45 + 1.55 \cdot t(d)} - 1\right)$$
     where $t(d) \propto d$. This second hyperbolic mapping compounds the non-linearity: $\frac{d^2 Z_{\text{disp}}}{dt^2} > 0$.

3. **Perspective Projection Transverse Scaling ($X, Y \propto Z_{\text{disp}}$):**
   - In `pointAt(x, y, d)`:
     $$X = (x - x_0) \cdot \frac{Z_{\text{disp}}}{f}, \quad Y = (y_0 - y) \cdot \frac{Z_{\text{disp}}}{f}$$
   - For a great circle or meridian, the angular/pixel radius $R_{\text{px}}$ is constant. Therefore, the metric transverse radius in world space at depth $Z_{\text{disp}}$ is:
     $$R_{3D} = R_{\text{px}} \cdot \frac{Z_{\text{disp}}}{f}$$
   - On the **far side** ($z > z_c$), disparity is smaller, so $Z_{\text{disp}}$ is larger $\implies$ transverse radius $R_{3D}$ **expands**.
   - On the **near side** ($z < z_c$), disparity is larger, so $Z_{\text{disp}}$ is smaller $\implies$ transverse radius $R_{3D}$ **contracts**.
   - The cross-sections widen as they move away from the camera and pinch inward as they approach the camera, turning the sphere into an egg (prolate/asymmetric ovoid) whose sharper pole faces the camera.

---

## 2. Proposed Changes

### A. Context Menu 'debug' $\leftrightarrow$ 'reset' Toggle
- **`web/xr-menu.js`**:
  - Retain `export const MENU_ITEMS = ['config', 'debug', 'Cancel'];` for backwards compatibility.
  - Add `export const getMenuItems = (debug = false) => ['config', debug ? 'reset' : 'debug', 'Cancel'];`.
- **`web/viewer.js`**:
  - In `menu` callback, pass `getMenuItems(debugMode)` to `menuPixels(...)`. Cache key incorporates `debugMode` so toggling redraws the menu texture quad.
  - In `options.onDebug?.()` / `setDebug(enabled)`:
    - When `debugMode` is toggled off (or reset), clear any selected point and call `renderer.clear_grab_level_curve()`.

### B. Point Selection Flipped Gesture in Debug Mode
- **Sequence**:
  1. **Long grab**: duration $> 250\text{ ms}$ or movement $> 0.02\text{ m}$ in debug mode.
  2. **Short pause**: release hand, duration $\le 350\text{ ms}$.
  3. **Short grab**: tap with duration $\le 250\text{ ms}$ and movement $\le 0.02\text{ m}$.
  - Flipped from context menu sequence ([short grab] $\to$ [short pause] $\to$ [drag/hold]).
  - Mutually exclusive because the first gesture's duration/movement determines the branch.
- **`web/xr-grab.js`**:
  - Track `debugLongPending`, `debugShortCandidate`, and `isPointSelected`.
  - In `start`:
    - If `debugActive && !held.size && debugLongPending && (time - debugLongPending.time <= 350)`: arm `debugShortCandidate`.
    - If `debugActive && isPointSelected`: reset `isPointSelected = false` upon new single grab.
  - In `frame` / `update`:
    - Track `debugShortCandidate.moved` and `candidate.moved`.
    - If `debugLongPending` expires ($> 350\text{ ms}$) without selection, clear it and trigger clear feedback.
    - Pass metadata `{ isSingleDebugGrab, isPointSelected, isPendingPause }`.
  - In `end`:
    - If `debugShortCandidate` ends with $\le 250\text{ ms}$ and unmoved $\implies$ `isPointSelected = true`.
    - If a single grab ends with $> 250\text{ ms}$ or moved $\implies$ `debugLongPending = { time }`.
- **`web/viewer.js`**:
  - Retain `lastClosestModel`.
  - When `isPointSelected` or `isPendingPause` is true and `markers.length === 0`, do NOT call `renderer.clear_grab_level_curve()`.
  - Pass `isPointSelected` to `grabFeedbackVertices`.
  - When another single grab occurs, `isPointSelected` clears and dynamic tracking resumes.
- **`web/xr-feedback.js`**:
  - In `grabFeedbackVertices`: when `isPointSelected && closestPointWorld`, render the solid bead at `closestPointWorld` even when `markers.length === 0` or during two-hand navigation.

---

## 3. Verification Plan

### Automated Tests
- `npm test`:
  - `tests/config.test.js`: test `getMenuItems` returns `['config', 'debug', 'Cancel']` when false, and `['config', 'reset', 'Cancel']` when true.
  - `tests/xr-feedback.test.js`: test `grabFeedbackVertices` renders the solid bead when `isPointSelected = true` and `markers = []`.
  - `tests/xr-grab.test.js`:
    - Test flipped sequence: long grab ($> 250\text{ ms}$) $\to$ short pause ($\le 350\text{ ms}$) $\to$ short grab ($\le 250\text{ ms}$, unmoved) sets `isPointSelected = true`.
    - Test that another single grab resets `isPointSelected = false`.
    - Test that long pause ($> 350\text{ ms}$) or moved second grab does not select point.
