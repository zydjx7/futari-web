import catalog from "./catalog.js";

export function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function control(text, action, cls = "") {
  const node = make("button", text, cls);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
export function dayOf(photo) {
  const d = new Date(photo.captured + photo.offset * 60000);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0")
  ].join(".");
}
export function imageUrl(id) {
  return "/api/album/" + encodeURIComponent(id) + "/image";
}
async function defaultApi(path, signal, body) {
  const response = await fetch("/api/album" + path, {
    signal,
    method: body ? "POST" : "GET",
    body,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const info = await response.json().catch(() => ({}));
    const error = new Error(
      info.error || (response.status === 404 ? "这张照片已经取下了。" : "相册暂时连不上，再试一次吧。")
    );
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
async function defaultUploadShot(shot, signal) {
  const form = new FormData();
  for (const k of ["id", "captured", "offset", "scene", "light", "pose", "title"])
    form.set(k, String(shot[k]));
  form.set("image", await png(shot.photo), "exposure.png");
  return api("", signal, form);
}
function defaultAttachImage(img, id, _signal, onReady) {
  img.src = imageUrl(id);
  onReady?.();
  return () => {};
}
async function defaultDownloadPrint(canvas, _photo, _rabbitName, filename) {
  const url = URL.createObjectURL(await png(canvas));
  const link = make("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  (canvas.closest("dialog") || document.body).append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
let transport = {
  api: defaultApi,
  uploadShot: defaultUploadShot,
  attachImage: defaultAttachImage,
  downloadPrint: defaultDownloadPrint
};
export function configureAlbum(overrides = {}) {
  transport = {
    api: overrides.api || defaultApi,
    uploadShot: overrides.uploadShot || defaultUploadShot,
    attachImage: overrides.attachImage || defaultAttachImage,
    downloadPrint: overrides.downloadPrint || defaultDownloadPrint
  };
}
export function api(path, signal, body) {
  return transport.api(path, signal, body);
}
export function uploadShot(shot, signal) {
  return transport.uploadShot(shot, signal);
}
export function attachImage(img, id, signal, onReady, onError) {
  return transport.attachImage(img, id, signal, onReady, onError);
}
const font = '"Kaiti SC","STKaiti","KaiTi","Songti SC","SimSun",serif';
function lines(ctx, text, x, y, width, lineHeight) {
  let line = "";
  for (const ch of Array.from(text)) {
    if (line && ctx.measureText(line + ch).width > width) {
      ctx.fillText(line, x, y);
      line = "";
      y += lineHeight;
    }
    line += ch;
  }
  ctx.fillText(line, x, y);
}
export function photoNote(photo, rabbitName) {
  return catalog.notes[photo.pose].replace("{name}", () => rabbitName);
}
export function printPaper(canvas, source, photo, rabbitName) {
  canvas.width = 800;
  canvas.height = 986;
  canvas.classList.add("instant-print");
  canvas.setAttribute("role", "img");
  const note = photoNote(photo, rabbitName);
  canvas.setAttribute(
    "aria-label",
    [dayOf(photo), catalog.scenes[photo.scene], photo.title, note]
      .filter(Boolean)
      .join("，")
  );
  const ctx = canvas.getContext("2d", { alpha: false });
  const wash = ctx.createLinearGradient(0, 0, 800, 986);
  wash.addColorStop(0, "#fffaf0");
  wash.addColorStop(0.55, "#fbf3e2");
  wash.addColorStop(1, "#f0dfc0");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 800, 986);
  // A repeatable fine paper tooth also travels with the exported print.
  ctx.fillStyle = "rgba(132,96,58,.09)";
  let grain = 17;
  for (let i = 0; i < 6400; i++) {
    grain = (Math.imul(grain, 1664525) + 1013904223) >>> 0;
    const x = grain % 800,
      y = (grain >>> 12) % 986;
    if (x < 40 || x >= 760 || y < 35 || y >= 755) ctx.fillRect(x, y, 1.4, 1);
  }
  ctx.drawImage(source, 40, 35, 720, 720);
  ctx.strokeStyle = "rgba(117,89,60,.26)";
  ctx.lineWidth = 2;
  ctx.strokeRect(39, 34, 722, 722);
  ctx.fillStyle = "#85664e";
  ctx.font = "25px " + font;
  ctx.fillText(dayOf(photo), 43, 808);
  ctx.textAlign = "right";
  ctx.fillText((catalog.scenes[photo.scene] || "桌面风景") + " · " + (catalog.lights[photo.light] || "跟随时间"), 756, 808);
  ctx.textAlign = "left";
  ctx.fillStyle = "#553c2d";
  ctx.font = "35px " + font;
  lines(ctx, photo.title || note, 44, 864, 705, 42);
  if (photo.title) {
    ctx.fillStyle = "#7b6049";
    ctx.font = "26px " + font;
    lines(ctx, note, 44, 947, 705, 29);
  }
  return canvas;
}
export const png = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("相纸暂时没有冲印好。"))), "image/png")
  );
export async function downloadPrint(canvas, photo, rabbitName) {
  const filename = rabbitName.replace(/[<>:"/\\|?*]/g, "_") + "-" + dayOf(photo) + "-" + photo.id.slice(0, 8) + ".png";
  return transport.downloadPrint(canvas, photo, rabbitName, filename);
}
export function titleInput(value = "") {
  const node = make("input", undefined, "photo-title");
  node.type = "text";
  node.maxLength = 40;
  node.value = value;
  node.placeholder = "给这张相纸写一句话";
  node.setAttribute("aria-label", "照片短标题");
  node.autocomplete = "off";
  return node;
}
