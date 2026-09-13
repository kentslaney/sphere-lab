export const spreadFromSlider = value => 2 ** Number(value);
export const spreadToSlider = value => Math.log2(Math.max(0.25, Math.min(4, value)));

// Config owns all XR input while open. Unpressed pointers hover over rows;
// pressing locks that row until release, with only horizontal motion editing it.
export class XRConfig {
  constructor(read, write) { this.read = read; this.write = write; this.close(); }
  open(origin, right) {
    this.isOpen = true; this.origin = [...origin]; this.right = [...right];
    this.selected = 4; this.anchor = null;
  }
  close() { this.isOpen = false; this.anchor = null; }
  cancelGrab() { this.anchor = null; }
  rowAt(p) {
    const x = p.reduce((sum, v, i) => sum + (v - this.origin[i]) * this.right[i], 0);
    const row = Math.round(4 - (p[1] - this.origin[1]) / 0.045);
    return Math.abs(x) <= 0.12 && row >= 0 && row <= 4 ? Math.max(0, row) : -1;
  }
  update(pointers, held = new Set()) {
    if (held.size > 1) { this.cancelGrab(); return; }
    if (this.anchor && (!held.has(this.anchor.source) || !pointers.has(this.anchor.source))) this.cancelGrab();
    if (!this.anchor) {
      const entries = held.size ? [...pointers].filter(([source]) => held.has(source)) : [...pointers];
      const hovered = entries.find(([, p]) => this.rowAt(p) >= 0);
      this.selected = hovered ? this.rowAt(hovered[1]) : -1;
      if (!hovered || !held.has(hovered[0])) return;
      this.anchor = { source: hovered[0], p: [...hovered[1]], selected: this.selected, values: this.read() };
    }
    const a = this.anchor, p = pointers.get(a.source);
    const dx = p.reduce((sum, v, i) => sum + (v - a.p[i]) * this.right[i], 0);
    const current = this.read();
    if (a.selected === 0) {
      const spread = 2 ** Math.max(-2, Math.min(2, Math.log2(a.values.spread) + dx * 16));
      if (Math.abs(Math.log2(spread / current.spread)) > 0.005) this.write('spread', spread);
    } else if (a.selected === 1) {
      const threshold = Math.round(Math.max(0, Math.min(1, a.values.threshold + dx * 4)) * 100) / 100;
      if (threshold !== current.threshold) this.write('threshold', threshold);
    } else if (a.selected === 2) {
      const baseCurves = a.values.curves ?? 100;
      const curves = Math.round(Math.max(1, Math.min(200, baseCurves + dx * 40)));
      if (curves !== current.curves) this.write('curves', curves);
    }
  }
  end(source) {
    if (this.anchor?.source !== source) return;
    if (this.anchor.selected === 3) this.write('outlines', !this.read().outlines);
    if (this.anchor.selected === 4) this.close();
    this.anchor = null;
  }
  items() {
    const values = this.read();
    return [
      `Depth spread    ${values.spread.toFixed(2)}×`,
      `Minimum score    ${values.threshold.toFixed(2)}`,
      `Level curves    ${values.curves ?? 100}`,
      `Show detections    ${values.outlines ? 'On' : 'Off'}`,
      'Done'
    ];
  }
}
