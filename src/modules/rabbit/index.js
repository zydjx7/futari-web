import { downloads } from "./downloads.js";
import { InputError, isId, readForm } from "../../shared/content.js";
import { plain } from "../../shared/http.js";
import { rewards, shop } from "../wallet/config.js";
import { settleAllowance } from "../wallet/earnings.js";
import { renameRabbit } from "./name.js";

// Both the read and the debit calculate fullness on the server's clock.
const fullness = `max(0,satiety-CAST(max(0,unixepoch()-coalesce(last_fed,unixepoch()))/?1 AS INTEGER))`;
const conflict = (message) => Response.json({ error: message }, { status: 409 });
const letter = "kind='adjustment' AND (delta>0 OR note<>'')";

async function state(db) {
  const [home, stock] = await db.batch([
    db.prepare(`SELECT ${fullness} AS satiety, rabbit_home.name, scene, atmosphere, balance,
      (SELECT count(*) FROM wallet_entries e WHERE ${letter} AND NOT EXISTS
        (SELECT 1 FROM rabbit_mail_reads r WHERE r.entry_id=e.id)) AS unread
      FROM rabbit_home JOIN wallets USING(owner) WHERE owner='her'`).bind(rewards.satietySecondsPerPoint),
    db.prepare("SELECT item,quantity,placed FROM rabbit_inventory WHERE quantity>0")
  ]);
  const inventory = Object.fromEntries(stock.results.map((row) => [row.item, row.quantity]));
  return Response.json({ ...home.results[0], inventory, placed: stock.results.filter(r=>r.placed).map(r=>r.item), shop });
}

async function visit(db) {
  const [gift] = await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_entries(kind,idempotency_key,delta)
      SELECT 'gift','rabbit:return:'||last_visit,? FROM rabbit_home WHERE owner='her' AND last_visit<=unixepoch()-?
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING delta`
      )
      .bind(rewards.returnCoins, rewards.returnAfterDays * 86400),
    db.prepare("UPDATE rabbit_home SET last_visit=unixepoch() WHERE owner='her'"),
    settleAllowance(db)
  ]);
  return Response.json({ gift: gift.results[0]?.delta ?? 0 });
}

async function mailbox(ctx) {
  const raw = ctx.url.searchParams.get("before");
  if (raw !== null && !validEntry(raw)) throw new InputError("信件位置无效");
  const rows = await ctx.db.prepare(`SELECT e.id,e.note,e.delta,r.entry_id IS NOT NULL AS opened
    FROM wallet_entries e LEFT JOIN rabbit_mail_reads r ON r.entry_id=e.id
    WHERE ${letter} AND e.id<? ORDER BY e.id DESC LIMIT 21`).bind(raw ? Number(raw) : Number.MAX_SAFE_INTEGER).all();
  const letters = rows.results.slice(0,20);
  return Response.json({ letters, nextBefore: rows.results.length>20 ? letters.at(-1).id : null });
}
const validEntry = value => /^[1-9]\d{0,15}$/.test(value ?? "") && Number.isSafeInteger(Number(value));

async function openLetter(db, id) {
  if (!validEntry(id)) throw new InputError("信件无效");
  const [found] = await db.batch([
    db.prepare(`SELECT id FROM wallet_entries WHERE id=? AND ${letter}`).bind(Number(id)),
    db.prepare(`INSERT OR IGNORE INTO rabbit_mail_reads SELECT id FROM wallet_entries WHERE id=? AND ${letter}`).bind(Number(id))
  ]);
  return found.results.length ? new Response(null,{status:204}) : plain("找不到这封信",404);
}

async function pet(db) {
  await db
    .prepare(
      `INSERT INTO wallet_entries(kind,idempotency_key,delta)
    VALUES('care','rabbit:pet:'||CAST((unixepoch()+?)/86400 AS INTEGER),?) ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .bind(rewards.dayOffsetSeconds, rewards.firstPetCoins)
    .run();
  return new Response(null, { status: 204 });
}

async function buy(db, item, id) {
  const product = shop[item],
    key = "rabbit:buy:" + id;
  const [added, receipt, owned] = await db.batch([
    db
      .prepare(
        `INSERT INTO wallet_entries(kind,idempotency_key,delta,detail,item)
      SELECT 'purchase',?1,-?2,?3,?4 FROM wallets WHERE owner='her' AND balance>=?2
      AND (?5>0 OR NOT EXISTS (SELECT 1 FROM rabbit_inventory WHERE item=?4 AND quantity>0))
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`
      )
      .bind(key, product.price, product.name, item, product.nourishment),
    db.prepare("SELECT item FROM wallet_entries WHERE idempotency_key=?").bind(key),
    db.prepare("SELECT quantity FROM rabbit_inventory WHERE item=?").bind(item)
  ]);
  if (!receipt.results.length) {
    return conflict(!product.nourishment && owned.results[0]?.quantity ? "兔窝里已经有了" : "余额不足");
  }
  if (receipt.results[0].item !== item) return conflict("这笔购买已经用于另一件物品");
  return Response.json({ applied: added.results.length > 0 });
}

