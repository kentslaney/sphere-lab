import test from 'node:test';
import assert from 'node:assert/strict';
import { grabFeedbackVertices, calculateScaledDistance, formatDistance, buildDebugSphereVertices } from '../web/xr-feedback.js';

test('origin shell persists while the animated bead moves and becomes opaque', () => {
  for (const [elapsed, center, radius, alpha] of [
    [0, [0, 0, 0], 0.045, 0.18],
    [150, [0.5, 1, 1.5], 0.027, 0.59],
    [300, [1, 2, 3], 0.009, 1],
    [1000, [1, 2, 3], 0.009, 1],
  ]) {
    const vertices = grabFeedbackVertices([{ origin: [0, 0, 0], position: [1, 2, 3], slot: 0, elapsed }]);
    const sphereLength = vertices.length / 2;
    for (let i = 0; i < sphereLength; i += 7) {
      assert.ok(Math.abs(Math.hypot(...vertices.slice(i, i + 3)) - 0.045) < 1e-6);
      assert.ok(Math.abs(vertices[i + 6] - 0.18) < 1e-6);
    }
    for (let i = sphereLength; i < vertices.length; i += 7) {
      assert.ok(Math.abs(Math.hypot(...center.map((v, axis) => vertices[i + axis] - v)) - radius) < 1e-6);
      assert.ok(Math.abs(vertices[i + 6] - alpha) < 1e-6);
    }
  }
  assert.equal(grabFeedbackVertices([]).length, 0);
});

test('two-hand pinch measurement distance calculation matches scaling formula', () => {
  // If a pinch starts at 10cm, halving the distance to 5cm puts the scaled distance at 20cm
  const origin0 = [0, 0, 0];
  const origin1 = [0.10, 0, 0]; // 10cm start span
  const pos0 = [0, 0, 0];
  const pos1Half = [0.05, 0, 0]; // halved to 5cm
  const dHalved = calculateScaledDistance(origin0, origin1, pos0, pos1Half);
  assert.ok(Math.abs(dHalved - 0.20) < 1e-5, `Expected 0.20m (20cm), got ${dHalved}`);
  assert.equal(formatDistance(dHalved), '20 CM');

  // Doubling hand distance to 20cm scales distance down to 5cm
  const pos1Double = [0.20, 0, 0];
  const dDoubled = calculateScaledDistance(origin0, origin1, pos0, pos1Double);
  assert.ok(Math.abs(dDoubled - 0.05) < 1e-5, `Expected 0.05m (5cm), got ${dDoubled}`);
  assert.equal(formatDistance(dDoubled), '5 CM');

  // Unchanged distance stays 10cm
  const pos1Same = [0.10, 0, 0];
  const dSame = calculateScaledDistance(origin0, origin1, pos0, pos1Same);
  assert.ok(Math.abs(dSame - 0.10) < 1e-5, `Expected 0.10m (10cm), got ${dSame}`);
  assert.equal(formatDistance(dSame), '10 CM');

  // Multi-meter scaling formats with meters
  const originFar = [0.50, 0, 0];
  const posClose = [0.10, 0, 0];
  const dFar = calculateScaledDistance(origin0, originFar, pos0, posClose);
  assert.ok(Math.abs(dFar - 2.50) < 1e-5);
  assert.equal(formatDistance(dFar), '2.50 M');
});

