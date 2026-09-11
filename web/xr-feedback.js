// Stroke font dictionary for uppercase letters, digits, and symbols.
// Coordinates are on a [0, 1] x [0, 1] normalized grid.
export const STROKES = {
  'A': [[0,0, 0.5,1], [0.5,1, 1,0], [0.2,0.4, 0.8,0.4]],
  'B': [[0,0, 0,1], [0,1, 0.7,1], [0.7,1, 0.7,0.5], [0.7,0.5, 0,0.5], [0,0.5, 0.8,0.5], [0.8,0.5, 0.8,0], [0.8,0, 0,0]],
  'C': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0]],
  'D': [[0,0, 0,1], [0,1, 0.7,1], [0.7,1, 1,0.7], [1,0.7, 1,0.3], [1,0.3, 0.7,0], [0.7,0, 0,0]],
  'E': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [0,0.5, 0.7,0.5]],
  'F': [[0,0, 0,1], [0,1, 1,1], [0,0.5, 0.7,0.5]],
  'G': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [1,0, 1,0.5], [1,0.5, 0.5,0.5]],
  'H': [[0,0, 0,1], [1,0, 1,1], [0,0.5, 1,0.5]],
  'I': [[0.5,0, 0.5,1], [0.2,1, 0.8,1], [0.2,0, 0.8,0]],
  'J': [[0.2,0.3, 0.4,0], [0.4,0, 0.7,0], [0.7,0, 0.7,1], [0.4,1, 1,1]],
  'K': [[0,0, 0,1], [1,1, 0,0.4], [0.3,0.55, 1,0]],
  'L': [[0,1, 0,0], [0,0, 0.9,0]],
  'M': [[0,0, 0,1], [0,1, 0.5,0.4], [0.5,0.4, 1,1], [1,1, 1,0]],
  'N': [[0,0, 0,1], [0,1, 1,0], [1,0, 1,1]],
  'O': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0]],
  'P': [[0,0, 0,1], [0,1, 1,1], [1,1, 1,0.5], [1,0.5, 0,0.5]],
  'Q': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0], [0.6,0.4, 1,-0.1]],
  'R': [[0,0, 0,1], [0,1, 1,1], [1,1, 1,0.5], [1,0.5, 0,0.5], [0.4,0.5, 1,0]],
  'S': [[1,1, 0,1], [0,1, 0,0.5], [0,0.5, 1,0.5], [1,0.5, 1,0], [1,0, 0,0]],
  'T': [[0,1, 1,1], [0.5,1, 0.5,0]],
  'U': [[0,1, 0,0], [0,0, 1,0], [1,0, 1,1]],
  'V': [[0,1, 0.5,0], [0.5,0, 1,1]],
  'W': [[0,1, 0.25,0], [0.25,0, 0.5,0.6], [0.5,0.6, 0.75,0], [0.75,0, 1,1]],
  'X': [[0,0, 1,1], [0,1, 1,0]],
  'Y': [[0,1, 0.5,0.5], [1,1, 0.5,0.5], [0.5,0.5, 0.5,0]],
  'Z': [[0,1, 1,1], [1,1, 0,0], [0,0, 1,0]],
  '0': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0], [0.1,0.1, 0.9,0.9]],
  '1': [[0.2,0.8, 0.5,1], [0.5,1, 0.5,0], [0.2,0, 0.8,0]],
  '2': [[0,1, 1,1], [1,1, 1,0.5], [1,0.5, 0,0.5], [0,0.5, 0,0], [0,0, 1,0]],
  '3': [[0,1, 1,1], [1,1, 1,0], [1,0, 0,0], [0,0.5, 1,0.5]],
  '4': [[0,1, 0,0.5], [0,0.5, 1,0.5], [1,1, 1,0]],
  '5': [[1,1, 0,1], [0,1, 0,0.5], [0,0.5, 1,0.5], [1,0.5, 1,0], [1,0, 0,0]],
  '6': [[1,1, 0,1], [0,1, 0,0], [0,0, 1,0], [1,0, 1,0.5], [1,0.5, 0,0.5]],
  '7': [[0,1, 1,1], [1,1, 0.3,0]],
  '8': [[0,0, 1,0], [1,0, 1,1], [1,1, 0,1], [0,1, 0,0], [0,0.5, 1,0.5]],
  '9': [[1,0.5, 0,0.5], [0,0.5, 0,1], [0,1, 1,1], [1,1, 1,0], [1,0, 0,0]],
  '.': [[0.3,0, 0.7,0], [0.5,-0.05, 0.5,0.05]],
  '-': [[0.2,0.5, 0.8,0.5]],
  ' ': []
};

