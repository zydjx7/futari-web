import catalog from "./catalog.json";
import book from "./book.client.js";
import paper from "./paper.client.js";
import page from "./page.client.js";
import css from "./album.css";
import { shell } from "../../app/views.js";
import { plain } from "../../shared/http.js";
import { h } from "../../shared/content.js";
import { rabbitNameQuery } from "../rabbit/name.js";

const scripts = {
  "book.js": book,
  "paper.js": paper,
  "page.js": page,
  "catalog.js": "export default " + JSON.stringify(catalog)
};
export async function albumPage(ctx) {
  const name = await rabbitNameQuery(ctx.db).first("name");
  const title = name + "的手账相册";
  return shell("/admin", ctx.role, {
    title,
    back: ["/admin", "管理"],
    script: "album/page",
    body: `<link rel="stylesheet" href="/app/album/album.css"><section class="journal-page" data-album-page data-rabbit-name="${h(name)}" aria-label="${h(title)}"></section>`
  });
}
export async function albumAsset(ctx, name) {
  if (!ctx.read) return plain("请使用 GET", 405, { Allow: "GET, HEAD" });
  const send = (body, type) => new Response(body, { headers: { "Content-Type": type } });
  if (Object.hasOwn(scripts, name)) return send(scripts[name], "text/javascript; charset=utf-8");
  if (name === "album.css") return send(css, "text/css; charset=utf-8");
  if (name === "paper.webp") return send((await import("../rabbit/art/paper.webp")).default, "image/webp");
  return plain("找不到内容", 404);
}
