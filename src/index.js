import calendarScript from "./app/today.client.js";
import editorScript from "./app/editor.client.js";
import readerScript from "./modules/novels/reader.client.js";
import appearanceScript from "./modules/novels/appearance.client.js";
import readerTools from "./modules/novels/annotations.client.js";
import messageScript from "./modules/messages/badge.client.js";
import calorieScript from "./modules/menu/calories.client.js";
import servingScript from "./modules/menu/serving.js" with { type: "text" };
import { notesAPI } from "./modules/novels/notes.js";
import { readMessages, messagePage } from "./modules/messages/index.js";
import { unreadCount } from "./modules/messages/state.js";
import chapterScript from "./modules/novels/chapter.client.js";
import presenceScript from "./modules/wallet/presence.client.js";
import { claimAllowance, pulse } from "./modules/wallet/earnings.js";
import { manageWallet, wallet } from "./modules/wallet/index.js";
import { roomAsset } from "./modules/rabbit/assets.js";
import { rabbitApi } from "./modules/rabbit/index.js";
import { albumApi } from "./modules/album/index.js";
import { albumAsset, albumPage } from "./modules/album/assets.js";
import { home, loginPath, pages, returnPage } from "./app/routes.js";
import { lockScreen, pageError, readerCssPath, readerStyles } from "./app/views.js";
import { InputError } from "./shared/content.js";
import { clearCookie, configured, cookieToken, readSession, usesDesktopCredential } from "./shared/session.js";
import { login } from "./shared/login.js";
import { privateFile } from "./shared/files.js";
import { plain, redirect, secureHeaders } from "./shared/http.js";

function methodNotAllowed(allow) {
  return plain("请求方式不支持", 405, { Allow: allow });
}

function sameOrigin(request, url) {
  return request.headers.get("Origin") === url.origin;
}

async function route(request, env, execution) {
  const url = new URL(request.url);
  const path = url.pathname;
  const read = request.method === "GET" || request.method === "HEAD";
  if (!configured(env)) return plain("尚未配置登录", 503);
  if (usesDesktopCredential(request)) return plain("请使用网页登录", 401);

  if (path === "/login") {
    const next = returnPage(url.searchParams.get("next"));
    if (read) return await readSession(request, env) ? redirect(next) : lockScreen(next);
    if (request.method !== "POST") return methodNotAllowed("GET, HEAD, POST");
    if (!sameOrigin(request, url)) return plain("请求来源无效", 403);
    return login(request, env, next);
  }

  const session = await readSession(request, env);
  const api = path === "/api" || path.startsWith("/api/");
  if (!session) {
    if (api || !read || path.startsWith("/app/")) return plain("请先登录", 401);
    if (cookieToken(request)) return lockScreen(returnPage(path+url.search),"",401,{"Set-Cookie":clearCookie()});
    return redirect(loginPath(returnPage(path + url.search)));
  }
  const adminPage = path === "/admin" || path.startsWith("/admin/");
  const adminApi = path === "/api/admin" || path.startsWith("/api/admin/");
  if ((adminPage || adminApi) && session.role !== "admin") {
    return adminApi ? plain("没有管理权限", 403) : pageError("没有管理权限", 403);
  }
  if (path === "/logout") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!sameOrigin(request, url)) return plain("请求来源无效", 403);
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.id).run();
    return redirect("/login", 303, { "Set-Cookie": clearCookie() });
  }
  if (!read && request.method !== "POST") return methodNotAllowed("GET, HEAD, POST");
  if (!read && !sameOrigin(request, url)) return plain("请求来源无效", 403);
  const ctx = { request, url, read, role: session.role, db: env.DB, bucket: env.FILES, defer: job => execution.waitUntil(job) };
  if (path==="/messages") return read ? messagePage(ctx,"") : methodNotAllowed("GET, HEAD");
  const annotations=path.match(/^\/api\/novels\/([^/]+)\/notes(?:\/([^/]+)\/(delete))?$/);
  if(annotations) return notesAPI(ctx,...annotations.slice(1));
  if(path==="/api/messages/read") return read ? methodNotAllowed("POST") : readMessages(ctx);
  if(path==="/api/messages/count") return read ? Response.json({unread:await unreadCount(ctx)}) : methodNotAllowed("GET, HEAD");
  if (path === "/admin/album") return read ? albumPage(ctx) : methodNotAllowed("GET, HEAD");
  if (path === "/api/album" || path.startsWith("/api/album/")) return albumApi(ctx,path.slice("/api/album/".length));
  if (path.startsWith("/app/album/")) return albumAsset(ctx,path.slice("/app/album/".length));
  if (path === "/admin/wallet") return manageWallet(ctx);
  if (path.startsWith("/api/rabbit/")) return rabbitApi(ctx, path.slice("/api/rabbit/".length));
  if (path === "/app/room-launch.js" || path.startsWith("/app/rabbit/")) return roomAsset(ctx,path);
  if (["/api/wallet", "/api/wallet/claim", "/api/companion/pulse"].includes(path)) {
    if (ctx.role !== "her") return plain("没有权限", 403);
    if (path === "/api/wallet") return read ? wallet(ctx) : methodNotAllowed("GET, HEAD");
    if (read) return methodNotAllowed("POST");
    return path === "/api/wallet/claim" ? claimAllowance(ctx) : pulse(ctx);
  }
  const parts = path.slice(1).split("/");
  const section = pages.get("/" + (adminPage && parts[1] ? parts[1] : parts[0]));
  if (section) {
    const isEditor = adminPage && section.path !== "/admin";
    const handler = isEditor ? section.manage : section.page;
    const rest = parts.slice(isEditor ? 2 : 1).join("/");
    if (handler) return handler(ctx, rest);
  }
  if (!read) return methodNotAllowed("GET, HEAD");
  if (path === "/") return redirect(home);
  if (path === "/api/session") return Response.json({ role: session.role });
  if (path === readerCssPath) return readerStyles();
  if (path.startsWith("/api/files/")) return privateFile(request, env.FILES, path.slice("/api/files/".length), ctx.role);
  const scripts = { "/app/today.js": calendarScript, "/app/editor.js": editorScript, "/app/reader.js": readerScript, "/app/reader-appearance.js": appearanceScript,
    "/app/chapter.js": chapterScript, "/app/presence.js": presenceScript,
    "/app/annotations.js":readerTools, "/app/messages.js":messageScript, "/app/calories.js":calorieScript, "/app/serving.js":servingScript };
  if (Object.hasOwn(scripts, path)) {
    return new Response(scripts[path], { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
  }
  return api ? plain("找不到内容", 404) : pageError("找不到此页", 404);
}

export default {
  async fetch(request, env, execution) {
    let response;
    try {
      response = await route(request, env, execution);
    } catch (error) {
      const invalid = error instanceof InputError;
      if (!invalid) console.error("FUTARI request failed", error.name, error.message);
      const message = invalid ? error.message : "暂时无法访问，请稍后重试";
      const status = invalid ? 422 : 503;
      response = request.headers.get("Accept")?.includes("application/json")
        ? Response.json({ error: message }, { status }) : pageError(message, status);
    }
    secureHeaders(response);
    if(response.status===200 && new URL(request.url).pathname===readerCssPath) response.headers.set("Cache-Control","private, max-age=31536000, immutable");
    return request.method === "HEAD"
      ? new Response(null, { status: response.status, headers: response.headers })
      : response;
  }
};
