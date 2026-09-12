export const spreadFromSlider = value => 2 ** Number(value);
export const spreadToSlider = value => Math.log2(Math.max(0.25, Math.min(4, value)));

// VR config stays open between grabs. Vertical motion chooses a row; horizontal
// motion edits its value. Releasing on Show detections toggles it; Done closes.
export class XRConfig {
  constructor(read, write) { this.read = read; this.write = write; this.close(); }
  open(origin, right) {
    this.isOpen = true; this.origin = [...origin]; this.right = [...right];
    this.selected = 3; this.anchor = null;
  }
  close() { this.isOpen = false; this.anchor = null; }
  cancelGrab() { this.anchor = null; }
  update(hands) {
    if (hands.size !== 1) { this.cancelGrab(); return; }
    const [source, p] = [...hands][0];
    if (!this.anchor || this.anchor.source !== source) {
      this.anchor = { source, p: [...p], selected: this.selected, editX: 0, values: this.read() };
      return;
    }
    const a = this.anchor;
    const dy = p[1] - a.p[1];
    const x = p.reduce((sum, v, i) => sum + (v - a.p[i]) * this.right[i], 0);
    const row = Math.max(0, Math.min(3, a.selected - Math.round(dy / 0.05)));
    if (row !== this.selected) {
      this.selected = row; a.editX = x; a.values = this.read();
    }
    const dx = x - a.editX;
    const current = this.read();
    if (row === 0) {
      const spread = 2 ** Math.max(-2, Math.min(2, Math.log2(a.values.spread) + dx * 16));
      if (Math.abs(Math.log2(spread / current.spread)) > 0.005) this.write('spread', spread);
    } else if (row === 1) {
      const threshold = Math.round(Math.max(0, Math.min(1, a.values.threshold + dx * 4)) * 100) / 100;
      if (threshold !== current.threshold) this.write('threshold', threshold);
    }
  }
  end(source) {
    if (this.anchor?.source !== source) return;
    if (this.selected === 2) this.write('outlines', !this.read().outlines);
    if (this.selected === 3) this.close();
    this.anchor = null;
  }
  items() {
    const values = this.read();
    return [`Depth spread    ${values.spread.toFixed(2)}×`, `Minimum score    ${values.threshold.toFixed(2)}`, `Show detections    ${values.outlines ? 'On' : 'Off'}`, 'Done'];
  }
}
