import { adminPage } from "../../app/views.js";
import { empty, field, h, InputError, isId, readForm, saveBar } from "../../shared/content.js";
import { saved } from "../../shared/http.js";

const base = "/admin/wallet";
const pageSize = 25;
const sources = { reading: "读完章节", puzzle: "完成 Puzzle", allowance: "陪伴零花钱", adjustment: "管理员调账",
  purchase: "商店购买", care: "摸摸头", gift: "久别的小礼物" };
const formatTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
});
const formatDay = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" });

async function snapshot(ctx) {
  const cursor = ctx.url.searchParams.get("before");
  if (cursor !== null && (!/^[1-9]\d{0,15}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) {
    throw new InputError("流水位置无效");
  }
  const [account, history] = await ctx.db.batch([
    ctx.db.prepare(`SELECT balance, (SELECT coalesce(sum(earned-claimed),0) FROM companion_earnings) AS pending
      FROM wallets WHERE owner='her'`),
    ctx.db.prepare(`SELECT id,kind,delta,detail,note,day_start,created_at FROM wallet_entries
      WHERE id < ? ORDER BY id DESC LIMIT ?`).bind(cursor === null ? Number.MAX_SAFE_INTEGER : Number(cursor), pageSize + 1)
  ]);
  const entries = history.results.slice(0, pageSize).map(entry => ({ ...entry, source: sources[entry.kind] }));
  return { ...account.results[0], entries, nextBefore: history.results.length > pageSize ? entries.at(-1).id : null };
}

export async function wallet(ctx) {
  return Response.json(await snapshot(ctx));
}

async function adjust(ctx) {
  const form = await readForm(ctx.request);
  const key = form.get("request_id"), direction = form.get("direction"), raw = form.get("amount");
  if (!isId(key)) throw new InputError("调账凭据无效，请刷新后重试");
  if (!["add", "subtract"].includes(direction)) throw new InputError("请选择增加或扣减");
  if (!/^[1-9]\d{0,8}$/.test(raw ?? "")) throw new InputError("数量须为 1 至 999999999 的整数");
  const note = field(form, "note", "留言", 160, false);
  const delta = Number(raw) * (direction === "add" ? 1 : -1);
  const receipt = "admin:" + key;
  const [, result] = await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,note)
      SELECT 'adjustment',?1,?2,?3 FROM wallets WHERE owner='her' AND balance+?2>=0
      ON CONFLICT(idempotency_key) DO NOTHING`).bind(receipt, delta, note),
    ctx.db.prepare("SELECT delta,note FROM wallet_entries WHERE idempotency_key=?").bind(receipt)
  ]);
  const existing = result.results[0];
  if (!existing) throw new InputError("余额不足，无法扣减");
  if (existing.delta !== delta || existing.note !== note) throw new InputError("这次调账已提交，请刷新后再添加另一笔");
  return saved(ctx, base);
}

export async function manageWallet(ctx) {
  if (!ctx.read) return adjust(ctx);
  const { balance, pending, entries, nextBefore } = await snapshot(ctx);
  const form = `<form class="editor" data-editor method="post" action="${base}">
    <input type="hidden" name="request_id" value="${crypto.randomUUID()}">
    <div class="adjust-amount"><label>操作<select name="direction"><option value="add">增加</option><option value="subtract">扣减</option></select></label>
    <label>金币数量<input type="number" name="amount" min="1" max="999999999" step="1" inputmode="numeric" required></label></div>
    <label>给她的留言（选填）<input name="note" maxlength="160"></label>${saveBar("记入钱包")}</form>`;
  const history = entries.map(entry => {
    const detail = entry.day_start !== null ? formatDay.format(entry.day_start * 1000) : entry.detail;
    return `<li><div><strong>${entry.source}</strong>${detail ? " · " + h(detail) : ""}
      <time datetime="${new Date(entry.created_at * 1000).toISOString()}">${formatTime.format(entry.created_at * 1000)}</time>
      ${entry.note ? `<p>${h(entry.note)}</p>` : ""}</div><b>${entry.delta > 0 ? "+" : "−"}${Math.abs(entry.delta)}</b></li>`;
  }).join("");
  const body = `<dl class="account-totals"><div><dt>余额</dt><dd>${balance}</dd></div>
    <div><dt>陪伴待领取</dt><dd>${pending}</dd></div></dl>${form}<h2>流水</h2>
    ${history ? `<ul class="account-history">${history}</ul>` : empty("还没有流水")}
    <nav class="pager" aria-label="流水翻页">${ctx.url.searchParams.has("before") ? `<a href="${base}">最新流水</a>` : ""}
    ${nextBefore ? `<a href="${base}?before=${nextBefore}">更早的流水</a>` : ""}</nav>`;
  return adminPage(ctx, "她的钱包", body);
}
