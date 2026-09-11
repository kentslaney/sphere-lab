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

export function attachCloudGrab(session, space, grab, apply, feedback = () => {}) {
  const held = new Set();
  const origins = new Map();
  let lastHandCount = 0;
  const hide = () => { origins.clear(); lastHandCount = 0; feedback([]); };
  const start = event => held.add(event.inputSource);
  const remove = source => {
    // Other transient inputs must not rebase an ongoing grab and discard motion.
    if (!held.delete(source)) return;
    origins.delete(source);
    grab.release();
    if (held.size === 0) hide();
  };
  const end = event => remove(event.inputSource);
  const changed = event => { for (const source of event.removed) remove(source); };
  const clear = () => { held.clear(); grab.release(); hide(); };
  session.addEventListener('selectstart', start);
  session.addEventListener('selectend', end);
  session.addEventListener('inputsourceschange', changed);
  session.addEventListener('visibilitychange', clear);
  session.addEventListener('end', clear);
  return (frame, time = performance.now()) => {
    if (session.visibilityState !== 'visible') { grab.release(); hide(); return; }
    const hands = new Map();
    for (const source of held) {
      // Use gripSpace when available (tracked hands/controllers), fallback to targetRaySpace
      const targetSpace = source.gripSpace || source.targetRaySpace;
      const pose = targetSpace && frame.getPose(targetSpace, space);
      if (!pose) continue;
      const p = pose.transform.position;
      if (![p.x, p.y, p.z].every(Number.isFinite)) continue;
      hands.set(source, [p.x, p.y, p.z]);
    }
    if (hands.size === 0) {
      if (held.size > 0) {
        grab.release();
        hide();
      }
      return;
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
    feedback(markers);
    if (grab.update(hands)) apply();
  };
}
