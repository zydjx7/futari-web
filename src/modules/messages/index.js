import { shell } from "../../app/views.js";
import { h, empty, isId, InputError } from "../../shared/content.js";
import { plain, redirect } from "../../shared/http.js";
import { paragraphs } from "../novels/paragraphs.js";
import { indexValue, noteFields } from "../novels/notes.js";
import { other, who, unreadCondition, unreadCount, noteURL } from "./state.js";

export async function readMessages(ctx) {
  const data = await noteFields(ctx.request);
  const args=[ctx.role,other(ctx.role)];
  let condition, target;
  if (data.id || data.note_id) {
    const id = data.id || data.note_id;
    if (!isId(id)) throw new InputError("消息编号无效");
    target=await ctx.db.prepare("SELECT book_id,chapter,paragraph FROM book_notes WHERE id=? AND author=?").bind(id,other(ctx.role)).first();
    if (!target) return plain("找不到消息",404);
    condition=" AND id=?";args.push(id);
  } else if (data.book_id) {
    if(!isId(data.book_id)) throw new InputError("书籍编号无效");
    condition=" AND book_id=? AND chapter=? AND paragraph=?";
    args.push(data.book_id,indexValue(data.chapter,1),indexValue(data.paragraph));
    if (data.ids !== undefined) {
      if (!Array.isArray(data.ids) || data.ids.length>200 || !data.ids.every(isId)) throw new InputError("消息编号无效");
      condition+=" AND id IN (SELECT value FROM json_each(?))";
      args.push(JSON.stringify(data.ids));
    }
  } else if (String(data.all)==="1" || data.all===true) condition="";
  else throw new InputError("请选择要标记的消息");
  await ctx.db.prepare("INSERT OR IGNORE INTO book_note_reads(member,note_id) SELECT ?,id FROM book_notes WHERE author=?"+condition).bind(...args).run();
  const location=target && String(data.open)==="1" ? noteURL(target) : "/messages"+(data.tab==="all"?"?tab=all":"");
  return ctx.request.headers.get("Accept")?.includes("application/json") ? Response.json({unread:await unreadCount(ctx),location}) : redirect(location,303);
}

export async function messagePage(ctx,rest) {
  if(rest || !ctx.read) return plain("找不到此页",404);
  const all=ctx.url.searchParams.get("tab")==="all";
  const page=Math.max(1,Math.min(100000,Number.parseInt(ctx.url.searchParams.get("page"),10)||1)),size=25;
  const {results:rows}=await ctx.db.prepare(`SELECT n.id,n.book_id,n.chapter,n.paragraph,n.parent_id,n.author,n.body,n.quote,n.created_at,
    b.title AS book,c.title AS chapter_title,p.author AS parent_author,${unreadCondition} AS unread
    FROM book_notes n JOIN books b ON b.id=n.book_id JOIN chapters c INDEXED BY chapters_toc ON c.book_id=n.book_id AND c.number=n.chapter
    LEFT JOIN book_notes p ON p.id=n.parent_id WHERE n.author=?1 ${all?"":"AND "+unreadCondition}
    ORDER BY n.created_at DESC,n.id LIMIT ?3 OFFSET ?4`).bind(other(ctx.role),ctx.role,size+1,(page-1)*size).all();
  const more=rows.length>size;
  if(more) rows.pop();
  const missing=new Map();
  for(const n of rows) if(!n.quote) missing.set(n.book_id+"/"+n.chapter,n);
  const keys=[...missing.keys()];
  if(keys.length) {
    const bodies=await ctx.db.batch([...missing.values()].map(n=>ctx.db.prepare("SELECT body FROM chapters WHERE book_id=? AND number=?").bind(n.book_id,n.chapter)));
    keys.forEach((k,i)=>missing.set(k,paragraphs(bodies[i].results[0]?.body || "")));
  }
  const inbox="/messages", tab=all?"all":"unread";
  const cards=rows.map(n=>{
    const excerpt=n.quote || [...(missing.get(n.book_id+"/"+n.chapter)?.[n.paragraph] || "")].slice(0,40).join("");
    const verb=n.parent_id ? n.parent_author===ctx.role?"回复了你":"回复了评论" : "评论了这一段";
    const stamp=new Date(n.created_at*1000).toISOString();
    return `<form action="/api/messages/read" method="post"><input type="hidden" name="id" value="${h(n.id)}"><input type="hidden" name="open" value="1">
      <button class="message-card" type="submit"><span class="msg-top"><strong>${who(n.author,ctx.role)}${verb}</strong>${n.unread?'<i class="unread-dot" aria-label="未读"></i>':""}<time datetime="${stamp}">${stamp.slice(0,10)}</time></span>
      <span class="msg-source">${h(n.book)} · ${h(n.chapter_title)} · 第 ${n.paragraph+1} 段</span>
      <span class="msg-quote">${h(excerpt)}</span><span class="msg-body">${h(n.body)}</span></button></form>`;
  }).join("");
  const paging=(p,label)=>`<a href="${inbox}?tab=${tab}&amp;page=${p}">${label}</a>`;
  return shell(inbox,ctx,{title:"消息",body:`<div class="message-tools"><nav class="filters" aria-label="消息筛选"><a href="/messages"${all?"":' aria-current="page"'}>未读</a><a href="/messages?tab=all"${all?' aria-current="page"':""}>全部</a></nav>
    <form action="/api/messages/read" method="post"><input type="hidden" name="all" value="1"><input type="hidden" name="tab" value="${tab}"><button class="subtle">全部标为已读</button></form></div>
    <div class="message-list">${cards || empty(all?"还没有收到共读消息":"暂时没有未读消息")}</div>
    <nav class="toc-pages">${page>1?paging(page-1,"上一页"):""}${more?paging(page+1,"下一页"):""}</nav>`});
}
