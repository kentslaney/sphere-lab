# Implementation Plan: Dynamic VR Gesture Measurement & Desktop Navigation Overhaul

Remove the static/HUD scale legends in both VR and the standard desktop viewport. In VR, replace the legend with a dynamic measurement line drawn between gesture start points, featuring a lighter text box highlight displaying the updated distance between the scaled versions of the points. On desktop, upgrade viewport navigation so scrolling moves forward along the view axis (unclamped), and grabbing/dragging a point rotates the camera around that raycast point so it stays stationary.

## User Review Required

> [!IMPORTANT]
> - **Scale Legends Removed**: The static HTML `#scale-key`, `#scale-legend` toggle checkbox in `web/index.html`, related CSS in `web/style.css`, and the static WebGPU VR HUD card in `web/vr-hud.js` will be removed.
> - **VR Pinch Measurement**: During two-hand pinch gestures in VR, a translucent line will be rendered connecting the two gesture start points (`origin_0` and `origin_1`). At the midpoint, a lighter text box highlight (lighter than the line against the empty VR background) displays the scaled distance between the original points using the formula $D = \frac{S_0^2}{S_1}$ (e.g. 10 cm starting span halved to 5 cm displays 20 cm).
> - **Desktop Viewport Navigation**:
>   - **Scroll**: Scrolling the wheel moves the camera forward/backward along its view ray directly through the scene (no inward orbit clamp at 0.6 m).
>   - **Grab & Drag**: On pointer down, a ray is cast through the cursor to find the point in the point cloud (or defaults to a reference distance of 2.0 m). Rotating by dragging orbits the camera around that exact 3D point, keeping it stationary at that raycast/screen coordinate.

---

## Proposed Changes

### 1. Remove Static Scale Legends

#### [MODIFY] [index.html](file:///Users/kds/Documents/antigravity/sphere-debug/web/index.html)
- Remove `<div id="scale-key" ...>...</div>`.
- Remove `<label class="toggle"><input id="scale-legend" ...> Scale legend</label>`.
- Clean up footnote reference to viewport scale key.

#### [MODIFY] [style.css](file:///Users/kds/Documents/antigravity/sphere-debug/web/style.css)
- Remove all `.scale-key*` and `.scale-bar*` styling rules.

#### [MODIFY] [app.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/app.js)
- Remove `updateScaleKey()` and its event listeners on `#scale-legend` and window resize.
- Remove references to `computeViewportPinchScale`.

---

### 2. VR Two-Hand Gesture Measurement Line & Scaled Distance Text Badge

#### [MODIFY] [xr-feedback.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/xr-feedback.js)
- When 2 hands are active (`markers.length === 2`):
  - Calculate initial span between start points: $S_0 = \|\text{origin}_1 - \text{origin}_0\|$.
  - Calculate current span between hands: $S_1 = \|\text{position}_1 - \text{position}_0\|$.
  - Compute scaled distance: $D = \frac{S_0^2}{\max(1e-4, S_1)}$.
  - Format distance: e.g. `< 1 m` as `(D * 100).toFixed(1) cm` (or integer `20 cm` for exact values), and `≥ 1 m` as `D.toFixed(2) m`.
  - Draw a translucent 3D tube/line between `origin_0` and `origin_1` with alpha ~0.4 (cool translucent tint).
  - At midpoint $M = (\text{origin}_0 + \text{origin}_1) / 2$, generate a billboarded quad facing the viewer with a lighter highlight background (`rgba(0.88, 0.93, 0.98, 0.85)` — significantly lighter than the line against the dark background).
  - On top of the highlight quad, draw vector stroke text in high-contrast dark color (`rgba(0.06, 0.10, 0.16, 0.95)`) showing the formatted distance.
  - Return all interleaved `[x, y, z, r, g, b, a]` vertices to fit within `feedback` buffer.

#### [MODIFY] [viewer.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/viewer.js)
- Remove static `buildVrHudVertices` call and `updateVrHud`.
- Ensure `set_hud(new Float32Array())` is cleared.
- Pass viewer eye position into `grabFeedbackVertices` so text box highlight faces the headset.

---

### 3. Desktop Viewport Navigation Overhaul

#### [MODIFY] [lib.rs](file:///Users/kds/Documents/antigravity/sphere-debug/renderer/src/lib.rs)
- Remove clamp on distance in `set_pose`: allow unconstrained distance or camera positioning.
- Ensure `set_pose(0, 0, 0)` allows passing the full view matrix directly to `Renderer::draw()`.

#### [MODIFY] [viewer.js](file:///Users/kds/Documents/antigravity/sphere-debug/web/viewer.js)
- Maintain camera position $\mathbf{C} = [c_x, c_y, c_z]$ and rotation orientation $R_{cam}$.
- **Scroll**: Wheel event moves camera position along view forward vector $\mathbf{f} = R_{cam} \cdot [0, 0, -1]$ by $\Delta z = -\text{deltaY} \times \text{speed}$, allowing forward motion without any inward radius clamping.
- **Pointer Down**:
  - Compute ray through cursor $(x, y)$ in world space.
  - Find the closest point cloud point along the ray (within an angular threshold), or fallback to reference distance $d = 2.0\text{ m}$.
  - Anchor rotation pivot at $P = \mathbf{C} + d \cdot \mathbf{ray}$.
- **Pointer Move (Drag)**:
  - Rotate camera position and orientation around pivot $P$ by $\Delta \text{yaw}$ (around world up $[0, 1, 0]$) and $\Delta \text{pitch}$ (around camera right axis).
  - Because camera orbits around $P$ while simultaneously rotating its view matrix by the exact same transform, $P$ remains stationary at that screen coordinate and in 3D world space.
- Construct the camera `viewMatrix` and pass it to `renderer.draw(..., viewMatrix, ...)`.
- On "Reset view", restore camera to default $(0, 0, 2)$ looking down $-Z$.

---

### 4. Tests & Verification

#### [MODIFY] [xr-feedback.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/xr-feedback.test.js)
- Update tests to verify that when `markers.length === 2`:
  - Output contains the two marker beads plus the measurement line and label vertices.
  - Total byte length remains $\le 131,072$ bytes.
  - Scaled distance calculation accurately computes $D = S_0^2 / S_1$ (e.g. 10 cm start span with 5 cm current span produces 20 cm).

#### [MODIFY] [vr-hud.test.js](file:///Users/kds/Documents/antigravity/sphere-debug/tests/vr-hud.test.js)
- Update or replace with tests validating the new VR measurement line and distance calculations.

---

## Verification Plan

### Automated Tests
```bash
# 1. Compile Rust renderer to WebAssembly
sh scripts/build_wasm.sh

# 2. Run all unit and integration tests
npm test
```

### Manual Verification
1. Run `python3 scripts/stage_web.py` to confirm web build staging.
2. Verify desktop viewport:
   - Check that the static `#scale-key` and `#scale-legend` are completely gone.
   - Verify scrolling moves the camera forward/backward smoothly through the cloud (unclamped).
   - Verify clicking/dragging a point orbits the view around that point so the point remains fixed under the cursor/raycast.
3. Verify VR feedback:
   - Single hand pinch displays the persistent origin and animated tracking bead.
   - Two-hand pinch displays the translucent line between the two start points and the lighter text box highlight with updated scaled distance.
