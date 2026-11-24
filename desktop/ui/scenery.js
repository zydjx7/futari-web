import { createSnow } from "./vendor/scenes/snow.js";
import { clamp } from "./vendor/motion.js";
import { clearPack } from "./geometry.js";
const {invoke} = window.__TAURI__.core;
export async function image(src) {
  const im = new Image();
  im.crossOrigin="anonymous";
  im.src = src;
  await im.decode();
  return im;
}

function randomSnow(count) {
  return Array.from({ length: count }, () => [Math.random(), Math.random()]);
}

async function loadLayer(id, layer) {
  const bytes = await invoke("scene_layer", { id, layer });
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  try {
    return await image(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadScenery(id) {
  const packs = await invoke("scene_list");
  const spec = packs.find((p) => p.id === id);
  if (!spec) throw Error("场景包不在目录中");
  if (spec.layout === "snow-forest")
    return createSnow((name) =>
      loadLayer(id, name === "snow-field" ? "bg" : "fg"),
    );
  const [bg, fg] = await Promise.all([
    loadLayer(id, "bg"),
    loadLayer(id, "fg"),
  ]);
  const points = randomSnow(spec.weather === "snow" ? 28 : 0),
    base = clearPack(false);
  const fgMask = document.createElement("canvas");
  fgMask.width = 192;
  fgMask.height = 120;
  const c = fgMask.getContext("2d", { willReadFrequently: true });
  c.drawImage(fg, 0, 0, 192, 120);
  const alpha = c.getImageData(0, 0, 192, 120).data;
  let dims = [1, 1];
  const g0 = spec.horizon + (1 - spec.horizon) * 0.25;
  const g1 = Math.min(0.91, spec.horizon + (1 - spec.horizon) * 0.78);
  return {
    ...base,
    id: "custom",
    propScale: 0.76,
    floor: () => spec.horizon,
    depth: (_, y) =>
      Math.max(0, (y - spec.horizon) / Math.max(0.05, 1 - spec.horizon)),
    size: (w, h, x, y) =>
      Math.min(
        w * 0.25,
        h *
          (0.1 +
            (0.22 * Math.max(0, y - spec.horizon)) /
              Math.max(0.05, 1 - spec.horizon)),
      ),
    props: {
      bell:[.12,g0],applewood:[.33,g1],mat:[.93,g1],teaset:[.42,(g0+g1)/2],
      bowl: [0.14, g1],
      tunnel: [0.84, g0],
      bed: [0.56, g1],
      ball: [0.72, g1],
      lamp: [0.6, (g0 + g1) * 0.5],
    },
    wander(i, x) {
      const next = base.wander(i, x);
      return next.x == null
        ? next
        : {
            ...next,
            y: clamp(next.y, spec.horizon + 0.04, 0.92),
          };
    },
    resize: (w, h) => {
      dims = [w, h];
    },
    background: (ctx, w, h) => ctx.drawImage(bg, 0, 0, w, h),
    landmarks: () => [{ name: "fg", z: spec.foregroundDepth }],
    paintLandmark: (ctx) => ctx.drawImage(fg, 0, 0, ...dims),
    occludes: (x, y, z) => {
      if (
        z >= spec.foregroundDepth ||
        x < 0 ||
        y < 0 ||
        x >= dims[0] ||
        y >= dims[1]
      )
        return false;
      return (
        alpha[
          4 *
            (Math.floor((y / dims[1]) * 120) * 192 +
              Math.floor((x / dims[0]) * 192)) +
            3
        ] > 100
      );
    },
    after(ctx, w, h, t) {
      ctx.fillStyle = "#fffc";
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(
          ((x + t * 0.005) % 1) * w,
          ((y + t * 0.035) % 1) * h,
          1.2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    },
    dispose() {
      bg.removeAttribute("src");
      fg.removeAttribute("src");
    },
  };
}
