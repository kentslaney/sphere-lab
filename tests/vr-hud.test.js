import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVrHudVertices } from '../web/vr-hud.js';

test('buildVrHudVertices returns empty Float32Array when not visible', () => {
  const out = buildVrHudVertices({ isVisible: false });
  assert.equal(out.length, 0);
  assert.ok(out instanceof Float32Array);
});

test('buildVrHudVertices produces valid alpha-blended triangle vertices', () => {
  const out = buildVrHudVertices({ scale: 1.0, avgDepth: 2.0, isVisible: true });
  assert.ok(out.length > 0);
  // Must be composed of triangles (3 vertices per triangle, 7 floats per vertex = 21 floats)
  assert.equal(out.length % 21, 0);
  assert.ok(out.every(Number.isFinite));

  // Check RGBA values
  for (let i = 0; i < out.length; i += 7) {
    const x = out[i];
    const y = out[i + 1];
    const z = out[i + 2];
    const r = out[i + 3];
    const g = out[i + 4];
    const b = out[i + 5];
    const a = out[i + 6];

    // HUD sits in eye space at comfortable reading depth (~ -0.80 m)
    assert.ok(Math.abs(z - (-0.80)) < 0.01, `z ${z} should be near -0.80`);
    assert.ok(r >= 0 && r <= 1, `r ${r} in [0, 1]`);
    assert.ok(g >= 0 && g <= 1, `g ${g} in [0, 1]`);
    assert.ok(b >= 0 && b <= 1, `b ${b} in [0, 1]`);
    assert.ok(a >= 0 && a <= 1, `a ${a} in [0, 1]`);
  }
});

test('buildVrHudVertices card background has dark translucent alpha', () => {
  const out = buildVrHudVertices({ scale: 1.0, avgDepth: 2.0, isVisible: true });
  // First quad is the dark card background
  const bgAlpha = out[6];
  assert.ok(Math.abs(bgAlpha - 0.85) < 1e-3, `background alpha should be 0.85, got ${bgAlpha}`);
});

test('buildVrHudVertices adapts dynamically across different pinch scales', () => {
  const out1 = buildVrHudVertices({ scale: 1.0, avgDepth: 2.0, isVisible: true });
  const out2 = buildVrHudVertices({ scale: 2.5, avgDepth: 2.0, isVisible: true });
  const out3 = buildVrHudVertices({ scale: 0.3, avgDepth: 2.0, isVisible: true });

  assert.ok(out1.length > 0);
  assert.ok(out2.length > 0);
  assert.ok(out3.length > 0);
  assert.equal(out1.length % 21, 0);
  assert.equal(out2.length % 21, 0);
  assert.equal(out3.length % 21, 0);
});
