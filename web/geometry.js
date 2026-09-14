export const WIDTH = 518, HEIGHT = 392;
export const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

export function normalizeImage(rgba, width = WIDTH, height = HEIGHT) {
  if (rgba.length !== width * height * 4) throw new Error('Image dimensions do not match pixels.');
  const n = width * height, data = new Float32Array(n * 3);
  for (let i = 0; i < n; ++i)
    for (let c = 0; c < 3; ++c) data[c*n+i] = (rgba[4*i+c] / 255 - MEAN[c]) / STD[c];
  return data;
}

// Half-pixel bilinear resize, preserving floating-point model values.
export function resizeDepth(input, width, height, outWidth = WIDTH, outHeight = HEIGHT) {
  if (input.length !== width * height) throw new Error('Unexpected depth output dimensions.');
  if (width === outWidth && height === outHeight) return Float32Array.from(input);
  const out = new Float32Array(outWidth * outHeight);
  for (let y=0; y<outHeight; ++y) {
    const sy = Math.max(0, Math.min(height-1, (y+0.5)*height/outHeight-0.5));
    const y0 = Math.floor(sy), y1 = Math.min(y0+1,height-1), fy=sy-y0;
    for (let x=0; x<outWidth; ++x) {
      const sx = Math.max(0, Math.min(width-1, (x+0.5)*width/outWidth-0.5));
      const x0=Math.floor(sx), x1=Math.min(x0+1,width-1), fx=sx-x0;
      out[y*outWidth+x] = (input[y0*width+x0]*(1-fx)+input[y0*width+x1]*fx)*(1-fy)
        +(input[y1*width+x0]*(1-fx)+input[y1*width+x1]*fx)*fy;
    }
  }
  return out;
}

export function parseFloat32Tiff(buffer) {
  if (!buffer) throw new Error('Buffer is empty');
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 8) throw new Error('Invalid TIFF header length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isLE = view.getUint16(0) === 0x4949; // 'II'
  const magic = view.getUint16(2, isLE);
  if (magic !== 42) throw new Error('Not a valid TIFF');
  const ifdOffset = view.getUint32(4, isLE);
  if (ifdOffset + 2 > bytes.length) throw new Error('Invalid IFD offset');
  const numEntries = view.getUint16(ifdOffset, isLE);
  let width = 0, height = 0, stripOffset = 0;
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    const tag = view.getUint16(entryOffset, isLE);
    const type = view.getUint16(entryOffset + 2, isLE);
    const count = view.getUint32(entryOffset + 4, isLE);
    const val = (type === 3 && count === 1) ? view.getUint16(entryOffset + 8, isLE) : view.getUint32(entryOffset + 8, isLE);
    if (tag === 256) width = val;
    else if (tag === 257) height = val;
    else if (tag === 273) stripOffset = val;
  }
  if (!width || !height || !stripOffset || stripOffset + width * height * 4 > bytes.length) {
    throw new Error('Incomplete TIFF metadata or buffer overflow');
  }
  const floats = new Float32Array(width * height);
  const rawBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + stripOffset, width * height * 4);
  new Uint8Array(floats.buffer).set(rawBytes);
  return floats;
}

export function depthRange(depth) {
  const valid = Array.from(depth).filter(v => Number.isFinite(v) && v>0).sort((a,b)=>a-b);
  if (valid.length < depth.length * 0.9) throw new Error('Depth model returned too many invalid samples.');
  return [valid[Math.floor(valid.length*0.02)],valid[Math.floor(valid.length*0.98)]];
}