async function feed(db, item, id) {
  const gain = shop[item].nourishment;
  if (!gain) throw new InputError("请选择食物");
  const [added, receipt, stock] = await db.batch([
    db
      .prepare(
        `INSERT INTO rabbit_feeds(request_id,item,fed_at,satiety_after)
      SELECT ?2,?3,unixepoch(),min(100,${fullness}+?4) FROM rabbit_home WHERE owner='her'
      AND (last_fed IS NULL OR last_fed<=unixepoch()-?5) AND ${fullness}<100
      AND EXISTS(SELECT 1 FROM rabbit_inventory WHERE item=?3 AND quantity>0)
      ON CONFLICT(request_id) DO NOTHING RETURNING request_id`
      )
      .bind(rewards.satietySecondsPerPoint, id, item, gain, rewards.feedCooldownSeconds),
    db.prepare("SELECT item FROM rabbit_feeds WHERE request_id=?").bind(id),
    db
      .prepare(
        `SELECT quantity,${fullness} AS current_satiety FROM rabbit_home
      LEFT JOIN rabbit_inventory ON item=?2 WHERE rabbit_home.owner='her'`
      )
      .bind(rewards.satietySecondsPerPoint, item)
  ]);
  if (!receipt.results.length) {
    if (!stock.results[0]?.quantity) return conflict("背包里没有这份食物了");
    if (stock.results[0].current_satiety >= 100) return conflict("兔子已经吃饱了");
    return conflict("兔子刚吃过，等一会儿再喂");
  }
  if (receipt.results[0].item !== item) return conflict("这次喂食已经使用了另一份食物");
  return Response.json({ applied: added.results.length > 0 });
}

export async function rabbitApi(ctx, action) {
  if (ctx.role !== "her") return plain("没有权限", 403);
  if (action === "downloads") return ctx.read ? downloads(ctx.bucket) : plain("请使用 GET", 405, { Allow: "GET, HEAD" });
  if (action === "state") return ctx.read ? state(ctx.db) : plain("请使用 GET", 405, { Allow: "GET, HEAD" });
  if (action === "mail") return ctx.read ? mailbox(ctx) : plain("请使用 GET",405,{Allow:"GET, HEAD"});
  if (!["visit", "pet", "buy", "feed", "scene", "atmosphere", "place", "open-letter", "rename"].includes(action)) return plain("找不到内容", 404);
  if (ctx.read) return plain("请使用 POST", 405, { Allow: "POST" });
  if (action === "rename") return renameRabbit(ctx);
  if (action === "visit") return visit(ctx.db);
  if (action === "pet") return pet(ctx.db);
  const form = await readForm(ctx.request);
  if (action === "open-letter") return openLetter(ctx.db, form.get("id"));
  if (action === "atmosphere") {
    const mode = form.get("atmosphere");
    if (!["auto","day","dusk","night"].includes(mode)) throw new InputError("没有这页光影");
    await ctx.db.prepare("UPDATE rabbit_home SET atmosphere=? WHERE owner='her'").bind(mode).run();
    return new Response(null,{status:204});
  }
  if (action === "scene") {
    const scene = form.get("scene");
    if (!["paper","snow"].includes(scene)) throw new InputError("没有这幅风景");
    await ctx.db.prepare("UPDATE rabbit_home SET scene=? WHERE owner='her'").bind(scene).run();
    return new Response(null,{status:204});
  }
  const item = form.get("item"),
    key = form.get("request_id");
  if (action === "place") {
    if (!Object.hasOwn(shop,item) || shop[item].nourishment) throw new InputError("请选择窝里的摆件");
    const placed = await ctx.db.prepare("UPDATE rabbit_inventory SET placed=1 WHERE item=? AND quantity>0 RETURNING item")
      .bind(item).first();
    return placed ? new Response(null,{status:204}) : conflict("先把它带回小篮子吧");
  }
  if (!Object.hasOwn(shop, item) || !isId(key)) throw new InputError("物品或操作凭据无效");
  return action === "buy" ? buy(ctx.db, item, key) : feed(ctx.db, item, key);
}
