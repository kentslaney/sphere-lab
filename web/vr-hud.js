// Stroke font dictionary for uppercase letters, digits, and symbols.
// Coordinates are on a [0, 1] x [0, 1] normalized grid.
const STROKES = {
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
 * Builds interleaved RGBA vertex data for the WebGPU VR HUD scale card.
 * Vertices are positioned in view space (eye space in meters).
 * @param {Object} options
 * @param {number} [options.scale=1] - Point cloud scale (e.g. from pinch grab)
 * @param {number} [options.avgDepth=2.0] - Estimated distance to points in meters
 * @param {boolean} [options.isVisible=true] - Whether the scale legend is active
 * @returns {Float32Array} Interleaved [x, y, z, r, g, b, a] vertices
 */
export function buildVrHudVertices({
  scale = 1.0,
  avgDepth = 2.0,
  isVisible = true,
  position = [-0.21, -0.17, -0.80],
  cardWidth = 0.24,
  cardHeight = 0.092
} = {}) {
  if (!isVisible) return new Float32Array();

  const vertices = [];
  const z = position[2];
  const halfW = cardWidth / 2;
  const halfH = cardHeight / 2;
  const x0 = position[0] - halfW;
  const x1 = position[0] + halfW;
  const y0 = position[1] - halfH;
  const y1 = position[1] + halfH;

  // Helper: push a planar quad (2 triangles = 6 vertices)
  const pushQuad = (qx0, qy0, qx1, qy1, color, qz = z) => {
    const [r, g, b, a] = color;
    vertices.push(
      qx0, qy0, qz, r, g, b, a,
      qx1, qy0, qz, r, g, b, a,
      qx1, qy1, qz, r, g, b, a,
      qx0, qy0, qz, r, g, b, a,
      qx1, qy1, qz, r, g, b, a,
      qx0, qy1, qz, r, g, b, a
    );
  };

  // Helper: push a thick line segment as an oriented quad
  const pushRibbon = (px1, py1, px2, py2, thickness, color, qz = z + 0.0005) => {
    const dx = px2 - px1;
    const dy = py2 - py1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = (-dy / len) * (thickness / 2);
    const ny = (dx / len) * (thickness / 2);
    const [r, g, b, a] = color;
    vertices.push(
      px1 - nx, py1 - ny, qz, r, g, b, a,
      px1 + nx, py1 + ny, qz, r, g, b, a,
      px2 + nx, py2 + ny, qz, r, g, b, a,
      px1 - nx, py1 - ny, qz, r, g, b, a,
      px2 + nx, py2 + ny, qz, r, g, b, a,
      px2 - nx, py2 - ny, qz, r, g, b, a
    );
  };

  // Helper: draw vector-stroke text using the STROKES dictionary
  const drawText = (str, startX, startY, charH, charW, spacing, thickness, color) => {
    let curX = startX;
    for (const char of str.toUpperCase()) {
      const glyph = STROKES[char];
      if (glyph) {
        for (const [gx1, gy1, gx2, gy2] of glyph) {
          pushRibbon(
            curX + gx1 * charW,
            startY + gy1 * charH,
            curX + gx2 * charW,
            startY + gy2 * charH,
            thickness,
            color
          );
        }
      }
      curX += charW + spacing;
    }
    return curX;
  };

  // 1. Dark translucent card background: rgba(10, 17, 25, 0.85)
  pushQuad(x0, y0, x1, y1, [0.039, 0.067, 0.098, 0.85], z);

  // 2. Subtle outer border: rgba(80, 140, 180, 0.35)
  const borderT = 0.0012;
  pushQuad(x0, y1 - borderT, x1, y1, [0.31, 0.55, 0.70, 0.35], z + 0.0002);
  pushQuad(x0, y0, x1, y0 + borderT, [0.31, 0.55, 0.70, 0.35], z + 0.0002);
  pushQuad(x0, y0, x0 + borderT, y1, [0.31, 0.55, 0.70, 0.35], z + 0.0002);
  pushQuad(x1 - borderT, y0, x1, y1, [0.31, 0.55, 0.70, 0.35], z + 0.0002);

  // 3. Header: "PINCH SCALE" and "DEPTH X.XX M"
  const padX = 0.014;
  const headerY = y1 - 0.020;
  drawText('PINCH SCALE', x0 + padX, headerY, 0.0085, 0.006, 0.002, 0.0011, [0.72, 0.86, 0.96, 0.95]);

  const depthStr = `DEPTH ${Number.isFinite(avgDepth) ? avgDepth.toFixed(2) : '2.00'}M`;
  drawText(depthStr, x0 + padX + 0.125, headerY, 0.0075, 0.0055, 0.0018, 0.001, [0.48, 0.65, 0.78, 0.85]);

  // 4. Scale Bar Track (subtle background bar)
  const trackX0 = x0 + padX;
  const trackX1 = x1 - padX;
  const trackY = position[1] - 0.004;
  const trackH = 0.003;
  pushQuad(trackX0, trackY - trackH / 2, trackX1, trackY + trackH / 2, [0.12, 0.20, 0.28, 0.7], z + 0.0003);

  // 5. Calibrated Scale Calculation:
  // We want the physical bar width in VR to represent a clean real-world distance in the cloud.
  // When cloud is scaled by `scale`, model distance `d` appears at physical span `d * scale`.
  const targetBarWidth = 0.10; // ~10 cm target physical pinch bar width in the HUD
  const rawModelMeters = targetBarWidth / Math.max(0.01, scale);
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];
  let chosenMetric = steps[0];
  let minDiff = Infinity;
  for (const s of steps) {
    const diff = Math.abs(Math.log(rawModelMeters / s));
    if (diff < minDiff) {
      minDiff = diff;
      chosenMetric = s;
    }
  }

  // Physical width of this calibrated metric distance in the VR HUD
  let barLength = chosenMetric * scale;
  // Keep the visual bar comfortably bounded within track
  const maxBarWidth = trackX1 - trackX0 - 0.045;
  barLength = Math.max(0.035, Math.min(maxBarWidth, barLength));

  const barX1 = trackX0 + barLength;
  const barColor = [0.52, 0.87, 0.74, 1.0]; // Bright illuminated teal (#84ddbd)

  // Active single-axis scale bar
  pushQuad(trackX0, trackY - 0.0018, barX1, trackY + 0.0018, barColor, z + 0.0006);

  // Start, Mid, and End Ticks
  const tickH = 0.012;
  const tickT = 0.0015;
  pushRibbon(trackX0, trackY - tickH / 2, trackX0, trackY + tickH / 2, tickT, barColor, z + 0.0007);
  pushRibbon(barX1, trackY - tickH / 2, barX1, trackY + tickH / 2, tickT, barColor, z + 0.0007);
  const midX = (trackX0 + barX1) / 2;
  pushRibbon(midX, trackY - tickH * 0.35, midX, trackY + tickH * 0.35, tickT, barColor, z + 0.0007);

  // 6. Metric distance label (e.g. "10 CM" or "0.5 M")
  const distLabel = chosenMetric < 1 ? `${Math.round(chosenMetric * 100)}CM` : `${chosenMetric}M`;
  drawText(distLabel, barX1 + 0.006, trackY - 0.004, 0.009, 0.006, 0.002, 0.0012, barColor);

  // 7. Caption: "REAL-WORLD PINCH DISTANCE"
  const captionY = y0 + 0.010;
  drawText('REAL-WORLD PINCH DISTANCE', x0 + padX, captionY, 0.0055, 0.004, 0.0015, 0.0009, [0.50, 0.65, 0.76, 0.70]);

  return new Float32Array(vertices);
}
