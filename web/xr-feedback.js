// Keep a translucent origin shell while a second sphere resolves into the tracked bead.
export function grabFeedbackVertices(markers) {
  const vertices = [];
  for (const { origin, position, elapsed = 0 } of markers.slice(0, 2)) {
    const t = Math.max(0, Math.min(1, elapsed / 300));
    const progress = t * t * (3 - 2 * t);
    const radius = 0.045 + (0.009 - 0.045) * progress;
    const alpha = 0.18 + 0.82 * progress;
    const center = origin.map((v, i) => v + (position[i] - v) * progress);
    const color = [1, 1, 1];
    for (const sphere of [
      { center: origin, radius: 0.045, alpha: 0.18 },
      { center, radius, alpha },
    ]) {
      const vertex = (latitude, longitude) => {
        const normal = [Math.sin(latitude) * Math.cos(longitude),
          Math.cos(latitude), Math.sin(latitude) * Math.sin(longitude)];
        const light = 0.65 + 0.35 * Math.max(0, normal[0] * -0.3 + normal[1] * 0.7 + normal[2] * 0.64);
        return [...sphere.center.map((v, i) => v + sphere.radius * normal[i]), ...color.map(v => v * light), sphere.alpha];
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
  }
  return new Float32Array(vertices);
}
