import test from 'node:test';
import assert from 'node:assert/strict';
import { attachViewportActivation } from '../web/viewport-activation.js';
class Surface extends EventTarget {
  constructor() {
    super(); this.style = {}; this.classes = new Set();
    this.classList = { add: v => this.classes.add(v), remove: v => this.classes.delete(v), toggle: (v, on) => on ? this.classes.add(v) : this.classes.delete(v) };
  }
  setAttribute() {}
}
function setup(fine = false, fullscreen = 'native') {
  const canvas = new Surface(), stage = new Surface(), document = new Surface(), window = new Surface(), button = new Surface(), media = new Surface();
  let clears = 0, requests = 0, enabled = true, modal = false;
  canvas.parentElement = stage; canvas.ownerDocument = document; document.defaultView = window;
  document.body = new Surface(); document.querySelector = () => modal;
  media.matches = fine; window.matchMedia = () => media;
  if (fullscreen !== 'missing') stage.requestFullscreen = async () => {
    requests++;
    if (fullscreen === 'reject') throw Error('Unavailable');
    document.fullscreenElement = stage; document.dispatchEvent(new Event('fullscreenchange'));
  };
  document.exitFullscreen = async () => { document.fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); };
  const accepts = attachViewportActivation(canvas, button, () => clears++, () => enabled);
  return {canvas, stage, document, window, button, media, accepts, requests: () => requests, clears: () => clears,
    enabled: v => enabled = v, modal: v => modal = v};
}

test('coarse viewport ignores mouse input and leaves page gestures available until a click requests fullscreen', async () => {
  const h = setup();
  assert.equal(h.accepts(), false); assert.equal(h.canvas.style.touchAction, 'auto');
  h.canvas.dispatchEvent(new Event('pointerdown'));
  assert.equal(h.accepts(), false); assert.equal(h.requests(), 0);
  h.canvas.dispatchEvent(new Event('click'));
  assert.equal(h.requests(), 1); assert.equal(h.accepts(), true);
  assert.equal(h.document.fullscreenElement, h.stage); assert.equal(h.canvas.style.touchAction, 'none');
  assert.equal(h.button.hidden, false);
  await h.document.exitFullscreen();
  assert.equal(h.accepts(), false); assert.equal(h.canvas.style.touchAction, 'auto'); assert.equal(h.button.hidden, true);
});

test('missing or rejected fullscreen uses a full-window fallback with a working exit', async () => {
  for (const mode of ['missing', 'reject']) {
    const h = setup(false, mode);
    h.canvas.dispatchEvent(new Event('click')); await Promise.resolve();
    assert.ok(h.stage.classes.has('viewport-fullscreen')); assert.equal(h.accepts(), true);
    h.button.dispatchEvent(new Event('click')); await Promise.resolve();
    assert.equal(h.accepts(), false); assert.equal(h.stage.classes.has('viewport-fullscreen'), false);
  }
});

test('fine pointers work immediately without fullscreen; modal, XR and device loss suppress input', () => {
  const h = setup(true);
  assert.equal(h.accepts(), true);
  h.canvas.dispatchEvent(new Event('click')); assert.equal(h.requests(), 0);
  h.modal(true); assert.equal(h.accepts(), false); h.modal(false);
  h.enabled(false); assert.equal(h.accepts(), false); h.enabled(true);
  h.media.matches = false; h.media.dispatchEvent(new Event('change'));
  assert.equal(h.accepts(), false); assert.equal(h.canvas.style.touchAction, 'auto');
  assert.ok(h.clears() > 0);
});
