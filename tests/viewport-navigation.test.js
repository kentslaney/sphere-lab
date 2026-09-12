import test from 'node:test';
import assert from 'node:assert/strict';
import { raycastDistance, solveTouchCamera, wheelTranslation } from '../web/viewport-navigation.js';
const basis = { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };
const norm = p => p.map(v => v / Math.hypot(...p));
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
const rayTo = (point, camera) => norm(point.map((v, i) => v - camera[i]));

test('one touch pans at its anchor depth', () => {
  const camera = [0, 0, 2], point = [0, 0, 0], ray = norm([0.2, -0.1, -1]);
  const next = solveTouchCamera(camera, basis, [{ point, ray }]);
  near(next, [-0.4, 0.2, 2]); near(rayTo(point, next), ray);
});

test('two touches recover a pan and dolly with unequal anchor depths', () => {
  const camera = [0, 0, 2], desired = [0.3, -0.2, 1.2];
  const touches = [[-0.5, 0.2, 0], [0.7, -0.1, -1]].map(point => ({ point, ray: rayTo(point, desired) }));
  const next = solveTouchCamera(camera, basis, touches);
  near(next, desired);
  touches.forEach(t => near(rayTo(t.point, next), t.ray));
});

test('three anchors and a rotated camera retain each projected touch position', () => {
  const rotated = { right: [0, 0, -1], up: [0, 1, 0], forward: [-1, 0, 0] };
  const camera = [2, 0, 0], desired = [1.5, 0.25, 0.2];
  const touches = [[0, -0.5, -0.5], [-1, 0.4, 0.6], [-0.5, 0.8, -0.1]].map(point => ({ point, ray: rayTo(point, desired) }));
  near(solveTouchCamera(camera, rotated, touches), desired);
});

test('adding and removing fingers does not jump when their positions are unchanged', () => {
  const camera = [0.2, 0.3, 1.2];
  const touches = [[-0.5, 0, 0], [0.5, 0.2, -1]].map(point => ({ point, ray: rayTo(point, camera) }));
  near(solveTouchCamera(camera, basis, touches), camera);
  near(solveTouchCamera(camera, basis, touches.slice(1)), camera);
});

test('coincident touches and incompatible motion stay finite and in front of anchors', () => {
  const camera = [0, 0, 2];
  for (const rays of [[norm([0, 0, -1]), norm([0, 0, -1])], [norm([0, 1, -1]), norm([0, -1, -1])]]) {
    const next = solveTouchCamera(camera, basis, [[-0.5, 0, 0], [0.5, 0, 0]].map((point, i) => ({ point, ray: rays[i] })));
    assert.ok(next.every(Number.isFinite)); assert.ok(next[2] >= 0.06 - 1e-8);
  }
});

test('raycasts use nearest hit, median depth for empty regions and a default plane for empty clouds', () => {
  const camera = [0, 0, 2], points = new Float32Array([0,0,-1,1,1,1, 0,0,0,1,1,1, 0,0,-2,1,1,1]);
  assert.equal(raycastDistance(points, camera, [0, 0, -1], basis.forward, 500, 1.5), 2);
  const ray = norm([1, 0, -1]);
  assert.ok(Math.abs(raycastDistance(points, camera, ray, basis.forward, 500, 1.5) * -ray[2] - 3) < 1e-8);
  assert.ok(Math.abs(raycastDistance(null, camera, ray, basis.forward, 500, 1.5) * -ray[2] - 2) < 1e-8);
});

test('wheel horizontal and vertical deltas map to camera right and depth, including line/page units', () => {
  near(wheelTranslation({ deltaX: 10, deltaY: 20, deltaMode: 0 }, basis, 500), [0.02, 0, 0.04]);
  near(wheelTranslation({ deltaX: 1, deltaY: -1, deltaMode: 1 }, basis, 500), [0.032, 0, -0.032]);
  near(wheelTranslation({ deltaX: 0, deltaY: 1, deltaMode: 2 }, basis, 500), [0, 0, 1]);
  const rotated = { right: [0, 0, -1], forward: [-1, 0, 0] };
  near(wheelTranslation({ deltaX: 10, deltaY: 20, deltaMode: 0 }, rotated, 500), [0.04, 0, -0.02]);
});
