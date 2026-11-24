// Scene packs own their ground, camera scale, landmarks and walking routes.
export function createPaper() {
  return {
    id: "paper",
    propScale: 1,
    floor: () => 0.56,
    depth: () => 0.65,
    size(w, h, x, y) {
      // The far edge of the paper rises behind the play area, where the tunnel sits.
      const t = Math.max(0, Math.min(1, (0.74 - y) / 0.16));
      return Math.min(h * 0.47, w * 0.5) * (1 - 0.45 * t * t * (3 - 2 * t));
    },
    wander(i, x) {
      if (i % 6 === 1) return { key: "peek" };
      if (i % 6 === 3) return { key: "loaf" };
      if (i % 6 === 5) return { key: "nibble" };
      return {
        key: "go",
        x: x > 0.52 ? 0.34 : 0.65,
        y: 0.76,
        gait: "auto",
        arrival: true
      };
    },
    props: {
      bell: [0.1,0.64],
      applewood: [0.36,0.89],
      mat: [0.82,0.87],
      teaset: [0.3,0.62],

      bowl: [0.24, 0.785],
      tunnel: [0.82, 0.572],
      bed: [0.48, 0.77],
      ball: [0.66, 0.84],
      lamp: [0.54, 0.65]
    }
  };
}
