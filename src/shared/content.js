export class InputError extends Error {}

const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const h = value => String(value ?? "").replace(/[&<>"']/g, char => entities[char]);
export const isId = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const assetPath = key => "/api/files/" + key.split("/").map(encodeURIComponent).join("/");

export function field(form, name, label, max, required = true) {
  const raw = form.get(name);
  const value = typeof raw === "string" ? raw.trim() : "";
  if (required && !value) throw new InputError("请填写" + label);
  if (value.length > max) throw new InputError(label + "过长");
  return value;
}

export async function readForm(request, limit = 20 * 1024 * 1024) {
  const tooLarge = "本次上传不能超过 " + Math.ceil(limit / 1024 / 1024) + " MB";
  if (Number(request.headers.get("Content-Length")) > limit) throw new InputError(tooLarge);
  let bytes = 0;
  const capped = request.body?.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw new InputError(tooLarge);
      controller.enqueue(chunk);
    }
  }));
  try {
    return await new Response(capped, { headers: request.headers }).formData();
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("无法读取表单，请重新选择文件后提交");
  }
}

export function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}
export function deviceDay(request) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: request.cf?.timezone || "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
export function shiftDay(day, offset) {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function monday(day) {
  return shiftDay(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
}
export function shortDate(day) {
  const [, month, date] = day.split("-").map(Number);
  return month + "月" + date + "日";
}
export function weekdayName(day) {
  return "星期" + "日一二三四五六"[new Date(day + "T12:00:00Z").getUTCDay()];
}
export function selectedDay(ctx) {
  const supplied = ctx.url.searchParams.get("day");
  if (supplied && !validDay(supplied)) throw new InputError("日期无效");
  return supplied || deviceDay(ctx.request);
}

export function imageField(current) {
  return `<label>附图<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif"></label>
    ${current ? photo(current, "当前附图") + '<label class="check"><input type="checkbox" name="remove_image" value="1">移除当前附图</label>' : ""}`;
}
export function photo(key, label) {
  if (!key) return "";
  const url = h(assetPath(key));
  return `<details class="photo"><summary aria-label="展开或收起${h(label)}"><img src="${url}" alt="${h(label)}" loading="lazy">
    <span class="photo-caption">${h(label)}<span aria-hidden="true"></span></span></summary>
    <a href="${url}" target="_blank" rel="noopener">查看原图</a></details>`;
}

export async function newImage(bucket, form, prefix, fieldName = "image") {
  const file = form.get(fieldName);
  if (!file || typeof file === "string" || !file.size) return null;
  if (file.size > 8 * 1024 * 1024) throw new InputError("图片不能超过 8 MB");
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = String.fromCharCode(...b);
  let ext;
  if (ascii.startsWith("\x89PNG\r\n\x1a\n")) ext = "png";
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) ext = "jpeg";
  else if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) ext = "gif";
  else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") ext = "webp";
  else if (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8))) ext = "avif";
  else throw new InputError("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片");
  const key = prefix + "/" + crypto.randomUUID() + "." + ext;
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: "image/" + ext } });
  return key;
}

export function saveBar(label = "保存") {
  return `<div class="form-actions"><button class="primary">${label}</button><span class="form-error" role="alert"></span></div>`;
}
export const empty = message => `<p class="empty">${h(message)}</p>`;
