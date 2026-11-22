import catalog from "./catalog.json";
import { InputError, field, isId, readForm } from "../../shared/content.js";
import { plain } from "../../shared/http.js";
import { rabbitNameQuery } from "../rabbit/name.js";

const fields = "id,captured,offset_minutes AS offset,scene,light,pose,title,revision";
const key = (id) => "rabbit-photos/" + id + ".png";
const missing = () => plain("找不到这张照片", 404);
const conflict = (message) => Response.json({ error: message }, { status: 409 });
const empty = () => new Response(null, { status: 204 });

function titleFrom(form) {
  const title = field(form, "title", "标题", 40, false);
  if (/[\u0000-\u001f\u007f]/.test(title)) throw new InputError("标题请写在一行内");
  return title;
}
async function list(ctx) {
  const moment = ctx.url.searchParams.get("moment");
  if (moment !== null && !Object.hasOwn(catalog.moments, moment)) throw new InputError("没有这一页瞬间");
  const cursor = ctx.url.searchParams.get("before");
  const [time, id, extra] = (cursor || "").split(".");
  if (cursor !== null && (!/^\d{1,13}$/.test(time) || !isId(id) || extra !== undefined))
    throw new InputError("翻页位置无效");
  const where = ["status='ready'"],
    values = [];
  if (moment) {
    where.push("pose=?");
    values.push(moment);
  }
  if (cursor) {
    where.push("(captured,id)<(?,?)");
    values.push(Number(time), id);
  }
  const [page, stamps, home] = await ctx.db.batch([
    ctx.db
      .prepare(
        "SELECT " +
          fields +
          " FROM rabbit_photos WHERE " +
          where.join(" AND ") +
          " ORDER BY captured DESC,id DESC LIMIT 13"
      )
      .bind(...values),
    ctx.db.prepare(`SELECT m.pose,(SELECT id FROM rabbit_photos WHERE status='ready' AND pose=m.pose
      ORDER BY captured DESC,id DESC LIMIT 1) AS id
      FROM (SELECT DISTINCT pose FROM rabbit_photos WHERE status='ready') m`),
    rabbitNameQuery(ctx.db)
  ]);
  const photos = page.results.slice(0, 12);
  const last = photos.at(-1);
  return Response.json({
    rabbitName: home.results[0].name,
    photos,
    next: page.results.length > 12 ? last.captured + "." + last.id : null,
    covers: Object.fromEntries(
      stamps.results.filter((r) => Object.hasOwn(catalog.moments, r.pose)).map((r) => [r.pose, r.id])
    )
  });
}
async function exposurePixels(file) {
  if (!file || typeof file === "string" || file.size < 40 || file.size > 2300000)
    throw new InputError("请选择取景框拍下的照片");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    header = new DataView(bytes.buffer);
  const chunkName = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(8) !== 13 ||
    chunkName(12) !== "IHDR" ||
    header.getUint32(16) !== 720 ||
    header.getUint32(20) !== 720 ||
    chunkName(bytes.length - 8) !== "IEND"
  )
    throw new InputError("相纸需要 720 × 720 的 PNG 原片");
  let hasPixels = false,
    end = false;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = header.getUint32(at),
      type = chunkName(at + 4);
    if (length > bytes.length - at - 12 || type === "acTL") break;
    at += length + 12;
    if (type === "IDAT" && length) hasPixels = true;
    if (type === "IEND") {
      end = length === 0 && at === bytes.length;
      break;
    }
  }
  if (!hasPixels || !end) throw new InputError("这张原片不完整，请重新拍一张");
  return bytes;
}
async function upload(ctx) {
  if (ctx.role !== "her") return plain("只有她可以按快门", 403);
  const form = await readForm(ctx.request, 3 * 1024 * 1024);
  const id = form.get("id"),
    scene = form.get("scene"),
    light = form.get("light"),
    pose = form.get("pose");
  const captured = Number(form.get("captured")),
    offset = Number(form.get("offset"));
  if (
    !isId(id) ||
    !Object.hasOwn(catalog.scenes, scene) ||
    !Object.hasOwn(catalog.notes, pose) ||
    !["day", "dusk", "night"].includes(light) ||
    !form.has("offset") ||
    !Number.isInteger(offset) ||
    Math.abs(offset) > 840 ||
    !Number.isSafeInteger(captured) ||
    captured < 1 ||
    captured > 8640000000000 ||
    (pose === "stump" && scene !== "snow") ||
    (pose === "nap" && (scene !== "snow" || light !== "night"))
  ) {
    throw new InputError("照片的拍摄记录不完整");
  }
  const title = titleFrom(form),
    bytes = await exposurePixels(form.get("image"));
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const digest = Array.from(hash, (x) => x.toString(16).padStart(2, "0")).join("");
  // Reserve one immutable exposure before uploading. Identical retries can finish each other's work.
  const [, found] = await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO rabbit_photos(id,status,digest,captured,offset_minutes,scene,light,pose,title)
      VALUES(?,'writing',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET touched=unixepoch()
      WHERE rabbit_photos.status='writing' AND rabbit_photos.digest=excluded.digest`
      )
      .bind(id, digest, captured, offset, scene, light, pose, title),
    ctx.db.prepare("SELECT " + fields + ",status,digest FROM rabbit_photos WHERE id=?").bind(id)
  ]);
  const row = found.results[0];
  if (
    row.digest !== digest ||
    row.captured !== captured ||
    row.offset !== offset ||
    row.scene !== scene ||
    row.light !== light ||
    row.pose !== pose ||
    !["writing", "ready"].includes(row.status)
  )
    return conflict("这张相纸已经用过了");
  if (row.status === "writing") {
    await ctx.bucket.put(key(id), bytes, { httpMetadata: { contentType: "image/png" } });
    const [, now] = await ctx.db.batch([
      ctx.db
        .prepare(
          "UPDATE rabbit_photos SET status='ready',touched=unixepoch() WHERE id=? AND status='writing'"
        )
        .bind(id),
      ctx.db.prepare("SELECT status FROM rabbit_photos WHERE id=?").bind(id)
    ]);
    if (now.results[0].status !== "ready") {
      await ctx.bucket.delete(key(id));
      return conflict("这张照片已经取下了");
    }
  }
  return Response.json({ id, title: row.title });
}
async function eraseObject(ctx, id) {
  await ctx.bucket.delete(key(id));
  await ctx.db
    .prepare(
      "UPDATE rabbit_photos SET status='deleted',title='',digest='',captured=0,offset_minutes=0,scene='paper',light='day',pose='scenery' WHERE id=? AND status='deleting'"
    )
    .bind(id)
    .run();
}
// Finish interrupted removals and reclaim abandoned writes when the album is next opened.
async function tidy(ctx) {
  const pending = await ctx.db
    .prepare(
      "SELECT id FROM rabbit_photos WHERE status='deleting' OR (status='writing' AND touched<unixepoch()-86400) LIMIT 6"
    )
    .all();
  for (const { id } of pending.results) {
    const row = await ctx.db
      .prepare(
        "UPDATE rabbit_photos SET status='deleting' WHERE id=? AND (status='deleting' OR (status='writing' AND touched<unixepoch()-86400)) RETURNING id"
      )
      .bind(id)
      .first();
    if (row) await eraseObject(ctx, id);
  }
}
export async function albumApi(ctx, rest) {
  if (!rest) {
    if (!ctx.read) return upload(ctx);
    ctx.defer(tidy(ctx).catch((error) => console.warn("Album cleanup deferred", error.name)));
    return list(ctx);
  }
  const [id, action, extra] = rest.split("/");
  if (!isId(id) || extra !== undefined || !["image", "title", "delete"].includes(action)) return missing();
  if (action === "image") {
    if (!ctx.read) return plain("请使用 GET", 405, { Allow: "GET, HEAD" });
    const row = await ctx.db
      .prepare("SELECT id FROM rabbit_photos WHERE id=? AND status='ready'")
      .bind(id)
      .first();
    if (!row) return missing();
    const head = ctx.request.method === "HEAD";
    const object = head ? await ctx.bucket.head(key(id)) : await ctx.bucket.get(key(id));
    return object
      ? new Response(head ? null : object.body, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(object.size),
            ETag: object.httpEtag
          }
        })
      : missing();
  }
  if (ctx.read) return plain("请使用 POST", 405, { Allow: "POST" });
  const form = await readForm(ctx.request),
    rev = Number(form.get("revision"));
  if (!Number.isSafeInteger(rev) || rev < 1) throw new InputError("请重新翻开这张照片");
  if (action === "title") {
    const title = titleFrom(form);
    const row = await ctx.db
      .prepare(
        "UPDATE rabbit_photos SET title=?, revision=revision+1 WHERE id=? AND status='ready' AND revision=? RETURNING " +
          fields
      )
      .bind(title, id, rev)
      .first();
    if (row) return Response.json(row);
  } else {
    const row = await ctx.db
      .prepare(
        "UPDATE rabbit_photos SET status='deleting' WHERE id=? AND status='ready' AND revision=? RETURNING id"
      )
      .bind(id, rev)
      .first();
    if (row) {
      await eraseObject(ctx, id);
      return empty();
    }
  }
  const current = await ctx.db.prepare("SELECT status FROM rabbit_photos WHERE id=?").bind(id).first();
  if (action === "delete" && current?.status === "deleting") {
    await eraseObject(ctx, id);
    return empty();
  }
  if (action === "delete" && current?.status === "deleted") return empty();
  return current?.status === "ready" ? conflict("这张照片刚刚改过，请重新翻开。") : missing();
}
