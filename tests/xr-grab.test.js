import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudGrab, attachCloudGrab } from '../web/xr-grab.js';
const hands = (...positions) => new Map(positions.map((p, i) => [i, p]));
test('one pinch translates in all three axes and release preserves placement', () => {
  const g = new CloudGrab();
  g.update(hands([0,0,-1])); g.update(hands([1,2,-2]));
  assert.deepEqual(g.position, [1,2,-3]);
  g.update(new Map()); g.update(hands([5,5,5]));
  assert.deepEqual(g.position, [1,2,-3]);
});
test('two pinches scale around their midpoint; changing hand count does not jump', () => {
  const g = new CloudGrab();
  g.update(hands([-0.5,0,-1], [0.5,0,-1]));
  g.update(hands([-1,0,-1], [1,0,-1]));
  assert.equal(g.scale, 2); assert.deepEqual(g.position, [0,0,-3]);
  g.update(hands([-1,0,-1]));
  assert.deepEqual(g.position, [0,0,-3]);
  g.update(hands([-0.5,0,-1]));
  assert.deepEqual(g.position, [0.5,0,-3]);
});
test('coincident hands and extreme scaling remain finite and bounded', () => {
  const g = new CloudGrab();
  g.update(hands([0,0,0], [0,0,0])); g.update(hands([0,0,0], [0,0,0]));
  assert.equal(g.scale, 1);
  g.update(hands([-1,0,0], [1,0,0])); g.update(hands([-100,0,0], [100,0,0]));
  assert.equal(g.scale, 10); assert.ok(g.position.every(Number.isFinite));
  g.reset(); assert.deepEqual(g.position, [0,0,-2]); assert.equal(g.scale, 1);
});
test('XR tracking loss rebases and missing gripSpace is safe', () => {
  const listeners = {};
  const session = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const g = new CloudGrab(); let changes = 0;
  const update = attachCloudGrab(session, {}, g, () => changes++);
  const source = { gripSpace: {} };
  const frame = x => ({ getPose: () => ({ transform: { position: { x, y: 0, z: -1 } } }) });
  listeners.selectstart({ inputSource: source }); update(frame(0)); update(frame(1));
  assert.equal(changes, 1);
  update({ getPose: () => null }); update(frame(5));
  assert.deepEqual(g.position, [1,0,-2]);
  listeners.selectend({ inputSource: source });
  listeners.selectstart({ inputSource: {} }); update(frame(10));
  assert.equal(changes, 1);
  listeners.end(); update(frame(20)); assert.equal(changes, 1);
});

test('both original local grab points stay under the hands through translation, rotation and scaling', async () => {
  const { rotate } = await import('../web/xr-grab.js');
  const g = new CloudGrab();
  const initial = [[-0.5,0,-1], [0.5,0,-1]];
  const local = initial.map(p => p.map((v,i) => v-g.position[i]));
  g.update(hands(...initial));
  const target = [[1,-1,-2], [1,1,-2]];
  g.update(hands(...target));
  local.forEach((p,k) => {
    const actual = rotate(g.rotation,p).map((v,i) => g.position[i]+v*g.scale);
    actual.forEach((v,i) => assert.ok(Math.abs(v-target[k][i]) < 1e-10));
  });
  // A second grab starts with an already rotated/scaled cloud.
  g.release(); g.update(hands(...target));
  const next = [[2,1,-2], [2,-1,-2]];
  g.update(hands(...next));
  local.forEach((p,k) => rotate(g.rotation,p).forEach((v,i) => {
    assert.ok(Math.abs(g.position[i]+v*g.scale-next[k][i]) < 1e-10);
  }));
});

test('feedback tracks two sources independently and clears stale poses', () => {
  const listeners = {};
  const session = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  let markers;
  const update = attachCloudGrab(session, {}, new CloudGrab(), () => {}, value => markers = value);
  const a = { gripSpace: { x: -1 } }, b = { gripSpace: { x: 1 } };
  const frame = { getPose: space => ({ transform: { position: { x: space.x, y: 0, z: -1 } } }) };
  listeners.selectstart({ inputSource: a }); listeners.selectstart({ inputSource: b });
  update(frame);
  assert.equal(markers.length, 2);
  a.gripSpace.x = -2; update(frame);
  assert.deepEqual(markers[0].origin, [-1, 0, -1]);
  assert.deepEqual(markers[0].position, [-2, 0, -1]);
  listeners.selectend({ inputSource: a }); update(frame);
  assert.equal(markers[0].slot, 1);
  update({ getPose: () => null }); assert.deepEqual(markers, []);
  update(frame); assert.equal(markers.length, 1);
  listeners.end(); assert.deepEqual(markers, []);
});

test('unrelated XR input events do not discard held-hand movement', () => {
  const listeners = {};
  const session = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const g = new CloudGrab();
  const update = attachCloudGrab(session, {}, g, () => {});
  const source = { gripSpace: {} }, unrelated = {};
  const frame = x => ({ getPose: () => ({ transform: { position: { x, y: 0, z: -1 } } }) });
  listeners.selectstart({ inputSource: source }); update(frame(0));
  for (let i = 1; i <= 10; i++) {
    listeners.inputsourceschange({ added: [unrelated], removed: [] });
    listeners.inputsourceschange({ added: [], removed: [unrelated] });
    listeners.selectend({ inputSource: unrelated });
    update(frame(i / 10));
  }
  assert.deepEqual(g.position, [1, 0, -2]);
});
