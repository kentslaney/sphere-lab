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

test('fallback to targetRaySpace when gripSpace is missing allows translation', () => {
  const listeners = {};
  const session = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const g = new CloudGrab(); let changes = 0;
  const update = attachCloudGrab(session, {}, g, () => changes++);
  const raySource = { targetRaySpace: {} }; // no gripSpace
  const frame = x => ({ getPose: space => space === raySource.targetRaySpace ? ({ transform: { position: { x, y: 0, z: -1 } } }) : null });
  listeners.selectstart({ inputSource: raySource });
  update(frame(0)); update(frame(1));
  assert.equal(changes, 1);
  assert.deepEqual(g.position, [1, 0, -2]);
});

test('two-hand start origins synchronize when second hand joins to anchor scale line', () => {
  const listeners = {};
  const session = { visibilityState: 'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const g = new CloudGrab();
  let markers = [];
  const update = attachCloudGrab(session, {}, g, () => {}, m => { markers = m; });
  const a = { gripSpace: { x: 0 } }, b = { gripSpace: { x: 0.5 } };
  const frame = { getPose: s => ({ transform: { position: { x: s.x, y: 0, z: -1 } } }) };
  // Hand A starts alone at x = 0
  listeners.selectstart({ inputSource: a });
  update(frame);
  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0].origin, [0, 0, -1]);
  // Hand A moves to x = 0.4
  a.gripSpace.x = 0.4;
  update(frame);
  assert.equal(markers.length, 1);
  // Hand B joins at x = 0.5 to begin two-hand pinch
  listeners.selectstart({ inputSource: b });
  update(frame);
  assert.equal(markers.length, 2);
  // Both origins are synchronized to current positions when 2-hand gesture starts
  assert.deepEqual(markers[0].origin, [0.4, 0, -1]);
  assert.deepEqual(markers[1].origin, [0.5, 0, -1]);
});


function menuHarness() {
  const listeners = {}, g = new CloudGrab(), shown = [], selected = [];
  const session = { visibilityState: 'visible', addEventListener: (n, f) => listeners[n] = f };
  const source = { gripSpace: {} };
  const update = attachCloudGrab(session, {}, g, () => {}, () => {}, m => shown.push(m && { ...m }), i => selected.push(i));
  return { g, shown, selected,
    event: (name, time) => listeners[name]({ inputSource: source, frame: { predictedDisplayTime: time } }),
    frame: (time, y = 0, tracked = true) => update({ getPose: () => tracked ? { transform: { position: { x: 0, y, z: -1 } } } : null }, time),
  };
}

test('quick quiet grab opens on Cancel; second grab motion selects without moving cloud', () => {
  const h = menuHarness();
  h.event('selectstart', 0); h.frame(0); h.event('selectend', 100);
  h.event('selectstart', 200); h.frame(200);
  assert.equal(h.shown.at(-1).selected, 1);
  h.frame(220, 0.05); assert.equal(h.shown.at(-1).selected, 0);
  assert.deepEqual(h.g.position, [0, 0, -2]);
  h.frame(240, 0); assert.equal(h.shown.at(-1).selected, 1);
  h.event('selectend', 250);
  assert.deepEqual(h.selected, [1]); assert.equal(h.shown.at(-1), null);
});

test('immediate second release cancels even before a frame; config selection also closes the context menu', () => {
  const h = menuHarness();
  h.event('selectstart', 0); h.frame(0); h.event('selectend', 100);
  h.event('selectstart', 200); h.event('selectend', 201);
  assert.deepEqual(h.selected, [1]);
  h.event('selectstart', 300); h.frame(300); h.event('selectend', 350);
  h.event('selectstart', 400); h.frame(400); h.frame(420, 0.05); h.event('selectend', 450);
  assert.deepEqual(h.selected, [1, 0]); assert.equal(h.shown.at(-1), null);
});

test('long, moved, delayed and tracking-lost grabs do not arm a menu', () => {
  for (const mode of ['long', 'moved', 'delayed', 'lost']) {
    const h = menuHarness();
    h.event('selectstart', 0); h.frame(0);
    if (mode === 'moved') { h.frame(50, 0.1); h.frame(70, 0); }
    if (mode === 'lost') h.frame(50, 0, false);
    const end = mode === 'long' ? 300 : 100;
    h.event('selectend', end);
    const start = mode === 'delayed' ? 500 : end + 100;
    h.event('selectstart', start); h.frame(start);
    assert.ok(h.shown.every(m => m === null), mode);
  }
});

test('tracking loss closes menu without selecting', () => {
  const h = menuHarness();
  h.event('selectstart', 0); h.frame(0); h.event('selectend', 100);
  h.event('selectstart', 200); h.frame(200); h.frame(220, 0, false);
  h.event('selectend', 230);
  assert.equal(h.shown.at(-1), null); assert.deepEqual(h.selected, []);
});
