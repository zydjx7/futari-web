import { adminPage, pageError, shell } from "../../app/views.js";
import { deviceDay, empty, field, h, InputError, isId, readForm, saveBar, selectedDay, shiftDay, shortDate, validDay, weekdayName } from "../../shared/content.js";
import { saved } from "../../shared/http.js";

const base = "/admin/news";
function sourceUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Report the field error below. */ }
  throw new InputError("原文链接须为完整的 http 或 https 网址");
}

async function page(ctx, rest) {
  if (rest || !ctx.read) return pageError("找不到此页", 404);
  const day = selectedDay(ctx);
  const [dates, items] = await Promise.all([
    ctx.db.prepare("SELECT DISTINCT day FROM news_items ORDER BY day DESC").all(),
    ctx.db.prepare("SELECT * FROM news_items WHERE day=? ORDER BY created_at DESC,rowid DESC").bind(day).all()
  ]);
  const archive = [...new Set([day, deviceDay(ctx.request), ...dates.results.map(item => item.day)])].sort().reverse();
  const meta = `<div class="heading-meta"><time datetime="${day}"${ctx.url.searchParams.has("day") ? "" : ` data-default-day="${day}"`}>${day.slice(0,4)}年${shortDate(day)} · ${weekdayName(day)}</time></div>`;
  const controls = `<div class="news-controls"><nav class="date-links" aria-label="切换日期"><a href="/news?day=${shiftDay(day, -1)}">‹ 前一天</a><a href="/news?day=${shiftDay(day, 1)}">后一天 ›</a></nav>
    <form class="archive" action="/news"><label class="sr-only" for="archive-date">归档日期</label>
    <select id="archive-date" name="day">${archive.map(date => `<option${date===day ? " selected" : ""}>${date}</option>`).join("")}</select><button class="subtle">查看</button></form></div>`;
  const body = controls + '<div class="news-feed">' + (items.results.map(item => {
    const text = `<h2>${h(item.title)}</h2><p>${h(item.summary)}</p>`;
    const link = item.source ? `<a class="text-link" href="${h(item.source)}" rel="noopener noreferrer" target="_blank">原文链接 <span aria-hidden="true">↗</span></a>` : "";
    return item.body ? `<article><details><summary>${text}</summary><div class="writing">${h(item.body)}</div></details>${link}</article>`
      : `<article>${text}${link}</article>`;
  }).join("") || empty("当天还没有新闻")) + "</div>";
  return shell("/news", ctx, { title: "新闻", meta, body, script: "today" });
}

async function manage(ctx, rest) {
  if (!rest && ctx.read) {
    const { results } = await ctx.db.prepare("SELECT id,day,title FROM news_items ORDER BY day DESC,created_at DESC,rowid DESC").all();
    const body = '<div class="entry-list">' + (results.map(n =>
      `<a href="${base}/${n.id}"><span>${h(n.title)}</span><small>${n.day}</small></a>`).join("") || empty("还没有新闻")) + "</div>";
    return adminPage(ctx, "新闻", body, { tools: `<a class="subtle" href="${base}/new">添加新闻</a>` });
  }
  const fresh = rest === "new" && ctx.read, id = fresh ? crypto.randomUUID() : rest;
  if (!isId(id)) return pageError("找不到新闻", 404);
  if (!ctx.read) {
    const form = await readForm(ctx.request), day = form.get("day");
    if (!validDay(day)) throw new InputError("请选择归档日期");
    const title = field(form, "title", "标题", 200), summary = field(form, "summary", "摘要", 3000);
    const body = field(form, "body", "正文", 140000, false), source = sourceUrl(field(form, "source", "原文链接", 2048, false));
    await ctx.db.prepare(`INSERT INTO news_items(id,day,title,summary,body,source) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET day=excluded.day,title=excluded.title,summary=excluded.summary,body=excluded.body,source=excluded.source`)
      .bind(id, day, title, summary, body, source).run();
    return saved(ctx, base);
  }
  const row = fresh ? { day: deviceDay(ctx.request) } : await ctx.db.prepare("SELECT * FROM news_items WHERE id=?").bind(id).first();
  if (!row) return pageError("找不到新闻", 404);
  const form = `<form class="editor" data-editor method="post" action="${base}/${id}">
    <label>归档日期<input type="date" name="day" required value="${h(row.day)}"></label>
    <label>标题<input name="title" required maxlength="200" value="${h(row.title)}"></label>
    <label>摘要<textarea name="summary" required maxlength="3000" rows="3">${h(row.summary)}</textarea></label>
    <label>正文<textarea name="body" maxlength="140000" rows="8">${h(row.body)}</textarea></label>
    <label>原文链接<input type="url" name="source" maxlength="2048" value="${h(row.source)}" placeholder="https://"></label>${saveBar("保存新闻")}</form>`;
  return adminPage(ctx, fresh ? "添加新闻" : "编辑新闻", form, { back: [base, "新闻管理"] });
}
export default { path: "/news", title: "新闻", page, manage };
