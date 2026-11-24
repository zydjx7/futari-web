import { png } from "./vendor/paper.js";

const { invoke } = window.__TAURI__.core;

export async function canvasToBase64(canvas) {
  const blob = await png(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(""));
}

export async function savePolaroidPrint(canvas, _photo, _rabbitName, filename) {
  const imageBase64 = await canvasToBase64(canvas);
  const saved = await invoke("save_print", { filename, imageBase64 });
  return "已保存到下载文件夹：" + saved;
}
