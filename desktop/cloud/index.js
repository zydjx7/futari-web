import { login } from "../../src/shared/login.js";
import { InputError, isId } from "../../src/shared/content.js";
import { configured, readSession } from "../../src/shared/session.js";
import { rabbitApi } from "../../src/modules/rabbit/index.js";
import { albumApi } from "../../src/modules/album/index.js";
import { recordPresence } from "../../src/modules/wallet/earnings.js";
import { shop } from "../../src/modules/wallet/config.js";

const tokenPattern = /^d1\.[a-f0-9-]{36}\.\d{10,11}\.[a-f0-9]{64}$/;
const json = (value, status = 200, extra = {}) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
const fail = (error, status) => json({ error }, status);
async function body(request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("type");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  let size = 0;
  const utf = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      throw new Error("length");
    }
    result += utf.decode(value, { stream: true });
  }
  const v = JSON.parse(result + utf.decode());
  if (!v || Array.isArray(v) || typeof v !== "object") throw new Error("body");
  return v;
}
const only = (obj, keys) => Object.keys(obj).every((k) => keys.includes(k));
function sessionRequest(token) {
  return new Request("https://internal.invalid/", {
    headers: { Cookie: "__Host-notes=" + token },
  });
}
async function reply(res) {
  if (res.status === 204) return json({ ok: true });
  if (res.headers.get("Content-Type")?.includes("application/json"))
    return json(await res.json(), res.status);
  return fail((await res.text()) || "请求无法完成", res.status);
}
async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const simpleMatch =
    /^\/v1\/(session|logout|state|mail|pulse|visit|pet|feed|buy|place|open-letter|rename|atmosphere|album)$/.exec(
      url.pathname,
    );
  const albumItemMatch = simpleMatch
    ? null
    : /^\/v1\/album\/([^/]+)\/(image|title|delete)$/.exec(url.pathname);
  if (!simpleMatch && !albumItemMatch) return fail("没有这个接口", 404);
  if (!configured(env)) return fail("云端尚未配置", 503);
  const action = simpleMatch ? simpleMatch[1] : "album-item";
  const isAlbum = action === "album" || action === "album-item";
  if (isAlbum && !env.FILES) return fail("云端尚未配置", 503);
  const albumId = albumItemMatch?.[1] || "";
  const albumSub = albumItemMatch?.[2] || "";
  if (action === "album") {
    if (request.method !== "GET" && request.method !== "POST")
      return fail("请求方式无效", 405);
  } else {
    const expectGet =
      action === "state" ||
      action === "mail" ||
      (action === "album-item" && albumSub === "image");
    if (request.method !== (expectGet ? "GET" : "POST"))
      return fail("请求方式无效", 405);
  }
  const read = request.method === "GET";
  if (request.headers.has("Origin")) return fail("仅支持桌面客户端", 403);
  if (action === "session") {
    let input;
    try {
      input = await body(request);
    } catch {
      return fail("需要有效的短 JSON 对象", 400);
    }
    if (
      !only(input, ["passcode"]) ||
      typeof input.passcode !== "string" ||
      [...input.passcode].length > 256
    )
      return fail("暗号格式无效", 400);
    const internal = new Request("https://internal.invalid/login", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") || "local",
      },
      body: new URLSearchParams({ passcode: input.passcode }),
    });
    const res = await login(internal, env, "/", "desktop");
    if (res.status !== 303)
      return json(
        { error: res.status === 429 ? "尝试过多，稍后再来" : res.status === 403 ? "云端兔窝使用她的专属暗号" : "暗号不正确" },
        res.status,
        res.headers.has("Retry-After")
          ? { "Retry-After": res.headers.get("Retry-After") }
          : {},
      );
    const token = res.headers
      .get("Set-Cookie")
      ?.match(/^__Host-notes=([^;]+)/)?.[1];
    if (!token || !tokenPattern.test(token)) return fail("登录失败", 401);
    return json({ token });
  }
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token || !tokenPattern.test(token)) return fail("请重新连接云端", 401);
  const session = await readSession(sessionRequest(token), env, "desktop");
  if (session?.role !== "her") return fail("请重新连接云端", 401);
  if (action === "logout") {
    try {
      await body(request);
    } catch {
      return fail("需要有效的短 JSON 对象", 400);
    }
    await env.DB.prepare("DELETE FROM sessions WHERE id=?")
      .bind(session.id)
      .run();
    return json({ ok: true });
  }
  if (action === "album") {
    if (!read) {
      const ct = request.headers.get("content-type")?.split(";")[0]?.trim()?.toLowerCase();
      if (ct !== "multipart/form-data") return fail("需要表单上传照片", 400);
    }
    const res = await albumApi(
      {
        role: "her",
        db: env.DB,
        bucket: env.FILES,
        read,
        url,
        request,
        defer: (p) => ctx?.waitUntil?.(p),
      },
      "",
    );
    return reply(res);
  }
  if (action === "album-item") {
    if (!isId(albumId)) return fail("找不到这张照片", 404);
    if (albumSub === "image") {
      const res = await albumApi(
        {
          role: "her",
          db: env.DB,
          bucket: env.FILES,
          read: true,
          url,
          request,
          defer: (p) => ctx?.waitUntil?.(p),
        },
        albumId + "/image",
      );
      if (res.status === 200) {
        const headers = new Headers();
        headers.set("Content-Type", "image/png");
        if (res.headers.has("Content-Length"))
          headers.set("Content-Length", res.headers.get("Content-Length"));
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(res.body, { status: 200, headers });
      }
      return reply(res);
    }
    let input;
    try {
      input = await body(request);
    } catch {
      return fail("需要有效的短 JSON 对象", 400);
    }
    if (
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      (albumSub === "title" && (!only(input, ["title", "revision"]) || typeof input.title !== "string")) ||
      (albumSub === "delete" && !only(input, ["revision"]))
    )
      return fail("参数无效", 400);
    const form = new URLSearchParams({ revision: String(input.revision) });
    if (albumSub === "title") form.set("title", input.title);
    const res = await albumApi(
      {
        role: "her",
        db: env.DB,
        bucket: env.FILES,
        read: false,
        url,
        request: new Request("https://internal.invalid/", {
          method: "POST",
          body: form,
        }),
        defer: (p) => ctx?.waitUntil?.(p),
      },
      albumId + "/" + albumSub,
    );
    return reply(res);
  }
  let input = {};
  if (!read) {
    try {
      input = await body(request);
    } catch {
      return fail("需要有效的短 JSON 对象", 400);
    }
  }
  if (action === "pulse") {
    await recordPresence(
      env.DB,
      "desktop:" + session.id,
      Math.floor(Date.now() / 1000),
      true,
    );
    return json({ ok: true });
  }
  const form = new URLSearchParams();
  if (action === "rename") {
    if (!only(input, ["name"]) || typeof input.name !== "string") return fail("名字格式无效", 400);
    form.set("name", input.name);
  }
  if (action === "atmosphere") {
    if (!only(input, ["atmosphere"]) || typeof input.atmosphere !== "string")
      return fail("光影格式无效", 400);
    form.set("atmosphere", input.atmosphere);
  }
  if (["buy", "feed", "place"].includes(action)) {
    if (!Object.hasOwn(shop, input.item)) return fail("物品无效", 400);
    form.set("item", input.item);
  }
  if (["buy", "feed"].includes(action)) {
    if (
      typeof input.request_id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(input.request_id)
    )
      return fail("操作编号无效", 400);
    form.set("request_id", input.request_id);
  }
  if (action === "open-letter") {
    if (!Number.isSafeInteger(input.id) || input.id <= 0)
      return fail("信件编号无效", 400);
    form.set("id", String(input.id));
  }
  const res = await rabbitApi(
    {
      role: "her",
      db: env.DB,
      read,
      url,
      request: read
        ? request
        : new Request("https://internal.invalid/", {
            method: "POST",
            body: form,
          }),
    },
    action,
  );
  return reply(res);
}
export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      return fail(
        e instanceof InputError ? e.message : "云端暂时无法处理",
        e instanceof InputError ? 400 : 503,
      );
    }
  },
};
