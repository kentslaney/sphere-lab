export const MENU_ITEMS = ['Test option', 'Cancel'];
export const MENU_WIDTH = 512;
export const MENU_HEIGHT = 224;

// Canvas owns all menu styling and text; WGSL samples the exported RGBA texture.
export function menuPixels(selected) {
  const canvas = document.createElement('canvas');
  canvas.width = MENU_WIDTH; canvas.height = MENU_HEIGHT;
  const ctx = canvas.getContext('2d');
  const box = (x, y, w, h, r, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  };
  box(4, 4, 504, 216, 24, '#f5f5f5');
  box(16, 16 + selected * 96, 480, 96, 14, '#d9e4f2');
  ctx.font = '32px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  MENU_ITEMS.forEach((text, i) => ctx.fillText(text, 40, 64 + i * 96));
  return new Uint8Array(ctx.getImageData(0, 0, MENU_WIDTH, MENU_HEIGHT).data.buffer);
}

// A world-space billboard, anchored at the second grab with Cancel at hand height.
export function menuVertices(origin, viewer) {
  const dx = viewer[0] - origin[0], dz = viewer[2] - origin[2];
  const length = Math.hypot(dx, dz);
  const right = length > 1e-5 ? [dz / length, 0, -dx / length] : [1, 0, 0];
  const width = 0.24, height = width * MENU_HEIGHT / MENU_WIDTH;
  return new Float32Array([[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]].flatMap(([u,v]) =>
    [...origin.map((p,i) => p + right[i] * ((u - 0.5) * width) + (i === 1 ? (160 / MENU_HEIGHT - v) * height : 0)), u, v]));
}
