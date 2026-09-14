import { MENU_ITEMS } from './xr-menu.js';

const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v*b[i], 0);
const normalize = a => { const n = Math.hypot(...a); return a.map(v => v/n); };
const multiply = (a, b) => [...cross(a,b).map((v,i) => v+a[3]*b[i]+b[3]*a[i]), a[3]*b[3]-dot(a.slice(0,3),b.slice(0,3))];
export const rotate = (q, v) => {
  const t = cross(q, v).map(x => 2*x);
  const c = cross(q, t);
  return v.map((x,i) => x+q[3]*t[i]+c[i]);
};
function between(a, b) {
  a = normalize(a); b = normalize(b);
  const d = Math.max(-1, Math.min(1, dot(a,b)));
  if (d < -0.999999) {
    const axis = normalize(cross(a, Math.abs(a[0]) < 0.9 ? [1,0,0] : [0,1,0]));
    return [...axis, 0];
  }
  return normalize([...cross(a,b), 1+d]);
}

// All positions are in the XR local reference space (meters).
export class CloudGrab {
  constructor() { this.reset(); }
  reset() {
    this.position = [0, 0, -2];
    this.scale = 1;
    this.rotation = [0,0,0,1];
    this.release();
  }
  release() { this.anchor = null; }
  update(hands) {
    const entries = [...hands].slice(0, 2);
    if (!entries.length) { this.release(); return false; }
    const center = entries[0][1].map((v, i) => entries.length === 2 ? (v + entries[1][1][i]) / 2 : v);
    const vector = entries.length === 2 ? entries[1][1].map((v,i) => v-entries[0][1][i]) : null;
    const span = entries.length === 2 ? Math.hypot(...entries[0][1].map((v, i) => v - entries[1][1][i])) : 0;
    if (!this.anchor || entries.length !== this.anchor.ids.length || entries.some(([id], i) => id !== this.anchor.ids[i])) {
      this.anchor = { ids: entries.map(([id]) => id), center, span, vector, rotation: [...this.rotation], position: [...this.position], scale: this.scale };
      return false;
    }
    const a = this.anchor;
    // Rebase nearly coincident hands rather than dividing by a tiny span.
    if (entries.length === 2 && a.span < 0.03) { this.release(); return false; }
    this.scale = entries.length === 2 ? Math.max(0.1, Math.min(10, a.scale * span / a.span)) : a.scale;
    const ratio = this.scale / a.scale;
    const rotation = entries.length === 2 && span > 0.001 ? between(a.vector, vector) : [0,0,0,1];
    this.rotation = normalize(multiply(rotation, a.rotation));
    const offset = rotate(rotation, a.position.map((v,i) => v-a.center[i]));
    this.position = center.map((v, i) => v + offset[i] * ratio);
    return true;
  }
}