/**
 * Formats distance according to user specifications:
 * e.g., 0.20m -> "20 CM"
 */
export function formatDistance(meters) {
  if (meters < 1) {
    const cm = meters * 100;
    const rounded = Math.round(cm);
    return (Math.abs(cm - rounded) < 0.05 ? rounded : cm.toFixed(1)) + ' CM';
  }
  return meters.toFixed(2) + ' M';
}

/**
 * Calculates the updated distance between scaled version of points:
 * D = S_0^2 / S_1
 */
export function calculateScaledDistance(origin0, origin1, pos0, pos1) {
  const s0 = Math.hypot(origin1[0] - origin0[0], origin1[1] - origin0[1], origin1[2] - origin0[2]);
  const s1 = Math.hypot(pos1[0] - pos0[0], pos1[1] - pos0[1], pos1[2] - pos0[2]);
  if (s0 < 1e-4) return 0;
  return (s0 * s0) / Math.max(1e-4, s1);
}

/**
 * Builds UV sphere triangle vertices.
 */
function pushSphere(vertices, center, radius, color, alpha) {
  const vertex = (latitude, longitude) => {
    const normal = [
      Math.sin(latitude) * Math.cos(longitude),
      Math.cos(latitude),
      Math.sin(latitude) * Math.sin(longitude)
    ];
    const light = 0.65 + 0.35 * Math.max(0, normal[0] * -0.3 + normal[1] * 0.7 + normal[2] * 0.64);
    return [
      center[0] + radius * normal[0],
      center[1] + radius * normal[1],
      center[2] + radius * normal[2],
      color[0] * light,
      color[1] * light,
      color[2] * light,
      alpha
    ];
  };
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 16; i++) {
      const a = vertex(j * Math.PI / 8, i * Math.PI / 8);
      const b = vertex((j + 1) * Math.PI / 8, i * Math.PI / 8);
      const c = vertex((j + 1) * Math.PI / 8, (i + 1) * Math.PI / 8);
      const d = vertex(j * Math.PI / 8, (i + 1) * Math.PI / 8);
      vertices.push(...a, ...c, ...b, ...a, ...d, ...c);
    }
  }
}

/**
 * Builds a 3D translucent line/tube between two points as a 4-sided prism.
 */
function pushTranslucentLine(vertices, p0, p1, radius, color, alpha) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-5) return;
  const dir = [dx / len, dy / len, dz / len];
  const up = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  // Orthogonal basis
  const u = [
    dir[1] * up[2] - dir[2] * up[1],
    dir[2] * up[0] - dir[0] * up[2],
    dir[0] * up[1] - dir[1] * up[0]
  ];
  const uLen = Math.hypot(...u);
  const uNorm = u.map(v => (v / uLen) * radius);
  const vNorm = [
    dir[1] * uNorm[2] - dir[2] * uNorm[1],
    dir[2] * uNorm[0] - dir[0] * uNorm[2],
    dir[0] * uNorm[1] - dir[1] * uNorm[0]
  ];

  const c0 = [p0[0] + uNorm[0], p0[1] + uNorm[1], p0[2] + uNorm[2]];
  const c1 = [p0[0] + vNorm[0], p0[1] + vNorm[1], p0[2] + vNorm[2]];
  const c2 = [p0[0] - uNorm[0], p0[1] - uNorm[1], p0[2] - uNorm[2]];
  const c3 = [p0[0] - vNorm[0], p0[1] - vNorm[1], p0[2] - vNorm[2]];

  const d0 = [p1[0] + uNorm[0], p1[1] + uNorm[1], p1[2] + uNorm[2]];
  const d1 = [p1[0] + vNorm[0], p1[1] + vNorm[1], p1[2] + vNorm[2]];
  const d2 = [p1[0] - uNorm[0], p1[1] - uNorm[1], p1[2] - uNorm[2]];
  const d3 = [p1[0] - vNorm[0], p1[1] - vNorm[1], p1[2] - vNorm[2]];

  const pushQuad = (q0, q1, q2, q3) => {
    vertices.push(
      q0[0], q0[1], q0[2], color[0], color[1], color[2], alpha,
      q1[0], q1[1], q1[2], color[0], color[1], color[2], alpha,
      q2[0], q2[1], q2[2], color[0], color[1], color[2], alpha,
      q0[0], q0[1], q0[2], color[0], color[1], color[2], alpha,
      q2[0], q2[1], q2[2], color[0], color[1], color[2], alpha,
      q3[0], q3[1], q3[2], color[0], color[1], color[2], alpha
    );
  };

  pushQuad(c0, d0, d1, c1);
  pushQuad(c1, d1, d2, c2);
  pushQuad(c2, d2, d3, c3);
  pushQuad(c3, d3, d0, c0);
}