// Linear depth mapping to bounded display distance.
export function displayZ(z, range, spread = 1) {
  const t = Math.max(0, Math.min(1, (z - range[0]) / Math.max(1e-6, range[1] - range[0])));
  // At 4× spread, nearest samples remain positive and in front of camera.
  return Math.max(0.06, 2 + spread * (-0.5 + 1.72 * t));
}
export function pointAt(x, y, z_val, range, spread = 1) {
  const z = displayZ(z_val, range, spread);
  const focal = WIDTH / (2 * Math.tan(Math.PI / 6)); // assumed 60° horizontal field of view
  return [(x - (WIDTH - 1) / 2) * z / focal, ((HEIGHT - 1) / 2 - y) * z / focal, 2 - z];
}
export function pointCloud(depth, rgba, spread = 1, step = 1, rotated = null, centers = null) {
  if (depth.length !== WIDTH * HEIGHT || rgba.length !== WIDTH * HEIGHT * 4) throw new Error('Invalid point cloud input.');
  const range = depthRange(depth), data = [];
  const hasRot = rotated && rotated.length === WIDTH * HEIGHT * 4;
  const hasCent = centers && centers.length === WIDTH * HEIGHT * 3;
  for (let y = 0; y < HEIGHT; y += step) for (let x = 0; x < WIDTH; x += step) {
    const i = y * WIDTH + x, d = depth[i];
    if (!Number.isFinite(d) || d <= 0) continue;
    const pt = pointAt(x, y, d, range, spread);
    const r = rgba[i * 4] / 255, g = rgba[i * 4 + 1] / 255, b = rgba[i * 4 + 2] / 255;
    if (hasCent) {
      const ri = hasRot ? i * 4 : 0;
      const ci = i * 3;
      const cx = centers[ci], cy = centers[ci + 1], cz = centers[ci + 2];
      const isConvex = Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz);
      const cPt = isConvex ? pointAt(cx, cy, cz, range, spread) : pt;
      const rot = hasRot ? [rotated[ri], rotated[ri + 1], rotated[ri + 2], rotated[ri + 3]] : [0, 0, 0, 0];
      data.push(...pt, r, g, b, ...rot, ...cPt, isConvex ? 1.0 : 0.0);
    } else if (hasRot) {
      const ri = i * 4;
      data.push(...pt, r, g, b, rotated[ri], rotated[ri + 1], rotated[ri + 2], rotated[ri + 3]);
    } else {
      data.push(...pt, r, g, b);
    }
  }
  return { vertices: new Float32Array(data), range };
}
export function selectDetections(raw, threshold = 0.1, iouThreshold = 0.75) {
  const candidates = [];
  for (let i = 0; i < raw.length; i += 7) {
    const [score, y0, x0, y1, x1, centerDepth, depthScale] = raw.slice(i, i + 7);
    if (![score, y0, x0, y1, x1].every(Number.isFinite) || score < threshold || y1 <= y0 || x1 <= x0) continue;
    // Invalid or wholly outside candidates are not useful detections.
    if (x1 < 0 || y1 < 0 || x0 >= WIDTH || y0 >= HEIGHT) continue;
    candidates.push({ id: i / 7, score, x0, y0, x1, y1, centerDepth, depthScale });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const a of candidates) {
    if (kept.some(b => {
      const intersection = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
      return intersection / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - intersection) > iouThreshold;
    })) continue;
    kept.push(a);
  }
  return kept;
}
export function sphereLines(detections, depth, range, spread = 1) {
  const out = [];
  for (const d of detections) {
    const x = (d.x0 + d.x1) / 2, y = (d.y0 + d.y1) / 2;
    const { centerDepth, depthScale } = d;
    if (!Number.isFinite(centerDepth) || centerDepth <= 0 || !Number.isFinite(depthScale) || depthScale <= 0) continue;
    const radius = ((d.x1 - d.x0) + (d.y1 - d.y0)) / 4;
    // Match the radial sampling offset in Surface.surface. The RMSE also
    // applies a skew correction; these outlines show the base fitted profile.
    const offset = -(Math.sqrt(2) + Math.log(1 + Math.sqrt(2))) / 4;
    const fittedRadius = radius - offset;
    const point = (axis, a) => {
      const p = [0, 0, 0]; p[(axis + 1) % 3] = Math.cos(a); p[(axis + 2) % 3] = Math.sin(a);
      const rho = radius * Math.hypot(p[0], p[1]);
      const dz = Math.sign(p[2]) * Math.sqrt(Math.max(0, fittedRadius ** 2 - (rho - offset) ** 2)) / depthScale;
      const z = centerDepth + dz;
      return z > 0 ? pointAt(x + radius * p[0], y + radius * p[1], z, range, spread) : null;
    };
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < 64; i++) {
      const a = point(axis, i / 64 * Math.PI * 2), b = point(axis, (i + 1) / 64 * Math.PI * 2);
      if (a && b) out.push(...a, 1, 0.7, 0.2, ...b, 1, 0.7, 0.2);
    }
  }
  return new Float32Array(out);
}

