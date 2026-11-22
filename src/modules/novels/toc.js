import { h } from "../../shared/content.js";

const positive = (value, fallback) => /^[1-9]\d{0,8}$/.test(value || "") ? Number(value) : fallback;

export async function directory(db, id, params) {
  const size = Math.min(100,positive(params.get("size"),100));
  const q = (params.get("q") || "").trim().slice(0,200);
  const numeric = positive(q,null);
  const where = "FROM chapters INDEXED BY chapters_toc WHERE book_id=?" +
    (q ? numeric ? " AND number=?" : " AND instr(lower(title),lower(?))>0" : "");
  const args = q ? [id,numeric ?? q] : [id];
  const around = positive(params.get("around"),null);
  const count = db.prepare("SELECT count(*) AS n " + where).bind(...args);
  const counts = [count];
  if (around) counts.push(db.prepare("SELECT count(*) AS n " + where + " AND number<?").bind(...args,around));
  const result = await db.batch(counts);
  const total = result[0].results[0].n, pages = Math.max(1,Math.ceil(total/size));
  const page = Math.min(pages,around ? 1+Math.floor(result[1].results[0].n/size) : positive(params.get("page"),1));
  const {results:items} = await db.prepare("SELECT number,title " + where + " ORDER BY number LIMIT ? OFFSET ?").bind(...args,size,(page-1)*size).all();
  return {items,total,page,size,pages,q};
}

export function directoryView(list, base, edit = false) {
  const params = new URLSearchParams();
  if (!edit) params.set("view","html");
  if (list.q) params.set("q",list.q);
  function pageLink(n,label) {
    if(n<1 || n>list.pages) return "";
    params.set("page",String(n));
    return `<a href="${h(base+"?"+params)}">${label}</a>`;
  }
  const book = edit ? base : base.slice(0,-4);
  return `<form class="toc-search" action="${base}">${edit?"":'<input type="hidden" name="view" value="html">'}<input type="search" name="q" value="${h(list.q)}" aria-label="搜章名或章号" placeholder="搜章名或输入章号" maxlength="200"><button class="subtle">查找</button></form>
    <nav class="toc-pages" aria-label="目录翻页">${pageLink(list.page-1,"上一页")} <span>${list.page} / ${list.pages} 页 · ${list.total} 章</span> ${pageLink(list.page+1,"下一页")}</nav>
    <div class="entry-list">${list.items.map(c=>`<a href="${book}${edit?"/chapters/":"?chapter="}${c.number}"><small>${c.number}</small> ${h(c.title)}</a>`).join("") || "没有匹配的章节"}</div>`;
}
