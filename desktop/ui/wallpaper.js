import { image, loadScenery } from "./scenery.js";
import { daylight, lightWash } from "./vendor/light.js";

const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");
let key, serial = 0, pack, timer, view;
function paint() {
  if (!pack) return;
  const w = innerWidth, h = innerHeight;
  if (!w || !h) return;
  const ratio = Math.min(devicePixelRatio, 1.5);
  const width = Math.round(w * ratio), height = Math.round(h * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    pack.resize?.(w, h);
  }
  ctx.setTransform(width / w, 0, 0, height / h, 0, 0);
  const t = performance.now() / 1000;
  const light = daylight(view.atmosphere || "auto");
  pack.setLight?.(light);
  pack.background(ctx, w, h, t);
  const wash = lightWash(ctx, w, h, light, null, pack.id === "snow");
  if (wash.night) wash.paint();
  for (const item of pack.landmarks?.() || []) pack.paintLandmark(ctx, item);
  pack.after?.(ctx, w, h, t);
  if (!wash.night) wash.paint();
}
async function apply(v) {
  view = v;
  const id = v.settings.scene === "clear" ? "snow-forest" : v.settings.scene;
  const next = v.wallActive ? JSON.stringify([id,v.revision]) : "";
  if (key === next) { paint(); return; }
  key = next;
  const token = ++serial;
  clearInterval(timer);
  pack?.dispose?.();
  pack = null;
  if (!next) return;
  let result;
  if (id === "paper") {
    const texture = await image(new URL("./art/paper.webp", import.meta.url).href);
    const pattern = ctx.createPattern(texture,"repeat");
    result = {background(c,w,h){c.fillStyle = pattern;c.fillRect(0,0,w,h);}};
  } else result = await loadScenery(id);
  if (serial !== token) { result.dispose?.(); return; }
  pack = result;
  pack.resize?.(innerWidth,innerHeight);
  paint();
  if (id !== "paper") timer = setInterval(paint, 100);
}
await window.__TAURI__.event.listen("desktop-view", e => apply(e.payload));
await apply(await window.__TAURI__.core.invoke("desktop_view"));
window.addEventListener("resize",paint);