export function depthLevelCurves(depth, range, spread = 1, numCurves = 100, step = 4) {
  if (!depth || depth.length !== WIDTH * HEIGHT || !range || numCurves <= 0) return new Float32Array();
  const [lo, hi] = range;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return new Float32Array();
  const out = [];
  const s = Math.max(1, Math.floor(step));
  const color = [0.2, 0.85, 0.95];
  const delta = (hi - lo) / (numCurves + 1);

  for (let y = 0; y + s < HEIGHT; y += s) {
    for (let x = 0; x + s < WIDTH; x += s) {
      const i0 = y * WIDTH + x;
      const i1 = y * WIDTH + (x + s);
      const i2 = (y + s) * WIDTH + (x + s);
      const i3 = (y + s) * WIDTH + x;

      const v0 = depth[i0], v1 = depth[i1], v2 = depth[i2], v3 = depth[i3];
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;
      if (v0 <= 0 || v1 <= 0 || v2 <= 0 || v3 <= 0) continue;

      const minV = Math.min(v0, v1, v2, v3);
      const maxV = Math.max(v0, v1, v2, v3);
      const k0 = Math.max(1, Math.ceil((minV - lo) / delta));
      const k1 = Math.min(numCurves, Math.floor((maxV - lo) / delta));
      if (k0 > k1) continue;

      for (let k = k0; k <= k1; k++) {
        const level = lo + k * delta;

        let mask = 0;
        if (v0 >= level) mask |= 1;
        if (v1 >= level) mask |= 2;
        if (v2 >= level) mask |= 4;
        if (v3 >= level) mask |= 8;

        if (mask === 0 || mask === 15) continue;

        const interp = (valA, valB, posA, posB) => {
          const denom = valB - valA;
          const t = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, (level - valA) / denom)) : 0.5;
          return posA + t * (posB - posA);
        };

        const edgePt = edge => {
          switch (edge) {
            case 0: return [interp(v0, v1, x, x + s), y];
            case 1: return [x + s, interp(v1, v2, y, y + s)];
            case 2: return [interp(v3, v2, x, x + s), y + s];
            case 3: return [x, interp(v0, v3, y, y + s)];
          }
        };

        const lines = [];
        switch (mask) {
          case 1:  case 14: lines.push(3, 0); break;
          case 2:  case 13: lines.push(0, 1); break;
          case 3:  case 12: lines.push(3, 1); break;
          case 4:  case 11: lines.push(1, 2); break;
          case 5:           lines.push(3, 0, 1, 2); break;
          case 6:  case 9:  lines.push(0, 2); break;
          case 7:  case 8:  lines.push(3, 2); break;
          case 10:          lines.push(0, 1, 2, 3); break;
        }

        for (let l = 0; l < lines.length; l += 2) {
          const [pxA, pyA] = edgePt(lines[l]);
          const [pxB, pyB] = edgePt(lines[l + 1]);
          const pA = pointAt(pxA, pyA, level, range, spread);
          const pB = pointAt(pxB, pyB, level, range, spread);
          if (pA && pB && pA.every(Number.isFinite) && pB.every(Number.isFinite)) {
            out.push(...pA, ...color, ...pB, ...color);
          }
        }
      }
    }
  }
  return new Float32Array(out);
}

export function depthFromZ(pz, range, spread = 1) {
  if (!range || range.length < 2) return null;
  const [lo, hi] = range;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const t = Math.max(0, Math.min(1, (0.5 - pz / Math.max(1e-6, spread)) / 1.72));
  return lo + t * (hi - lo);
}

