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
  return {panel, values, hand, move: (x, y, pressed = false) => panel.update(new Map([[hand, [x,y,-1]]]), new Set(pressed ? [hand] : []))};
}

test('hover selects rows without changing values; grabbing locks a horizontal slider', () => {
  const {panel, values, hand, move} = setup();
  move(0,0.135); assert.equal(panel.selected, 0); assert.equal(values.spread, 1);
  move(0.05,0.09); assert.equal(panel.selected, 1); assert.equal(values.threshold, 0.1);
  move(0,0.135,true);
  move(0.125,0,true); assert.equal(panel.selected, 0); assert.equal(values.spread, 4);
  move(-0.125,0.09,true); assert.equal(values.spread, 0.25);
  panel.end(hand); assert.equal(panel.isOpen, true);
  move(0,0.09); move(0,0.09,true); move(0.1,0.135,true);
  assert.equal(panel.selected, 1); assert.equal(values.threshold, 0.5);
  panel.end(hand);
  move(0,0.045); move(0,0.045,true); panel.end(hand); assert.equal(values.outlines, false);
  move(0,0); move(0,0,true); panel.end(hand); assert.equal(panel.isOpen, false);
});

test('config tracking interruption and multiple grabs do not toggle settings', () => {
  const {panel, values, hand, move} = setup();
  move(0,0.045,true); assert.equal(panel.selected, 2);
  panel.update(new Map(), new Set([hand])); panel.end(hand); assert.equal(values.outlines, true);
  move(0,0.045,true);
  const other = {};
  panel.update(new Map([[hand,[0,0.045,-1]],[other,[1,0,-1]]]), new Set([hand,other]));
  panel.end(hand); assert.equal(values.outlines, true);
  move(1,0); assert.equal(panel.selected, -1);
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
  const session = { visibilityState:'visible', inputSources:[hand], addEventListener: (name, fn) => listeners[name] = fn };
  const update = attachCloudGrab(session, {}, grab, () => {}, () => {}, () => {}, () => {}, panel);
  const frame = (x,y) => ({getPose: () => ({transform:{position:{x,y,z:-1}}})});
  update(frame(0,0.135)); assert.equal(panel.selected, 0);
  assert.equal(values.spread, 1); assert.deepEqual(grab.position, [0,0,-2]);
  listeners.selectstart({inputSource:hand});
  update(frame(0,0.135)); update(frame(0.125,0));
  assert.equal(values.spread, 4); assert.deepEqual(grab.position, [0,0,-2]);
  listeners.selectend({inputSource:hand}); assert.equal(panel.isOpen, true);
  listeners.end(); assert.equal(panel.isOpen, false);
});

test('unpressed target rays hover over config and scene remains frozen without held inputs', () => {
  const {panel} = setup();
  const source = {targetRaySpace:{}};
  const listeners = {}, grab = new CloudGrab();
  const session = {visibilityState:'visible', inputSources:[source], addEventListener:(name, fn)=>listeners[name]=fn};
  let changes = 0;
  const update = attachCloudGrab(session, {}, grab, ()=>changes++, ()=>{}, ()=>{}, ()=>{}, panel);
  update({getPose:()=>({transform:{position:{x:0,y:0.09,z:0},orientation:{x:0,y:0,z:0,w:1}}})});
  assert.equal(panel.selected, 1); assert.equal(changes, 0);
  update({getPose:()=>null}); assert.equal(panel.selected, -1); assert.equal(changes, 0);
  assert.deepEqual(grab.position,[0,0,-2]);
});
