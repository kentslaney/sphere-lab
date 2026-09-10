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

export function attachCloudGrab(session, space, grab, apply) {
  const held = new Set();
  const start = event => held.add(event.inputSource);
  const end = event => { held.delete(event.inputSource); grab.release(); };
  const changed = event => { for (const source of event.removed) held.delete(source); grab.release(); };
  const clear = () => { held.clear(); grab.release(); };
  session.addEventListener('selectstart', start);
  session.addEventListener('selectend', end);
  session.addEventListener('inputsourceschange', changed);
  session.addEventListener('visibilitychange', clear);
  session.addEventListener('end', clear);
  return frame => {
    if (session.visibilityState !== 'visible') { grab.release(); return; }
    const hands = new Map();
    for (const source of held) {
      // Vision Pro transient-pointer sources provide pinch poses in gripSpace.
      // Never substitute the gaze ray: its origin is the head, not the hand.
      const pose = source.gripSpace && frame.getPose(source.gripSpace, space);
      if (!pose) { grab.release(); return; }
      const p = pose.transform.position;
      if (![p.x, p.y, p.z].every(Number.isFinite)) { grab.release(); return; }
      hands.set(source, [p.x, p.y, p.z]);
    }
    if (grab.update(hands)) apply();
  };
}