export function depthLevelCurveAt(depth, range, spread = 1, level, step = 2) {
  if (!depth || depth.length !== WIDTH * HEIGHT || !range || !Number.isFinite(level)) {
    return { lines: new Float32Array(), segments: [] };
  }
  const [lo, hi] = range;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { lines: new Float32Array(), segments: [] };
  }
  const out = [];
  const segments = [];
  const s = Math.max(1, Math.floor(step));
  const color = [0.2, 0.85, 0.95];

  for (let y = 0; y + s < HEIGHT; y += s) {
    for (let x = 0; x + s < WIDTH; x += s) {
      const i0 = y * WIDTH + x;
      const i1 = y * WIDTH + (x + s);
      const i2 = (y + s) * WIDTH + (x + s);
      const i3 = (y + s) * WIDTH + x;

      const v0 = depth[i0], v1 = depth[i1], v2 = depth[i2], v3 = depth[i3];
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;
      if (v0 <= 0 || v1 <= 0 || v2 <= 0 || v3 <= 0) continue;

      const minV = Math.min(v0, v1, v2, v3);
      const maxV = Math.max(v0, v1, v2, v3);
      if (level < minV || level > maxV) continue;

      let mask = 0;
      if (v0 >= level) mask |= 1;
      if (v1 >= level) mask |= 2;
      if (v2 >= level) mask |= 4;
      if (v3 >= level) mask |= 8;

      if (mask === 0 || mask === 15) continue;

      const interp = (valA, valB, posA, posB) => {
        const denom = valB - valA;
        const t = Math.abs(denom) > 1e-6 ? Math.max(0, Math.min(1, (level - valA) / denom)) : 0.5;
        return posA + t * (posB - posA);
      };

      const edgePt = edge => {
        switch (edge) {
          case 0: return [interp(v0, v1, x, x + s), y];
          case 1: return [x + s, interp(v1, v2, y, y + s)];
          case 2: return [interp(v3, v2, x, x + s), y + s];
          case 3: return [x, interp(v0, v3, y, y + s)];
        }
      };

      const lines = [];
      switch (mask) {
        case 1:  case 14: lines.push(3, 0); break;
        case 2:  case 13: lines.push(0, 1); break;
        case 3:  case 12: lines.push(3, 1); break;
        case 4:  case 11: lines.push(1, 2); break;
        case 5:           lines.push(3, 0, 1, 2); break;
        case 6:  case 9:  lines.push(0, 2); break;
        case 7:  case 8:  lines.push(3, 2); break;
        case 10:          lines.push(0, 1, 2, 3); break;
      }

      for (let l = 0; l < lines.length; l += 2) {
        const [pxA, pyA] = edgePt(lines[l]);
        const [pxB, pyB] = edgePt(lines[l + 1]);
        const pA = pointAt(pxA, pyA, level, range, spread);
        const pB = pointAt(pxB, pyB, level, range, spread);
        if (pA && pB && pA.every(Number.isFinite) && pB.every(Number.isFinite)) {
          out.push(...pA, ...color, ...pB, ...color);
          segments.push([pA[0], pA[1], pA[2], pB[0], pB[1], pB[2]]);
        }
      }
    }
  }
  return { lines: new Float32Array(out), segments };
}

export function closestPointOnSegments(segments, point) {
  if (!segments || !segments.length || !point || point.length < 3) return null;
  let bestDistSq = Infinity;
  let bestPt = null;
  const [px, py, pz] = point;

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const ax = s[0], ay = s[1], az = s[2];
    const bx = s[3], by = s[4], bz = s[5];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const lenSq = dx * dx + dy * dy + dz * dz;
    let u = 0;
    if (lenSq > 1e-12) {
      u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq));
    }
    const cx = ax + u * dx, cy = ay + u * dy, cz = az + u * dz;
    const distSq = (px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestPt = [cx, cy, cz];
    }
  }
  return bestPt;
}

export function smallSphereLines(center, radius = 0.02, color = [1, 0.85, 0.2], segments = 24) {
  if (!center || center.length < 3) return new Float32Array();
  const out = [];
  const [cx, cy, cz] = center;

  // 3 orthogonal great circles
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
    out.push(
      cx + radius * Math.cos(a0), cy + radius * Math.sin(a0), cz, ...color,
      cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), cz, ...color
    );
    out.push(
      cx, cy + radius * Math.cos(a0), cz + radius * Math.sin(a0), ...color,
      cx, cy + radius * Math.cos(a1), cz + radius * Math.sin(a1), ...color
    );
    out.push(
      cx + radius * Math.sin(a0), cy, cz + radius * Math.cos(a0), ...color,
      cx + radius * Math.sin(a1), cy, cz + radius * Math.cos(a1), ...color
    );
  }

  // 2 latitude rings at +/- 45 deg
  const rLat = radius * Math.SQRT1_2;
  const dzLat = radius * Math.SQRT1_2;
  for (const sign of [-1, 1]) {
    const zLat = cz + sign * dzLat;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
      out.push(
        cx + rLat * Math.cos(a0), cy + rLat * Math.sin(a0), zLat, ...color,
        cx + rLat * Math.cos(a1), cy + rLat * Math.sin(a1), zLat, ...color
      );
    }
  }
  return new Float32Array(out);
}

