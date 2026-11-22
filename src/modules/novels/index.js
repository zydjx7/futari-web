import { pageError, shell, turnLink } from "../../app/views.js";
import { icon } from "../../app/illustrations.js";
import { empty, h, InputError, isId, readForm } from "../../shared/content.js";
import { manage } from "./manage.js";
import { chapterRead } from "../wallet/earnings.js";
import { rewards } from "../wallet/config.js";

import { paragraphs } from "./paragraphs.js";
import { directory, directoryView } from "./toc.js";
import { notesPanel } from "./notes.js";

async function saveProgress(ctx, id) {
  const form = await readForm(ctx.request);
  const values = ["chapter", "paragraph", "offset", "revision"].map(name => form.get(name));
  if (values.some(value => !/^\d{1,10}$/.test(value ?? ""))) throw new InputError("阅读位置无效");
  const [chapter, paragraph, offset, revision] = values.map(Number);
  const row = await ctx.db.prepare("SELECT body FROM chapters WHERE book_id = ? AND number = ?").bind(id, chapter).first();
  if (!row) return pageError("找不到章节", 404);
  const lines = paragraphs(row.body);
  const index = Math.min(paragraph, Math.max(0, lines.length - 1));
  const position = Math.min(offset, lines[index]?.length || 0);
  const result = await ctx.db.prepare(`INSERT INTO reading_progress(member,book_id,chapter,paragraph,char_offset,revision)
    VALUES(?1,?2,?3,?4,?5,1) ON CONFLICT(member,book_id) DO UPDATE SET chapter=excluded.chapter,
    paragraph=excluded.paragraph,char_offset=excluded.char_offset,revision=reading_progress.revision+1
    WHERE reading_progress.revision=?6 RETURNING revision`)
    .bind(ctx.role, id, chapter, index, position, revision).first();
  if (result) return Response.json(result);
  const latest = await ctx.db.prepare("SELECT revision FROM reading_progress WHERE member=? AND book_id=?").bind(ctx.role, id).first();
  return Response.json(latest, { status: 409 });
}