test('two grabs fit feedback buffer and render measurement line with lighter text box highlight', () => {
  const markers = [
    { origin: [0, 0, 0], position: [0, 0, 0], slot: 0, elapsed: 1000 },
    { origin: [0.10, 0, 0], position: [0.05, 0, 0], slot: 1, elapsed: 1000 }
  ];
  const both = grabFeedbackVertices(markers, [0, 0, 1]);
  assert.ok(both.byteLength <= 131072, `Byte length ${both.byteLength} exceeds 131072`);
  assert.equal(both.length % 21, 0, 'Vertices must form complete triangles');
  assert.ok(both.every(Number.isFinite), 'All vertices must be finite');

  // Contains both hand spheres plus the measurement line and text box
  const singleHandVerticesLength = grabFeedbackVertices([markers[0]]).length;
  assert.ok(both.length > singleHandVerticesLength * 2);

  // Check highlight box has lighter luminance than the translucent line
  // Line color is [0.35, 0.55, 0.8] with alpha 0.40
  // Text box highlight is [0.88, 0.94, 1.0] with alpha 0.88
  let foundHighlight = false;
  let foundLine = false;
  for (let i = 0; i < both.length; i += 7) {
    const r = both[i + 3], g = both[i + 4], b = both[i + 5], a = both[i + 6];
    if (Math.abs(a - 0.40) < 1e-3 && Math.abs(r - 0.35) < 0.05) foundLine = true;
    if (Math.abs(a - 0.88) < 1e-3 && Math.abs(r - 0.88) < 0.05) foundHighlight = true;
  }
  assert.ok(foundLine, 'Translucent line between gesture start points should be present');
  assert.ok(foundHighlight, 'Lighter text box highlight should be present');
});

test('individual hand beads use neutral white shading for shell and bead', () => {
  const marker = { origin: [0, 0, 0], position: [0, 1, 0], slot: 0, elapsed: 1000 };
  const vertices = grabFeedbackVertices([marker]);
  for (let i = 0; i < vertices.length; i += 7) {
    assert.equal(vertices[i + 3], vertices[i + 4]);
    assert.equal(vertices[i + 4], vertices[i + 5]);
    assert.ok(vertices[i + 3] >= 0.64);
  }
});

test('buildDebugSphereVertices generates valid triangle mesh at resolved raycast position', () => {
  const center = [1.2, -0.5, -2.3];
  const vertices = buildDebugSphereVertices(center, 0.04);
  assert.ok(vertices.length > 0);
  assert.equal(vertices.length % 21, 0);
  assert.ok(vertices.every(Number.isFinite));

  // Check sphere center
  let avgX = 0, avgY = 0, avgZ = 0;
  const count = vertices.length / 7;
  for (let i = 0; i < vertices.length; i += 7) {
    avgX += vertices[i];
    avgY += vertices[i + 1];
    avgZ += vertices[i + 2];
  }
  assert.ok(Math.abs(avgX / count - center[0]) < 1e-3);
  assert.ok(Math.abs(avgY / count - center[1]) < 1e-3);
  assert.ok(Math.abs(avgZ / count - center[2]) < 1e-3);
});

test('single debug grab renders translucent shell at grab point and solid bead at closest point', () => {
  const marker = { origin: [0, 0, 0], position: [0.2, 0.3, -1], slot: 0, elapsed: 1000 };
  const closest = [0.5, 0.6, -1.2];
  const vertices = grabFeedbackVertices([marker], [0, 0, 0], closest, true);

  assert.ok(vertices.length > 0);
  assert.equal(vertices.length % 21, 0);

  const sphereLen = vertices.length / 2;
  // First sphere: translucent shell at marker.position with radius 0.045, alpha 0.18
  for (let i = 0; i < sphereLen; i += 7) {
    const d = Math.hypot(vertices[i] - marker.position[0], vertices[i + 1] - marker.position[1], vertices[i + 2] - marker.position[2]);
    assert.ok(Math.abs(d - 0.045) < 1e-5);
    assert.ok(Math.abs(vertices[i + 6] - 0.18) < 1e-5);
  }

  // Second sphere: solid bead at closest with radius 0.009, alpha 1.0 (elapsed = 1000 > 300)
  for (let i = sphereLen; i < vertices.length; i += 7) {
    const d = Math.hypot(vertices[i] - closest[0], vertices[i + 1] - closest[1], vertices[i + 2] - closest[2]);
    assert.ok(Math.abs(d - 0.009) < 1e-5);
    assert.ok(Math.abs(vertices[i + 6] - 1.0) < 1e-5);
  }
});