export function curvatureVectorLines(closestPoint, grad, rotated, arrowLength = 0.08) {
  if (!closestPoint || closestPoint.length < 3) return new Float32Array();
  if (!grad || grad.length !== WIDTH * HEIGHT * 2) return new Float32Array();
  if (!rotated || rotated.length !== WIDTH * HEIGHT * 4) return new Float32Array();

  const [cx, cy, cz] = closestPoint;
  const z = 2 - cz;
  if (z <= 0.05) return new Float32Array();
  const focal = WIDTH / (2 * Math.tan(Math.PI / 6));
  const x = cx * focal / z + (WIDTH - 1) / 2;
  const y = (HEIGHT - 1) / 2 - cy * focal / z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return new Float32Array();
  }

  const x0 = Math.min(WIDTH - 1, Math.max(0, Math.floor(x)));
  const x1 = Math.min(WIDTH - 1, x0 + 1);
  const fx = x - x0;

  const y0 = Math.min(HEIGHT - 1, Math.max(0, Math.floor(y)));
  const y1 = Math.min(HEIGHT - 1, y0 + 1);
  const fy = y - y0;

  const sample2D = (data, stride, offset) => {
    const i00 = (y0 * WIDTH + x0) * stride + offset;
    const i01 = (y0 * WIDTH + x1) * stride + offset;
    const i10 = (y1 * WIDTH + x0) * stride + offset;
    const i11 = (y1 * WIDTH + x1) * stride + offset;
    return (data[i00] * (1 - fx) + data[i01] * fx) * (1 - fy)
         + (data[i10] * (1 - fx) + data[i11] * fx) * fy;
  };

  const gy = sample2D(grad, 2, 0);
  const gx = sample2D(grad, 2, 1);
  const gNorm = Math.hypot(gx, gy);
  if (gNorm <= 1e-12) return new Float32Array();

  const b0_x = gx / gNorm;
  const b0_y = gy / gNorm;

  const da2 = sample2D(rotated, 4, 0);
  const db2 = sample2D(rotated, 4, 3);
  const diagNorm = Math.hypot(da2, db2);

  const out = [];
  const appendArrow = (dir, len, color) => {
    const [dx, dy, dz] = dir;
    const tip = [cx + len * dx, cy + len * dy, cz + len * dz];
    out.push(
      cx, cy, cz, ...color,
      tip[0], tip[1], tip[2], ...color
    );
    const barbLen = len * 0.25;
    const cosA = 0.8660254; // cos(30 deg)
    const sinA = 0.5;       // sin(30 deg)
    const perp = [-dy, dx, 0];

    const b1 = [
      tip[0] - barbLen * (dx * cosA - perp[0] * sinA),
      tip[1] - barbLen * (dy * cosA - perp[1] * sinA),
      tip[2] - barbLen * (dz * cosA - perp[2] * sinA),
    ];
    const b2 = [
      tip[0] - barbLen * (dx * cosA + perp[0] * sinA),
      tip[1] - barbLen * (dy * cosA + perp[1] * sinA),
      tip[2] - barbLen * (dz * cosA + perp[2] * sinA),
    ];
    out.push(
      tip[0], tip[1], tip[2], ...color,
      b1[0], b1[1], b1[2], ...color,
      tip[0], tip[1], tip[2], ...color,
      b2[0], b2[1], b2[2], ...color
    );
  };

  // Vector 1: Normalized 2D direction of gradient in 3D: [b0_x, -b0_y, 0]
  appendArrow([b0_x, -b0_y, 0], arrowLength, [0.2, 1.0, 0.3]);

  // Vector 2: Diagonal terms in rotated as a single normalized vector with respect to rotated gradient
  if (diagNorm > 1e-12) {
    const w0 = da2 / diagNorm;
    const w1 = db2 / diagNorm;
    const v2_x = w0 * b0_x + w1 * b0_y;
    const v2_y = w0 * b0_y - w1 * b0_x;
    appendArrow([v2_x, -v2_y, 0], arrowLength, [1.0, 0.25, 0.75]);
  }

  return new Float32Array(out);
}