async function shelf(ctx) {
  const { results } = await ctx.db.prepare(`SELECT b.id, b.title,
    (SELECT count(*) FROM chapters INDEXED BY chapters_toc WHERE book_id=b.id) AS chapters,
    (SELECT label FROM book_reading_links WHERE book_id=b.id ORDER BY position LIMIT 1) AS reading_label,
    p.chapter AS current, (SELECT count(*) FROM wallet_entries WHERE ?1='her' AND kind='reading'
      AND idempotency_key>='reading:her:'||b.id||':' AND idempotency_key<'reading:her:'||b.id||';') AS completed
    FROM books b
    LEFT JOIN reading_progress p ON p.book_id=b.id AND p.member=?1
    ORDER BY b.created_at DESC,b.rowid DESC`).bind(ctx.role).all();
  const colors = ["apricot", "rose", "sage", "blue"];
  const cards = results.map(book => {
    let hash = 0;
    for (const c of book.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    if (!book.chapters && book.reading_label) {
      return `<a class="book-card" data-spine="${colors[hash % colors.length]}" href="/novels/${book.id}"><h2>${h(book.title)}</h2><div class="book-meta">${h(book.reading_label)}</div></a>`;
    }
    const bookmark = book.current ? `<span class="resume">${icon("bookmark")}续读 · 第 ${book.current} 章</span>` : "";
    const value = ctx.role === "her" ? book.completed : book.current || 0;
    const progressLabel = `${ctx.role === "her" ? "已读章节" : "书签位置"} · ${value} / ${book.chapters} 章`;
    return `<a class="book-card" data-spine="${colors[hash % colors.length]}" href="/novels/${book.id}"><h2>${h(book.title)}</h2>
      <div class="book-meta"><span>共 ${book.chapters} 章</span>${bookmark}</div>
      <progress aria-label="${progressLabel}" title="${progressLabel}" max="${book.chapters || 1}" value="${value}"></progress></a>`;
  }).join("");
  return shell("/novels", ctx, { title: "小说", meta: `<div class="heading-meta">书架 · ${results.length} 本</div>`,
    body: cards ? `<div class="shelf">${cards}</div>` : empty("书架还是空的") });
}

async function reader(ctx, id) {
  const [book, progress] = await Promise.all([
    ctx.db.prepare("SELECT b.title,coalesce(t.total,0) AS total FROM books b LEFT JOIN book_chapter_counts t ON t.book_id=b.id WHERE b.id=?").bind(id).first(),
    ctx.db.prepare("SELECT chapter,paragraph,char_offset,revision FROM reading_progress WHERE member=? AND book_id=?").bind(ctx.role, id).first()
  ]);
  if (!book) return pageError("找不到这本书", 404);
  const url = "/novels/" + id;
  const options = { title: book.title, back: ["/novels", "书架"], reader: true };
  if (!book.total) {
    const { results: links } = await ctx.db.prepare("SELECT label,url FROM book_reading_links WHERE book_id=? ORDER BY position").bind(id).all();
    const body = links.length ? `<nav class="entry-list" aria-label="阅读入口">${links.map(link =>
      `<a class="text-link" href="${h(link.url)}" target="_blank" rel="noopener noreferrer">${h(link.label)} ↗</a>`).join("")}</nav>` : empty("还没有章节");
    return shell("/novels", ctx, { ...options, body });
  }
  const explicit = ctx.url.searchParams.has("chapter");
  const wanted = explicit ? Number(ctx.url.searchParams.get("chapter")) : progress?.chapter;
  if (explicit && (!Number.isSafeInteger(wanted) || wanted<1)) return pageError("找不到章节",404);
  const chapter = wanted ? await ctx.db.prepare("SELECT number,title,body FROM chapters WHERE book_id=? AND number=?").bind(id,wanted).first()
    : await ctx.db.prepare("SELECT number,title,body FROM chapters WHERE book_id=? ORDER BY number LIMIT 1").bind(id).first();
  if (!chapter) return pageError("找不到章节",404);
  const n=chapter.number;
  const [before,after] = await ctx.db.batch([
    ctx.db.prepare("SELECT number,title FROM chapters INDEXED BY chapters_toc WHERE book_id=? AND number<? ORDER BY number DESC LIMIT 1").bind(id,n),
    ctx.db.prepare("SELECT number,title FROM chapters INDEXED BY chapters_toc WHERE book_id=? AND number>? ORDER BY number LIMIT ?").bind(id,n,book.total<=3?2:1)
  ]);
  const fallback=`<a href="${url}/toc?view=html&amp;around=${n}">浏览分页目录</a>`;
  const shortList=book.total<=3 ? [...before.results,chapter,...after.results].map(c=>`<a href="${url}?chapter=${c.number}">${h(c.title)}</a>`).join("") : "";
  const tones = [["blush", "樱奶纸"], ["paper", "暖阳纸"], ["green", "护眼绿"], ["blue", "晴雾蓝"], ["night", "柔夜暗"]];
  const toolbar = `<div class="reader-toolbar"><details class="contents"><summary>${icon("contents")}目录</summary><div class="chapter-list toc-panel">
    <form action="${url}/toc" class="toc-search"><input type="hidden" name="view" value="html"><input name="q" type="search" maxlength="200" autocomplete="off" aria-label="搜章名或章号" placeholder="搜章名或输入章号"><button class="subtle">查找</button></form>
    <nav class="toc-pages" aria-label="目录翻页" hidden><button type="button" data-page-step="-1">上一页</button><output></output><button type="button" data-page-step="1">下一页</button></nav>
    <nav class="toc-items" aria-label="章节目录">${fallback}${shortList}</nav></div></details>
    <details class="appearance" data-reader-prefs hidden><summary><b aria-hidden="true">Aa</b>外观</summary>
      <div class="appearance-panel"><div class="setting"><span>字号</span><div class="type-steps" role="group" aria-label="正文字号">
        <button type="button" data-step="-1" aria-label="减小字号">A-</button><output data-size-label aria-live="polite">标准</output>
        <button type="button" data-step="1" aria-label="增大字号">A+</button></div></div>
        <div class="setting"><span>底色</span><div class="swatches" role="group" aria-label="阅读底色">${tones.map(([value, label]) =>
          `<button type="button" data-tone="${value}" aria-label="${label}" title="${label}" aria-pressed="${value === "blush"}"><i aria-hidden="true"></i></button>`).join("")}</div></div>
        <output class="tone-label" data-tone-label>樱奶纸</output></div></details></div>`;
  const stepLink = (entry, rel, label) => entry ? turnLink(rel, url + "?chapter=" + entry.number, label, entry.title) : "";
  const body = toolbar + `<article class="reader-text" data-book="${id}" data-chapter="${n}" data-revision="${progress?.revision ?? 0}"
    data-paragraph="${explicit ? 0 : progress?.paragraph ?? 0}" data-offset="${explicit ? 0 : progress?.char_offset ?? 0}"
    data-record-open="${Number(explicit || !progress)}" data-member="${ctx.role}" ${ctx.role === "her" ? `data-visible-seconds="${rewards.chapterVisibleSeconds}"` : ""}><h2>${h(chapter.title)}</h2>
    ${paragraphs(chapter.body).map((line,i) => `<span class="para-anchor" id="note-p-${i}"></span><p>${h(line)}</p>`).join("")}</article>
    <nav class="turns" aria-label="翻章">${stepLink(before.results[0], "prev", "上一章")}${stepLink(after.results[0], "next", "下一章")}</nav>${notesPanel()}
    <p class="form-error" role="status" data-read-error hidden></p>`;
  return shell("/novels", ctx, { ...options, body, script: "reader" });
}

async function page(ctx, rest) {
  if (!rest && ctx.read) return shelf(ctx);
  const [id, action, extra] = rest.split("/");
  if (isId(id) && extra === undefined) {
    if (!action && ctx.read) return reader(ctx, id);
    if (action==="toc" && ctx.read) {
      const book=await ctx.db.prepare("SELECT title FROM books WHERE id=?").bind(id).first();
      if (!book) return pageError("找不到这本书",404);
      const list=await directory(ctx.db,id,ctx.url.searchParams), base="/novels/"+id;
      return ctx.url.searchParams.get("view")==="html" ? shell("/novels",ctx,{title:book.title+" · 目录",back:[base,"返回阅读"],body:directoryView(list,base+"/toc")}) : Response.json(list);
    }
    if (action === "progress" && !ctx.read) return saveProgress(ctx, id);
    if (action === "read" && !ctx.read) return chapterRead(ctx, id);
  }
  return pageError("找不到此页", 404);
}
export default { path: "/novels", title: "小说", page, manage };
