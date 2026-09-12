import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadFromSlider, spreadToSlider, XRConfig } from '../web/config.js';
import { menuHeight, menuVertices, MENU_ITEMS } from '../web/xr-menu.js';
import { attachCloudGrab, CloudGrab } from '../web/xr-grab.js';

test('depth spread spans 0.25 to 4 logarithmically with 1 at the midpoint', () => {
  assert.deepEqual([-2,-1,0,1,2].map(spreadFromSlider), [0.25,0.5,1,2,4]);
  for (const value of [0.25,0.4,1,2.5,4]) assert.ok(Math.abs(spreadFromSlider(spreadToSlider(value))-value) < 1e-10);
});

function setup() {
  const values = {spread: 1, threshold: 0.1, outlines: true};
  const panel = new XRConfig(() => ({...values}), (key, value) => values[key] = value);
  const hand = {};
  panel.open([0,0,-1], [1,0,0]);
  return {panel, values, hand, move: (x, y) => panel.update(new Map([[hand, [x,y,-1]]]))};
}

test('config edits shared spread and score values, toggles detections and closes with Done', () => {
  const {panel, values, hand, move} = setup();
  move(0,0); move(0,0.15); assert.equal(panel.selected, 0);
  move(0.125,0.15); assert.equal(values.spread, 4);
  move(-0.125,0.15); assert.equal(values.spread, 0.25);
  panel.end(hand); assert.equal(panel.isOpen, true);
  move(0,0); move(0,-0.05); assert.equal(panel.selected, 1);
  move(0.1,-0.05); assert.equal(values.threshold, 0.5);
  move(0.1,-0.10); assert.equal(panel.selected, 2);
  panel.end(hand); assert.equal(values.outlines, false);
  move(0,0); move(0,-0.05); assert.equal(panel.selected, 3);
  panel.end(hand); assert.equal(panel.isOpen, false);
});

test('config tracking interruption and two-hand gestures do not toggle settings', () => {
  const {panel, values, hand, move} = setup();
  move(0,0); move(0,0.05); assert.equal(panel.selected, 2);
  panel.cancelGrab(); panel.end(hand); assert.equal(values.outlines, true);
  move(0,0); panel.update(new Map([[hand,[0,0,-1]],[{},[1,0,-1]]]));
  panel.end(hand); assert.equal(values.outlines, true);
});

test('Config replaces test item; expanded texture quad retains correct aspect ratio', () => {
  assert.deepEqual(MENU_ITEMS, ['config', 'Cancel']);
  const height = menuHeight(['Depth spread', 'Minimum score', 'Show detections', 'Done'], 'Hint');
  const vertices = menuVertices([0,0,-1], [0,0,0], height, 3);
  assert.equal(vertices.length, 30); assert.ok(vertices.every(Number.isFinite));
  assert.ok(Math.abs((vertices[1] - vertices[6]) / 0.24 - height / 512) < 1e-6);
});

test('open config consumes XR grabs without moving the cloud, and session end clears it', () => {
  const {panel, values, hand} = setup(); hand.gripSpace = {};
  const listeners = {}, grab = new CloudGrab();
  const session = { visibilityState:'visible', addEventListener: (name, fn) => listeners[name] = fn };
  const update = attachCloudGrab(session, {}, grab, () => {}, () => {}, () => {}, () => {}, panel);
  listeners.selectstart({inputSource:hand});
  const frame = (x,y) => ({getPose: () => ({transform:{position:{x,y,z:-1}}})});
  update(frame(0,0)); update(frame(0,0.15)); update(frame(0.125,0.15));
  assert.equal(values.spread, 4); assert.deepEqual(grab.position, [0,0,-2]);
  listeners.selectend({inputSource:hand}); assert.equal(panel.isOpen, true);
  listeners.end(); assert.equal(panel.isOpen, false);
});
