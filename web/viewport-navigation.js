const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

// Choose a near surface inside a 30px diameter cone. Empty regions use the
// cloud's median visible depth plane so adjacent fallback grabs are consistent.
export function raycastDistance(points, camera, ray, forward, height, focal) {
  let hit = Infinity;
  const depths = [];
  const threshold = (30 / (height * focal)) ** 2;
  for (let i = 0; i < (points?.length ?? 0); i += 6) {
    const p = [points[i] - camera[0], points[i + 1] - camera[1], points[i + 2] - camera[2]];
    const depth = dot(p, forward);
    if (!Number.isFinite(depth) || depth < 0.05 || depth > 100) continue;
    depths.push(depth);
    const t = dot(p, ray);
    if (t > 0.05 && (dot(p, p) - t * t) / (t * t) <= threshold) hit = Math.min(hit, t);
  }
  if (Number.isFinite(hit)) return hit;
  depths.sort((a, b) => a - b);
  const depth = depths.length ? depths[Math.floor(depths.length / 2)] : 2;
  return depth / Math.max(0.05, dot(ray, forward));
}

// Fixed-FOV camera translation, fitting all point/ray constraints. A single
// touch pans at its grabbed depth; separated touches also constrain dolly.
// Incompatible finger motions use a least-squares fit, without changing FOV.
export function solveTouchCamera(camera, basis, touches) {
  if (!touches.length) return [...camera];
  const { right, up, forward } = basis;
  const rows = touches.map(({ point, ray }) => {
    const p = point.map((v, i) => v - camera[i]);
    const rz = Math.max(0.001, dot(ray, forward));
    const sx = dot(ray, right) / rz, sy = dot(ray, up) / rz;
    const z = dot(p, forward);
    return { sx, sy, bx: dot(p, right) - sx * z, by: dot(p, up) - sy * z, z };
  });
  const n = rows.length;
  const mean = key => rows.reduce((s, r) => s + r[key], 0) / n;
  const sx = mean('sx'), sy = mean('sy'), bx = mean('bx'), by = mean('by');
  let variance = 0, covariance = 0;
  for (const r of rows) {
    variance += (r.sx - sx) ** 2 + (r.sy - sy) ** 2;
    covariance += (r.sx - sx) * (r.bx - bx) + (r.sy - sy) * (r.by - by);
  }
  let dz = variance > 0.0001 ? -covariance / variance : 0;
  // Keep every anchor in front of the near plane and avoid runaway dolly when
  // fingers nearly coincide. Panning is recomputed at the bounded depth.
  dz = Math.max(Math.max(...rows.map(r => r.z)) - 100, Math.min(Math.min(...rows.map(r => r.z)) - 0.06, dz));
  const dx = bx + sx * dz, dy = by + sy * dz;
  return camera.map((v, i) => v + right[i] * dx + up[i] * dy + forward[i] * dz);
}

export function wheelTranslation(event, basis, height) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
  const axis = event.shiftKey ? basis.up : basis.forward;
  return axis.map((v, i) => 0.002 * unit * (basis.right[i] * event.deltaX - v * event.deltaY));
}