export function attachCloudGrab(session, space, grab, apply, feedback = () => {}, menu = () => {}, select = () => {}, config = null, isDebug = () => false, disabledItems = () => []) {
  const held = new Set();
  const origins = new Map();
  let lastHandCount = 0;
  let candidate = null, pending = null, activeMenu = null;
  let debugLongPending = null, debugShortCandidate = null, isPointSelected = false;
  const now = event => event.frame?.predictedDisplayTime ?? performance.now();
  const closeMenu = (commit = false) => {
    const selected = activeMenu?.selected;
    activeMenu = null; menu(null);
    if (selected !== undefined && commit && !disabledItems().includes(selected)) select(selected);
  };
  const hide = () => {
    origins.clear();
    lastHandCount = 0;
    const debugActive = typeof isDebug === 'function' ? isDebug() : Boolean(isDebug);
    feedback([], {
      isSingleDebugGrab: false,
      isPointSelected,
      isPendingPause: Boolean(debugActive && debugLongPending)
    });
  };
  const start = event => {
    if (held.has(event.inputSource)) return;
    const time = now(event);
    const debugActive = typeof isDebug === 'function' ? isDebug() : Boolean(isDebug);
    if (!debugActive) {
      isPointSelected = false; debugLongPending = null; debugShortCandidate = null;
    }
    if (config?.isOpen) {
      held.add(event.inputSource);
      candidate = null; pending = null;
      debugLongPending = null; debugShortCandidate = null;
      return;
    }
    if (!held.size && pending && time - pending.time <= 350 && time >= pending.time) {
      activeMenu = { source: event.inputSource, origin: null, selected: MENU_ITEMS.length - 1 };
      candidate = null;
      debugLongPending = null; debugShortCandidate = null;
      grab.release();
    } else if (debugActive && !held.size && debugLongPending && time - debugLongPending.time <= 350 && time >= debugLongPending.time) {
      debugShortCandidate = { source: event.inputSource, time, origin: null, moved: false };
      candidate = { source: event.inputSource, time, origin: null, moved: false };
      debugLongPending = null;
    } else {
      if (debugActive && isPointSelected) {
        isPointSelected = false;
      }
      debugShortCandidate = null;
      debugLongPending = null;
      candidate = held.size ? null : { source: event.inputSource, time, origin: null, moved: false };
    }
    pending = null;
    held.add(event.inputSource);
    if (held.size > 1) {
      candidate = null;
      debugShortCandidate = null;
      debugLongPending = null;
      closeMenu();
    }
  };
  const remove = source => {
    // Other transient inputs must not rebase an ongoing grab and discard motion.
    if (!held.delete(source)) return;
    origins.delete(source);
    grab.release();
    if (held.size === 0) hide();
  };
  const end = event => {
    const source = event.inputSource, time = now(event);
    const debugActive = typeof isDebug === 'function' ? isDebug() : Boolean(isDebug);
    if (config?.isOpen) config.end(source);
    else if (activeMenu?.source === source) closeMenu(true);
    else if (debugActive && debugShortCandidate?.source === source && debugShortCandidate.origin && !debugShortCandidate.moved && time - debugShortCandidate.time <= 250 && held.size === 1) {
      isPointSelected = true;
      debugShortCandidate = null;
      debugLongPending = null;
      pending = null;
    }
    else if (candidate?.source === source && candidate.origin && !candidate.moved && time - candidate.time <= 250 && held.size === 1) {
      pending = { time };
      debugLongPending = null;
    }
    else if (debugActive && candidate?.source === source && held.size === 1 && (candidate.moved || time - candidate.time > 250)) {
      debugLongPending = { time };
      pending = null;
    }
    if (debugShortCandidate?.source === source) debugShortCandidate = null;
    if (candidate?.source === source) candidate = null;
    remove(source);
  };
  const changed = event => {
    for (const source of event.removed) {
      if (held.has(source)) {
        candidate = null; pending = null;
        debugLongPending = null; debugShortCandidate = null;
        closeMenu(); config?.cancelGrab();
      }
      remove(source);
    }
  };
  const clear = () => {
    config?.close();
    candidate = null; pending = null;
    debugLongPending = null; debugShortCandidate = null;
    isPointSelected = false;
    closeMenu(); held.clear(); grab.release(); hide();
  };
  session.addEventListener('selectstart', start);
  session.addEventListener('selectend', end);
  session.addEventListener('inputsourceschange', changed);
  session.addEventListener('visibilitychange', clear);
  session.addEventListener('end', clear);
  return (frame, time = performance.now()) => {
    if (session.visibilityState !== 'visible') { clear(); return; }
    const hands = new Map();
    const sources = config?.isOpen ? new Set([...(session.inputSources ?? []), ...held]) : held;
    for (const source of sources) {
      // Use gripSpace when available (tracked hands/controllers), fallback to targetRaySpace
      const targetSpace = source.gripSpace || source.targetRaySpace;
      const pose = targetSpace && frame.getPose(targetSpace, space);
      if (!pose) continue;
      const p = pose.transform.position;
      if (![p.x, p.y, p.z].every(Number.isFinite)) continue;
      let position = [p.x, p.y, p.z];
      if (config?.isOpen && !source.gripSpace && pose.transform.orientation) {
        // Gaze/controller rays hover on the same upright plane as the menu.
        const q = pose.transform.orientation;
        const direction = rotate([q.x, q.y, q.z, q.w], [0, 0, -1]);
        const normal = [-config.right[2], 0, config.right[0]];
        const denominator = dot(direction, normal);
        const distance = dot(config.origin.map((v, i) => v - position[i]), normal) / denominator;
        if (Math.abs(denominator) < 1e-5 || distance < 0 || !Number.isFinite(distance)) continue;
        position = position.map((v, i) => v + direction[i] * distance);
      }
      hands.set(source, position);
    }
    if (config?.isOpen) { config.update(hands, held); grab.release(); hide(); return; }
    const debugActive = typeof isDebug === 'function' ? isDebug() : Boolean(isDebug);
    if (!debugActive) {
      isPointSelected = false; debugLongPending = null; debugShortCandidate = null;
    }
    if (debugLongPending && time - debugLongPending.time > 350) {
      debugLongPending = null;
      if (!isPointSelected) {
        feedback([], { isSingleDebugGrab: false, isPointSelected: false, isPendingPause: false });
      }
    }
    if (hands.size === 0) {
      if (held.size > 0) {
        config?.cancelGrab();
        candidate = null; pending = null; closeMenu();
        debugLongPending = null; debugShortCandidate = null;
        grab.release();
        hide();
      }
      return;
    }
    if (candidate) {
      const p = hands.get(candidate.source);
      if (!p) candidate = null;
      else {
        candidate.origin ??= [...p];
        candidate.moved ||= Math.hypot(...p.map((v, i) => v - candidate.origin[i])) > 0.02;
      }
    }
    if (debugShortCandidate) {
      const p = hands.get(debugShortCandidate.source);
      if (!p) debugShortCandidate = null;
      else {
        debugShortCandidate.origin ??= [...p];
        debugShortCandidate.moved ||= Math.hypot(...p.map((v, i) => v - debugShortCandidate.origin[i])) > 0.02;
      }
    }
    if (activeMenu) {
      const p = hands.get(activeMenu.source);
      if (!p) { closeMenu(); grab.release(); }
      else {
        activeMenu.origin ??= [...p];
        const dy = p[1] - activeMenu.origin[1];
        // Match the rendered row spacing, with Cancel anchored at hand height.
        const lastRow = MENU_ITEMS.length - 1;
        const rowSpacing = 0.24 * 96 / 512;
        const row = lastRow - dy / rowSpacing;
        // A 5 mm margin keeps tracking noise from flickering between rows.
        if (Math.abs(row - activeMenu.selected) > 0.5 + 0.005 / rowSpacing) {
          activeMenu.selected = Math.max(0, Math.min(lastRow, Math.round(row)));
        }
        hide(); menu(activeMenu); return;
      }
    }
    const activeEntries = [...hands].slice(0, 2);
    for (const [source, position] of activeEntries) {
      if (!origins.has(source)) {
        const used = new Set([...origins.values()].map(marker => marker.slot));
        origins.set(source, { origin: [...position], startedAt: time, slot: used.has(0) ? 1 : 0 });
      }
    }
    // When transitioning to 2 hands (two-hand pinch begins), synchronize the gesture start points
    // so the measurement line and scaling formula D = S0^2 / S1 are anchored to where both hands
    // actually are at the start of the two-hand pinch.
    if (activeEntries.length === 2 && lastHandCount < 2) {
      for (const [source, position] of activeEntries) {
        const slot = origins.get(source).slot;
        origins.set(source, { origin: [...position], startedAt: time, slot });
      }
    }
    lastHandCount = activeEntries.length;

    const markers = activeEntries.map(([source, position]) => {
      const rec = origins.get(source);
      return { ...rec, position, elapsed: time - rec.startedAt };
    });

    const isPendingPause = Boolean(debugActive && debugLongPending && time - debugLongPending.time <= 350);
    if (debugActive && activeEntries.length === 1) {
      grab.release();
      const isShortTapping = Boolean(debugShortCandidate && !debugShortCandidate.moved && time - debugShortCandidate.time <= 250);
      feedback(markers, {
        isSingleDebugGrab: !isShortTapping,
        isPointSelected,
        isPendingPause: isShortTapping || isPendingPause
      });
    } else {
      feedback(markers, {
        isSingleDebugGrab: false,
        isPointSelected,
        isPendingPause
      });
      if (grab.update(hands)) apply();
    }
  };
}
