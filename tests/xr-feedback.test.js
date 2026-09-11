import test from 'node:test';
import assert from 'node:assert/strict';
import { grabFeedbackVertices } from '../web/xr-feedback.js';

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

test('two grabs fit the feedback buffer with distinct persistent origins', () => {
  const markers = [0, 1].map(slot => ({ origin: [slot, 0, 0], position: [slot, 1, 0], slot, elapsed: 1000 }));
  const both = grabFeedbackVertices(markers);
  assert.ok(both.byteLength <= 131072);
  assert.deepEqual(both, new Float32Array(markers.flatMap(marker => [...grabFeedbackVertices([marker])])));
});

test('both hands use neutral white shading for shell and bead', () => {
  const markers = [0, 1].map(slot => ({ origin: [0, 0, 0], position: [0, 1, 0], slot, elapsed: 1000 }));
  const vertices = grabFeedbackVertices(markers);
  for (let i = 0; i < vertices.length; i += 7) {
    assert.equal(vertices[i + 3], vertices[i + 4]);
    assert.equal(vertices[i + 4], vertices[i + 5]);
    assert.ok(vertices[i + 3] >= 0.64);
  }
});