export function grabLevelCurveLines(depth, range, spread = 1, grabPositions = [], grad = null, rotated = null) {
  if (!depth || !range || !grabPositions || grabPositions.length !== 1) return new Float32Array();
  const grabPos = grabPositions[0];
  if (!grabPos || grabPos.length < 3) return new Float32Array();
  const level = depthFromZ(grabPos[2], range, spread);
  if (!Number.isFinite(level)) return new Float32Array();

  const { lines, segments } = depthLevelCurveAt(depth, range, spread, level, 2);
  const out = [];
  for (let i = 0; i < lines.length; i++) out.push(lines[i]);

  const closest = closestPointOnSegments(segments, grabPos);
  if (closest) {
    const sphere = smallSphereLines(closest, 0.02, [1, 0.85, 0.2]);
    for (let i = 0; i < sphere.length; i++) out.push(sphere[i]);

    if (grad && rotated) {
      const vectorLines = curvatureVectorLines(closest, grad, rotated, 0.08);
      for (let i = 0; i < vectorLines.length; i++) out.push(vectorLines[i]);

      const centerRes = centerEstimateAt(closest, level, grad, rotated, range, spread);
      if (centerRes && centerRes.isConvex && centerRes.center3D) {
        const c3 = centerRes.center3D;
        const lineColor = [1.0, 0.75, 0.2];
        out.push(
          closest[0], closest[1], closest[2], ...lineColor,
          c3[0], c3[1], c3[2], ...lineColor
        );
        const centerSphere = smallSphereLines(c3, 0.015, lineColor);
        for (let i = 0; i < centerSphere.length; i++) out.push(centerSphere[i]);
      }
    }
  }
  return new Float32Array(out);
}

export function pixelCenterEstimate(x, y, depthMap, grad, rotated, range = null, spread = 1) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return { xc: NaN, yc: NaN, zc: NaN, center3D: null, isConvex: false };
  }
  const idx = y * WIDTH + x;
  const d = depthMap ? depthMap[idx] : null;
  const gy = grad[idx * 2];
  const gx = grad[idx * 2 + 1];
  const da2 = rotated[idx * 4];
  const c01 = rotated[idx * 4 + 1];
  const c10 = rotated[idx * 4 + 2];
  const db2 = rotated[idx * 4 + 3];

  const det = da2 * db2 - c01 * c10;
  const diff = da2 - db2;
  const isConvex = det > 0 && da2 >= 0 && diff > 1e-6 && db2 > 1e-6;
  if (!isConvex) {
    return { xc: NaN, yc: NaN, zc: NaN, center3D: null, isConvex: false };
  }

  const xc = x - gx / db2;
  const yc = y - gy / db2;
  const norm2 = gx * gx + gy * gy;
  const dz = norm2 / diff;
  const zc = (d !== null && Number.isFinite(d)) ? d + dz : NaN;
  const center3D = (range && Number.isFinite(zc)) ? pointAt(xc, yc, zc, range, spread) : null;
  return { xc, yc, zc, center3D, isConvex: true };
}

export function centerEstimateAt(closestPoint, level, grad, rotated, range, spread = 1) {
  if (!closestPoint || closestPoint.length < 3 || !grad || !rotated || !range) return null;
  const [cx, cy, cz] = closestPoint;
  const z = 2 - cz;
  if (z <= 0.05) return null;
  const focal = WIDTH / (2 * Math.tan(Math.PI / 6));
  const x = cx * focal / z + (WIDTH - 1) / 2;
  const y = (HEIGHT - 1) / 2 - cy * focal / z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    return null;
  }

  const x0 = Math.min(WIDTH - 1, Math.max(0, Math.floor(x)));
  const x1 = Math.min(WIDTH - 1, x0 + 1);
  const fx = x - x0;
  const y0 = Math.min(HEIGHT - 1, Math.max(0, Math.floor(y)));
  const y1 = Math.min(HEIGHT - 1, y0 + 1);
  const fy = y - y0;

  const sample2D = (data, stride, offset) => {
    const i00 = (y0 * WIDTH + x0) * stride + offset;
    const i01 = (y0 * WIDTH + x1) * stride + offset;
    const i10 = (y1 * WIDTH + x0) * stride + offset;
    const i11 = (y1 * WIDTH + x1) * stride + offset;
    return (data[i00] * (1 - fx) + data[i01] * fx) * (1 - fy)
         + (data[i10] * (1 - fx) + data[i11] * fx) * fy;
  };

  const gy = sample2D(grad, 2, 0);
  const gx = sample2D(grad, 2, 1);
  const da2 = sample2D(rotated, 4, 0);
  const c01 = sample2D(rotated, 4, 1);
  const c10 = sample2D(rotated, 4, 2);
  const db2 = sample2D(rotated, 4, 3);

  const det = da2 * db2 - c01 * c10;
  const diff = da2 - db2;
  const isConvex = det > 0 && da2 >= 0 && diff > 1e-6 && db2 > 1e-6;
  if (!isConvex) {
    return { xc: NaN, yc: NaN, zc: NaN, center3D: null, isConvex: false };
  }

  const xc = x - gx / db2;
  const yc = y - gy / db2;
  const norm2 = gx * gx + gy * gy;
  const dz = norm2 / diff;
  const zc = level + dz;
  const center3D = pointAt(xc, yc, zc, range, spread);
  return { xc, yc, zc, center3D, isConvex: true };
}

