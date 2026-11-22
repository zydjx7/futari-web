import { clamp, ease, readMasks, maskAt } from "../motion.js";
import art from "../layout.js";
import { nightPrint } from "../light.js";

const floor = (x) => 0.55 + 0.016 * Math.sin(5.7 * x - 0.6);
const depth = (x, y) => clamp((y - floor(x)) / (0.957 - floor(x)));

export async function createSnow(texture, signal) {
  const [field, forest] = await Promise.all(
    ["snow-field", "snow-foreground"].map((name) => texture(name, signal))
  );
  const masks = readMasks(art.masks),
    tracks = [];
  const flakes = Array.from(
    { length: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 48 },
    () => ({
      x: Math.random(),
      y: Math.random(),
      s: 0.27 + 0.73 * Math.random(),
      phase: 6.28 * Math.random()
    })
  );
  let trees = [],
    light = "day";
  function snow(c, w, h, t, near) {
    c.save();
    c.fillStyle = "#fffdf9";
    const count = light === "night" ? 48 : light === "dusk" ? 32 : 18;
    for (let i = 0; i < Math.min(flakes.length, count); i++) {
      const f = flakes[i];
      if (f.s > 0.77 !== near) continue;
      const x = ((f.x + t * (0.002 + 0.003 * f.s) + 0.011 * Math.sin(t * 0.45 + f.phase) + 2) % 1) * w;
      const y = ((f.y + t * (0.023 + 0.049 * f.s)) % 1) * h;
      c.globalAlpha = 0.18 + f.s * 0.47;
      c.beginPath();
      c.ellipse(x, y, 0.4 + f.s * 1.1, 0.45 + f.s * 1.3, 0, 0, 2 * Math.PI);
      c.fill();
    }
    c.restore();
  }
  function footprints(c, w, h, t) {
    while (tracks.length && t - tracks[0].t >= 8.6) tracks.shift();
    for (const p of tracks) {
      const unit = h * (0.003 + 0.003 * depth(p.x, p.y));
      c.save();
      c.translate(p.x * w, p.y * h);
      c.rotate(Math.atan2(p.dy * h, p.dx * w) + Math.PI / 2);
      c.globalAlpha = 1 - ease(0.7, 8.6, t - p.t);
      const pair = p.foot === "fore" ? [[-0.70, 0.8, 0.56], [0.70, 1.36, 0.56]]
        : [[-1.22, -1.1, 1], [1.22, -0.90, 1]];
      for (const [x, y, k] of pair) {
        c.fillStyle = "rgba(255,252,245,.60)";
        c.beginPath();
        c.ellipse(x * unit, (y + 0.18) * unit, unit * 0.58 * k, unit * k, 0, 0, 2 * Math.PI);
        c.fill();
        c.fillStyle = "rgba(112,133,158,.38)";
        c.beginPath();
        c.ellipse(x * unit, y * unit, unit * 0.54 * k, unit * 0.9 * k, 0, 0, 2 * Math.PI);
        c.fill();
      }
      c.restore();
    }
  }
  return {
    id: "snow",
    propScale: 0.79,
    floor,
    depth,
    size: (w, h, x, y) => Math.min(h * (0.086 + 0.255 * depth(x, y) ** 0.92), w * 0.49),
    props: {
      bowl: [0.13, 0.9],
      tunnel: [0.85, 0.64],
      bed: [0.57, 0.91],
      ball: [0.74, 0.91],
      lamp: [0.61, 0.69]
    },
    wander(i, x) {
      switch (i % 8) {
        case 0:
          return { key: "go", x: 0.293, y: 0.823, gait: "auto", after: "sniff" };
        case 1:
          return { key: "go", x: clamp(x + 0.1), y: 0.595, gait: "hop" };
        case 2:
          return { key: "go", x: clamp(x + 0.09), y: 0.923, gait: "hop" };
        case 3:
          return { key: "peek" };
        case 4:
          return { key: "nibble" };
        case 5:
          return { key: "go", x: 0.66, y: 0.775, gait: "hop", after: "loaf" };
        case 6:
          return { key: "groom" };
        default:
          return {
            key: "go",
            x: 0.64 + 0.2 * Math.random(),
            y: 0.78 + 0.1 * Math.random(),
            gait: "hop",
            arrival: true
          };
      }
    },
    resize(w, h) {
      trees = [
        ["tree", 0.07, 0.802, 0.786],
        ["stump", 0.293, 0.866, 0.155]
      ].map(([name, x, z, scale]) => {
        const rect = art.scenery[name],
          height = h * scale,
          width = (height * rect[2]) / rect[3];
        return { name, z, rect, x: x * w - width / 2, y: z * h - height, w: width, h: height };
      });
    },
    background(c, w, h, t) {
      const scale = Math.max(w / field.width, h / field.height);
      c.drawImage(
        field,
        (w - field.width * scale) / 2,
        (h - field.height * scale) / 2,
        field.width * scale,
        field.height * scale
      );
      snow(c, w, h, t, false);
      footprints(c, w, h, t);
    },
    landmarks() {
      return trees;
    },
    paintLandmark(c, o) {
      c.drawImage(light === "night" ? nightPrint(forest) : forest, ...o.rect, o.x, o.y, o.w, o.h);
    },
    setLight(mode) {
      light = mode;
    },
    occludes(x, y, z, name) {
      return trees.some(
        (o) =>
          (!name || name === o.name) && o.z > z && maskAt(masks[o.name], (x - o.x) / o.w, (y - o.y) / o.h)
      );
    },
    after(c, w, h, t) {
      snow(c, w, h, t, true);
    },
    step(x, y, dx, dy, n, t, foot = "hind") {
      tracks.push({ x, y, dx, dy, n, t, foot });
      if (tracks.length > 64) tracks.shift();
    },
    dispose() {
      field.removeAttribute("src");
      forest.removeAttribute("src");
    }
  };
}