/**
 * Builds billboarded text box highlight with vector strokes in front of the line.
 */
function pushMidpointTextBox(vertices, midpoint, text, viewerPos = [0, 0, 0]) {
  // Vector towards viewer
  const vx = viewerPos[0] - midpoint[0];
  const vy = viewerPos[1] - midpoint[1];
  const vz = viewerPos[2] - midpoint[2];
  const vLen = Math.hypot(vx, vy, vz);
  const n = vLen > 1e-4 ? [vx / vLen, vy / vLen, vz / vLen] : [0, 0, 1];

  // Up and Right basis vectors
  const up = Math.abs(n[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const rX = up[1] * n[2] - up[2] * n[1];
  const rY = up[2] * n[0] - up[0] * n[2];
  const rZ = up[0] * n[1] - up[1] * n[0];
  const rLen = Math.hypot(rX, rY, rZ);
  const right = [rX / rLen, rY / rLen, rZ / rLen];
  const uY = n[1] * right[2] - n[2] * right[1];
  const uZ = n[2] * right[0] - n[0] * right[2];
  const uX = n[0] * right[1] - n[1] * right[0];
  const top = [uY, uZ, uX]; // orthonormal up

  // Position text box in front of the line towards the viewer
  const frontOffset = 0.015; // 15mm in front of the line
  const center = [
    midpoint[0] + n[0] * frontOffset,
    midpoint[1] + n[1] * frontOffset,
    midpoint[2] + n[2] * frontOffset
  ];

  const charW = 0.009;
  const charH = 0.014;
  const spacing = 0.011;
  const padX = 0.010;
  const padY = 0.006;
  const totalW = text.length * spacing + padX * 2;
  const totalH = charH + padY * 2;
  const halfW = totalW / 2;
  const halfH = totalH / 2;

  // Lighter text box highlight than line on empty background
  // High luminance tint [0.88, 0.94, 1.0] with solid translucent alpha 0.88
  const bgCol = [0.88, 0.94, 1.0];
  const bgAlpha = 0.88;

  const q0 = [
    center[0] - right[0] * halfW - top[0] * halfH,
    center[1] - right[1] * halfW - top[1] * halfH,
    center[2] - right[2] * halfW - top[2] * halfH
  ];
  const q1 = [
    center[0] + right[0] * halfW - top[0] * halfH,
    center[1] + right[1] * halfW - top[1] * halfH,
    center[2] + right[2] * halfW - top[2] * halfH
  ];
  const q2 = [
    center[0] + right[0] * halfW + top[0] * halfH,
    center[1] + right[1] * halfW + top[1] * halfH,
    center[2] + right[2] * halfW + top[2] * halfH
  ];
  const q3 = [
    center[0] - right[0] * halfW + top[0] * halfH,
    center[1] - right[1] * halfW + top[1] * halfH,
    center[2] - right[2] * halfW + top[2] * halfH
  ];

  // Quad vertices
  vertices.push(
    q0[0], q0[1], q0[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha,
    q1[0], q1[1], q1[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha,
    q2[0], q2[1], q2[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha,
    q0[0], q0[1], q0[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha,
    q2[0], q2[1], q2[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha,
    q3[0], q3[1], q3[2], bgCol[0], bgCol[1], bgCol[2], bgAlpha
  );

  // Stroke text on top of the highlight quad (further forward by 1mm)
  const textOffset = 0.001;
  const strokeCol = [0.05, 0.08, 0.14];
  const strokeAlpha = 0.95;
  const strokeThickness = 0.0012;
  const startX = -halfW + padX;
  const startY = -halfH + padY;

  for (let cIdx = 0; cIdx < text.length; cIdx++) {
    const ch = text[cIdx];
    const strokes = STROKES[ch] || STROKES[' '];
    const chBaseX = startX + cIdx * spacing;
    for (const seg of strokes) {
      const sx0 = chBaseX + seg[0] * charW;
      const sy0 = startY + seg[1] * charH;
      const sx1 = chBaseX + seg[2] * charW;
      const sy1 = startY + seg[3] * charH;

      const segDx = sx1 - sx0;
      const segDy = sy1 - sy0;
      const segLen = Math.hypot(segDx, segDy);
      if (segLen < 1e-5) continue;
      const segNx = (-segDy / segLen) * (strokeThickness / 2);
      const segNy = (segDx / segLen) * (strokeThickness / 2);

      const pt = (rx, ry) => [
        center[0] + n[0] * textOffset + right[0] * rx + top[0] * ry,
        center[1] + n[1] * textOffset + right[1] * rx + top[1] * ry,
        center[2] + n[2] * textOffset + right[2] * rx + top[2] * ry
      ];

      const pA = pt(sx0 - segNx, sy0 - segNy);
      const pB = pt(sx0 + segNx, sy0 + segNy);
      const pC = pt(sx1 + segNx, sy1 + segNy);
      const pD = pt(sx1 - segNx, sy1 - segNy);

      vertices.push(
        pA[0], pA[1], pA[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha,
        pB[0], pB[1], pB[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha,
        pC[0], pC[1], pC[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha,
        pA[0], pA[1], pA[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha,
        pC[0], pC[1], pC[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha,
        pD[0], pD[1], pD[2], strokeCol[0], strokeCol[1], strokeCol[2], strokeAlpha
      );
    }
  }
}

/**
 * Builds grab feedback vertices:
 * - Spherical origin shells and moving beads for each hand.
 * - When 2 hands are active: translucent line between gesture start points,
 *   with a lighter text box highlight rendered in front of the line displaying
 *   the updated scaled distance.
 */
export function grabFeedbackVertices(markers, viewerPos = [0, 0, 0]) {
  const vertices = [];
  // Render hand beads/shells
  for (const { origin, position, elapsed = 0 } of markers.slice(0, 2)) {
    const t = Math.max(0, Math.min(1, elapsed / 300));
    const progress = t * t * (3 - 2 * t);
    const radius = 0.045 + (0.009 - 0.045) * progress;
    const alpha = 0.18 + 0.82 * progress;
    const center = origin.map((v, i) => v + (position[i] - v) * progress);
    const color = [1, 1, 1];

    pushSphere(vertices, origin, 0.045, color, 0.18);
    pushSphere(vertices, center, radius, color, alpha);
  }

  // When two hands are pinching: render measurement line between gesture start points
  if (markers.length >= 2) {
    const p0 = markers[0].origin;
    const p1 = markers[1].origin;
    const h0 = markers[0].position;
    const h1 = markers[1].position;

    // Line color: cool translucent tint, luminance ~0.55, alpha 0.40
    const lineColor = [0.35, 0.55, 0.8];
    const lineAlpha = 0.40;
    pushTranslucentLine(vertices, p0, p1, 0.003, lineColor, lineAlpha);

    // Calculate scaled distance: D = S_0^2 / S_1
    const scaledDist = calculateScaledDistance(p0, p1, h0, h1);
    const text = formatDistance(scaledDist);
    const midpoint = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];

    // Render midpoint text box in front of the line
    pushMidpointTextBox(vertices, midpoint, text, viewerPos);
  }

  return new Float32Array(vertices);
}

/**
 * Builds debug sphere vertices for desktop raycast debugging.
 */
export function buildDebugSphereVertices(center, radius = 0.04, color = [0.2, 0.9, 0.8], alpha = 0.75) {
  const vertices = [];
  pushSphere(vertices, center, radius, color, alpha);
  return new Float32Array(vertices);
}
