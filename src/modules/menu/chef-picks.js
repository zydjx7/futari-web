import { assetPath, h, imageField, InputError, isId, monday, newImage, readForm } from "../../shared/content.js";
import { plain, saved } from "../../shared/http.js";

export async function weeklyPicks(db, week) {
  const { results } = await db.prepare(
    "SELECT id,name,station,source_url,image_key,preview_key FROM menu_chef_picks WHERE week=? ORDER BY position"
  ).bind(week).all();
  return results;
}

export function chefGallery(picks) {
  if (!picks.length) return "";
  const cards = picks.map(pick => {
    const image = pick.image_key && h(assetPath(pick.image_key));
    return `<li><a class="chef-card" href="${image || h(pick.source_url)}" target="_blank" rel="noopener noreferrer">
      ${image ? `<img src="${pick.preview_key ? h(assetPath(pick.preview_key)) : image}" alt="${h(pick.name)}的菜品照片" loading="lazy" decoding="async">` : ""}
      <small>${h(pick.station)}</small><strong>${h(pick.name)}</strong>
      <span class="chef-photo-link">${image ? "放大菜图" : "在飞书看图"} <span aria-hidden="true">↗</span></span>
    </a></li>`;
  });
  return `<details class="chef-picks" id="chef-picks" open><summary>本周主厨推荐 <small>${picks.length} 道</small></summary>
    <ul>${cards.join("")}</ul></details>`;
}

export function chefPhotoEditor(picks, day) {
  if (!picks.length) return "";
  return `<details class="chef-picks" id="chef-photos"><summary>主厨推荐配图 <small>${picks.length} 道</small></summary>
    ${picks.map(pick => `<form class="chef-upload" method="post" enctype="multipart/form-data" action="/admin/menu/chef-photo?day=${day}">
      <input type="hidden" name="pick" value="${h(pick.id)}">
      <span><strong>${h(pick.name)}</strong><small>${h(pick.station)}</small></span>
      ${pick.image_key ? `<a class="text-link" target="_blank" rel="noopener" href="${h(assetPath(pick.image_key))}">当前菜图</a>` : ""}
      ${imageField(null)}<button class="subtle" type="submit">保存配图</button></form>`).join("")}</details>`;
}

export async function saveChefPhoto(ctx, day) {
  const form = await readForm(ctx.request);
  const id = form.get("pick");
  if (!isId(id)) throw new InputError("请选择本周的一道推荐菜");
  const week = monday(day);
  const pick = await ctx.db.prepare("SELECT image_key,preview_key FROM menu_chef_picks WHERE id=? AND week=?").bind(id, week).first();
  if (!pick) return plain("找不到本周的这道推荐菜", 404);
  const prefix = `menus/${week}/chef/${id}`;
  const key = await newImage(ctx.bucket, form, prefix);
  if (!key) throw new InputError("请选择一张菜品照片");
  let preview;
  try {
    preview = await newImage(ctx.bucket, form, prefix, "preview");
  } catch (error) {
    await ctx.bucket.delete(key);
    throw error;
  }
  const changed = await ctx.db.prepare(
    "UPDATE menu_chef_picks SET image_key=?,preview_key=? WHERE id=? AND week=? AND image_key IS ? RETURNING id"
  ).bind(key, preview, id, week, pick.image_key).first();
  if (!changed) {
    await ctx.bucket.delete(preview ? [key, preview] : key);
    return plain("这张菜图已更新，请刷新后重试", 409);
  }
  const replaced = [pick.image_key, pick.preview_key].filter(old => old?.startsWith(prefix + "/"));
  if (replaced.length) ctx.defer(ctx.bucket.delete(replaced));
  return saved(ctx, "/admin/menu?day=" + day + "#chef-photos");
}