export function cloudBounds(vertices) {
  if (!vertices || vertices.length < 6) {
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  }
  let stride = 6;
  if (vertices.length % 14 === 0 && vertices.length % 6 !== 0) stride = 14;
  else if (vertices.length % 10 === 0 && vertices.length % 6 !== 0) stride = 10;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += stride) {
    const x = vertices[i], y = vertices[i+1], z = vertices[i+2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5, minZ: -0.5, maxZ: 0.5 };
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function computeViewportPinchScale(points, {
  yaw = 0,
  pitch = 0,
  distance = 2,
  scale = 1,
  width = 800,
  height = 490,
  fovy = 65,
  targetPinchPx = 80,
  area = null
} = {}) {
  const f = 1 / Math.tan((fovy * Math.PI) / 360);
  const aspect = Math.max(0.001, width / Math.max(1, height));
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);

  // Default target area: bottom-left region of the viewport where the scale key sits
  const minX = area?.minX ?? 0;
  const maxX = area?.maxX ?? width * 0.45;
  const minY = area?.minY ?? height * 0.55;
  const maxY = area?.maxY ?? height;

  let totalDepth = 0, count = 0;
  let allDepth = 0, allCount = 0;

  if (points && points.length >= 6) {
    const stride = (points.length % 10 === 0 && points.length % 6 !== 0) ? 10 : 6;
    const step = Math.max(1, Math.floor(points.length / (stride * 2000))) * stride;
    for (let i = 0; i < points.length; i += step) {
      const x = points[i], y = points[i + 1], z = points[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      // Model transform: rotate by pitch around X, then yaw around Y, then scale
      const y1 = y * cosP - z * sinP;
      const z1 = y * sinP + z * cosP;

      const x2 = x * cosY + z1 * sinY;
      const z2 = -x * sinY + z1 * cosY;

      const xCam = x2 * scale;
      const yCam = y1 * scale;
      const zCam = z2 * scale - distance;
      const d = -zCam;
      if (d <= 0.05) continue;

      allDepth += d;
      allCount++;

      // Project to screen
      const xClip = (xCam * (f / aspect)) / d;
      const yClip = (yCam * f) / d;
      const px = (xClip + 1) * (width / 2);
      const py = (1 - yClip) * (height / 2);

      if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
        totalDepth += d;
        count++;
      }
    }
  }

  const avgDepth = count > 0 ? totalDepth / count : (allCount > 0 ? allDepth / allCount : distance);
  const pxPerMeter = (f * height) / (2 * Math.max(0.05, avgDepth));

  // Desired pinch size in screen pixels (~80px) converted to real-world meters
  const rawMeters = targetPinchPx / Math.max(1e-6, pxPerMeter);

  // Round to nearest clean metric increment
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
  let chosenMeters = steps[0];
  let minDiff = Infinity;
  for (const s of steps) {
    const diff = Math.abs(Math.log(rawMeters / s));
    if (diff < minDiff) {
      minDiff = diff;
      chosenMeters = s;
    }
  }

  const barWidthPx = Math.max(20, Math.min(width * 0.5, chosenMeters * pxPerMeter));
  const label = chosenMeters < 1 ? `${Math.round(chosenMeters * 100)} cm` : `${chosenMeters} m`;

  return {
    avgDepth,
    pxPerMeter,
    realWorldDistance: chosenMeters,
    barWidthPx,
    label,
    count
  };
}


