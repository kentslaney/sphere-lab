export const MENU_ITEMS = ['config', 'debug', 'Cancel'];
export const getMenuItems = (debug = false) => ['config', debug ? 'reset' : 'debug', 'Cancel'];
export const MENU_WIDTH = 512;
export const MENU_HEIGHT = 320;

// Canvas owns all menu styling and text; WGSL samples the exported RGBA texture.
export function menuPixels(selected, items = MENU_ITEMS, hint = '') {
  const height = menuHeight(items, hint);
  const canvas = document.createElement('canvas');
  canvas.width = MENU_WIDTH; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const box = (x, y, w, h, r, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  };
  box(4, 4, 504, height - 8, 24, '#f5f5f5');
  if (selected >= 0) box(16, 16 + selected * 96, 480, 96, 14, '#d9e4f2');
  ctx.font = '32px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  items.forEach((text, i) => ctx.fillText(text, 40, 64 + i * 96));
  if (hint) { ctx.font = '20px system-ui, sans-serif'; ctx.fillStyle = '#444'; ctx.fillText(hint, 28, height - 28, MENU_WIDTH - 56); }
  return new Uint8Array(ctx.getImageData(0, 0, MENU_WIDTH, height).data.buffer);
}

export const menuHeight = (items = MENU_ITEMS, hint = '') => 32 + items.length * 96 + (hint ? 48 : 0);

// A world-space billboard, anchored at the second grab with Cancel at hand height.
export function menuVertices(origin, viewer, textureHeight = MENU_HEIGHT, anchorRow = 2, fixedRight = null) {
  const dx = viewer[0] - origin[0], dz = viewer[2] - origin[2];
  const length = Math.hypot(dx, dz);
  const right = fixedRight ?? (length > 1e-5 ? [dz / length, 0, -dx / length] : [1, 0, 0]);
  const width = 0.24, height = width * textureHeight / MENU_WIDTH;
  return new Float32Array([[0,0],[0,1],[1,1],[0,0],[1,1],[1,0]].flatMap(([u,v]) =>
    [...origin.map((p,i) => p + right[i] * ((u - 0.5) * width) + (i === 1 ? ((64 + anchorRow * 96) / textureHeight - v) * height : 0)), u, v]));
}
