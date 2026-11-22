import { navigation } from "../../app/routes.js";
import { shell, pageError } from "../../app/views.js";
import { plain } from "../../shared/http.js";
import { h } from "../../shared/content.js";
import { rabbitNameQuery } from "../rabbit/name.js";

async function page(ctx, rest) {
  if (rest) return pageError("找不到此页", 404);
  if (!ctx.read) return plain("请求方式不支持", 405);
  const rabbitName = await rabbitNameQuery(ctx.db).first("name");
  const body = '<div class="entry-list">' + navigation.map(item =>
    `<a href="/admin${item.path}">${item.title}<span aria-hidden="true">›</span></a>`).join("") +
    '<a href="/admin/wallet">她的钱包<span aria-hidden="true">›</span></a>' +
    `<a href="/admin/album"><span data-rabbit-album-name>${h(rabbitName)}的手账相册</span><span aria-hidden="true">›</span></a></div>`;
  return shell("/admin", ctx, { title: "管理", body, script: "album/page" });
}
export default { path: "/admin", title: "管理", page };
