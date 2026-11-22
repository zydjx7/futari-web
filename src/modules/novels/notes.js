import { InputError, isId, readForm } from "../../shared/content.js";
import { plain } from "../../shared/http.js";
import { paragraphs } from "./paragraphs.js";
import { unreadCount } from "../messages/state.js";

export function indexValue(raw, min = 0) {
  if (!/^(0|[1-9]\d{0,8})$/.test(String(raw ?? "")) || Number(raw)<min) throw new InputError("章节或段落位置无效");
  return Number(raw);
}
async function fields(request) {
  if ((request.headers.get("Content-Type") || "").includes("application/json")) {
    let data; try { data = await request.json(); } catch { throw new InputError("无效的数据"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new InputError("无效的数据");
    return data;
  }
  return Object.fromEntries(await readForm(request,16384));
}
export { fields as noteFields };
function text(value, max, required) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new InputError("请输入文字");
  const s=value.trim();
  if ((required && !s) || [...s].length>max) throw new InputError("字数不符合要求");
  return s;
}

export async function notesAPI(ctx, id, noteId, action) {
  if (!isId(id)) return plain("找不到书",404);
  if (action === "delete" && isId(noteId) && !ctx.read) {
    const row = await ctx.db.prepare("SELECT author FROM book_notes WHERE id=? AND book_id=?").bind(noteId,id).first();
    if (!row) return plain("找不到评论",404);
    if (row.author!==ctx.role) return plain("只能删除自己的评论",403);
    await ctx.db.prepare("DELETE FROM book_notes WHERE id=? AND book_id=? AND author=?").bind(noteId,id,ctx.role).run();
    return Response.json({ok:true,unread:await unreadCount(ctx)});
  }
  if (noteId || action) return plain("找不到此页",404);
  if (ctx.read) {
    const chapter=indexValue(ctx.url.searchParams.get("chapter"),1);
    const args=[id,chapter];
    if (!await ctx.db.prepare("SELECT 1 FROM chapters INDEXED BY chapters_toc WHERE book_id=? AND number=?").bind(...args).first()) return plain("找不到章节",404);
    if (ctx.url.searchParams.get("counts")==="1") {
      const {results:counts}=await ctx.db.prepare("SELECT paragraph,count(*) AS n FROM book_notes WHERE book_id=? AND chapter=? GROUP BY paragraph").bind(...args).all();
      return Response.json({counts});
    }
    const byParagraph=ctx.url.searchParams.has("paragraph");
    if(byParagraph) args.push(indexValue(ctx.url.searchParams.get("paragraph")));
    const {results:notes}=await ctx.db.prepare("SELECT n.id,n.parent_id,n.paragraph,n.author,n.quote,n.body,n.created_at,"+
      "(n.author <> ? AND NOT EXISTS(SELECT 1 FROM book_note_reads r WHERE r.member=? AND r.note_id=n.id)) AS unread "+
      "FROM book_notes n WHERE n.book_id=? AND n.chapter=?"+(byParagraph?" AND n.paragraph=?":"")+" ORDER BY n.created_at,n.rowid")
      .bind(ctx.role,ctx.role,...args).all();
    return Response.json({notes,member:ctx.role});
  }
  const data=await fields(ctx.request);
  const chapter=indexValue(data.chapter,1), paragraph=indexValue(data.paragraph);
  const quote=text(data.quote,300,false), body=text(data.body,1000,true);
  const parent=data.parent_id || null, key=data.id || crypto.randomUUID();
  if ((parent && !isId(parent)) || !isId(key)) throw new InputError("评论编号无效");
  const row=await ctx.db.prepare("SELECT body FROM chapters WHERE book_id=? AND number=?").bind(id,chapter).first();
  if(!row) return plain("找不到章节",404);
  const line=paragraphs(row.body)[paragraph];
  if(line===undefined || (quote && !line.includes(quote))) throw new InputError("引文或段落已变化，请重新选择");
  const result=await ctx.db.prepare(`INSERT INTO book_notes(id,book_id,chapter,paragraph,quote,parent_id,author,body)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE ?6 IS NULL OR EXISTS
    (SELECT 1 FROM book_notes WHERE id=?6 AND book_id=?2 AND chapter=?3 AND paragraph=?4 AND parent_id IS NULL)
    ON CONFLICT(id) DO NOTHING RETURNING id`).bind(key,id,chapter,paragraph,quote,parent,ctx.role,body).first();
  if(!result) {
    const same=await ctx.db.prepare("SELECT 1 FROM book_notes WHERE id=? AND book_id=? AND chapter=? AND paragraph=? AND quote=? AND parent_id IS ? AND author=? AND body=?")
      .bind(key,id,chapter,paragraph,quote,parent,ctx.role,body).first();
    if(!same) throw new InputError("回复的主评论无效或已被删除");
  }
  return Response.json({id:key},{status:result?201:200});
}

export function notesPanel() {
  return `<button type="button" class="quote-note" data-quote-note hidden>写评论</button>
    <dialog class="notes-drawer" aria-labelledby="notes-title"><header><div><small data-note-location></small><h2 id="notes-title">段落评论</h2></div>
    <button type="button" class="subtle" data-note-close aria-label="收起评论">×</button></header>
    <div class="note-thread" data-note-thread></div><form data-note-form><blockquote data-note-quote hidden></blockquote>
    <div data-reply-to hidden></div><label><span class="sr-only">评论正文</span><textarea name="body" required maxlength="1000" rows="3" placeholder="写下此刻的想法"></textarea></label>
    <footer><button type="button" class="subtle" data-note-cancel hidden>取消回复</button><button class="primary">发表</button></footer>
    <output data-note-error role="status"></output></form></dialog>`;
}
