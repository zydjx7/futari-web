import { plain } from "./http.js";

const inlineTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

export async function privateFile(request, bucket, encodedKey, role) {
  let key;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    return plain("文件名无效", 400);
  }
  if (!key || key.startsWith("rabbit-photos/") || key.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(key)
    || key.split("/").some(part => !part || part === "." || part === "..")) {
    return plain("找不到文件", 404);
  }
  if (key.startsWith("downloads/") && role !== "her") return plain("没有权限", 403);
  const head = request.method === "HEAD";
  const object = head ? await bucket.head(key) : await bucket.get(key);
  if (!object) return plain("找不到文件", 404);
  const type = object.httpMetadata?.contentType?.split(";")[0].trim().toLowerCase();
  const inline = inlineTypes.has(type);
  const filename = encodeURIComponent(key.split("/").at(-1)).replace(/['()*]/g,
    char => "%" + char.charCodeAt(0).toString(16));
  return new Response(head ? null : object.body, {
    headers: {
      "Content-Type": inline || (key.startsWith("downloads/") && type === "application/zip") ? type : "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + filename,
      "ETag": object.httpEtag,
      "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'"
    }
  });
}
