import { adminPage, pageError } from "../../app/views.js";
import { assetPath, empty, field, h, InputError, isId, readForm, saveBar } from "../../shared/content.js";
import { saved } from "../../shared/http.js";
import { directory, directoryView } from "./toc.js";
import { chapterInserts, decodeBook, maxChapterLength, splitChapters } from "./import.js";

const base = "/admin/novels";
const shelfBack = [base, "小说管理"];

async function importBook(ctx, id) {
  const existing = await ctx.db.prepare("SELECT id FROM books WHERE id=?").bind(id).first();
  if (existing) return saved(ctx, base + "/" + id);
  const form = await readForm(ctx.request);
  let title = field(form, "title", "书名", 200, false), source = null, chapters = [];
  const file = form.get("file");
  if (file && typeof file !== "string" && file.name) {
    if (!file.size) throw new InputError("TXT 没有可导入的正文");
    if (!/\.txt$/i.test(file.name) || file.size > 16 * 1024 * 1024) throw new InputError("请选择 16 MB 以内的 TXT 文件");
    const filename = file.name.split(/[\\/]/).at(-1).replace(/[\x00-\x1f\x7f]/g, "").slice(-200) || "原文.txt";
    title ||= filename.replace(/\.txt$/i, "");
    chapters = splitChapters(decodeBook(new Uint8Array(await file.arrayBuffer())));
    source = "books/" + id + "/" + crypto.randomUUID() + "/" + filename;
  }
  if (!title) throw new InputError("请填写书名，或选择 TXT 原件");
  if (source) await ctx.bucket.put(source, file.stream(), { httpMetadata: { contentType: "text/plain" } });
  try {
    await ctx.db.batch([ctx.db.prepare("INSERT INTO books(id,title,source_key) VALUES(?,?,?)").bind(id, title, source),
      ...chapterInserts(ctx.db, id, chapters)]);
  } catch (error) {
    // A replay of the same import can finish first. Its complete book is already visible.
    if (!await ctx.db.prepare("SELECT id FROM books WHERE id=?").bind(id).first()) throw error;
  }
  return saved(ctx, base + "/" + id);
}

async function manageBook(ctx, book) {
  const url = base + "/" + book.id;
  if (!ctx.read) {
    const title = field(await readForm(ctx.request), "title", "书名", 200);
    await ctx.db.prepare("UPDATE books SET title=? WHERE id=?").bind(title, book.id).run();
    return saved(ctx, url);
  }
  const list = await directory(ctx.db,book.id,ctx.url.searchParams);
  const original = book.source_key ? `<a class="text-link" href="${h(assetPath(book.source_key))}">下载原 TXT</a>` : "";
  const body = `<form class="editor" data-editor method="post" action="${url}"><label>书名<input name="title" required maxlength="200" value="${h(book.title)}"></label>${saveBar("保存书名")}</form>
    <div class="section-bar"><h2>章节</h2><a class="text-link" href="${url}/chapters/new">新增章节</a></div>
    ${directoryView(list,url,true)}`;
  return adminPage(ctx, book.title, body, { back: shelfBack, tools: original });
}

async function editChapter(ctx, book, key) {
  const fresh = key === "new", url = base + "/" + book.id;
  if (!fresh && !/^[1-9]\d{0,8}$/.test(key)) return pageError("找不到章节", 404);
  const row = fresh ? { title: "", body: "" } : await ctx.db.prepare("SELECT title,body FROM chapters WHERE book_id=? AND number=?")
    .bind(book.id, Number(key)).first();
  if (!row) return pageError("找不到章节", 404);
  if (!ctx.read) {
    const form = await readForm(ctx.request);
    const title = field(form, "title", "章节名", 200);
    const body = field(form, "body", "正文", maxChapterLength).replace(/\r\n?/g, "\n");
    if (fresh) {
      const token = form.get("creation_key");
      if (!isId(token)) throw new InputError("请重新打开章节编辑页");
      await ctx.db.prepare(`INSERT INTO chapters(book_id,number,title,body,creation_key)
        SELECT ?1,coalesce(max(number),0)+1,?2,?3,?4 FROM chapters WHERE book_id=?1
        ON CONFLICT(book_id,creation_key) DO NOTHING`).bind(book.id, title, body, token).run();
    } else {
      await ctx.db.prepare("UPDATE chapters SET title=?,body=? WHERE book_id=? AND number=?").bind(title, body, book.id, Number(key)).run();
    }
    return saved(ctx, url);
  }
  const form = `<form class="editor" data-editor method="post" action="${url}/chapters/${key}">
    ${fresh ? `<input type="hidden" name="creation_key" value="${crypto.randomUUID()}">` : ""}
    <label>章节名<input name="title" required maxlength="200" value="${h(row.title)}"></label>
    <label>正文<textarea name="body" required rows="16" maxlength="${maxChapterLength}">${h(row.body)}</textarea></label>${saveBar("保存章节")}</form>`;
  return adminPage(ctx, fresh ? "新增章节" : "编辑章节", form, { back: [url, book.title] });
}

export async function manage(ctx, rest) {
  if (!rest && ctx.read) {
    const { results } = await ctx.db.prepare("SELECT id,title FROM books ORDER BY created_at DESC,rowid DESC").all();
    return adminPage(ctx, "小说", '<div class="entry-list">' + (results.map(book =>
      `<a href="${base}/${book.id}">${h(book.title)}</a>`).join("") || empty("书架还是空的")) + "</div>",
      { tools: `<a class="subtle" href="${base}/new">添加书籍</a>` });
  }
  if (rest === "new" && ctx.read) {
    const body = `<form class="editor" data-editor method="post" enctype="multipart/form-data" action="${base}/${crypto.randomUUID()}/import">
      <label>书名<input name="title" maxlength="200" placeholder="可沿用 TXT 文件名"></label>
      <label>TXT 原件<input type="file" name="file" accept=".txt,text/plain"></label>${saveBar("保存书籍")}</form>`;
    return adminPage(ctx, "添加书籍", body, { back: shelfBack });
  }
  const [id, action, key, extra] = rest.split("/");
  if (!isId(id) || extra !== undefined) return pageError("找不到此页", 404);
  if (action === "import" && !key && !ctx.read) return importBook(ctx, id);
  const book = await ctx.db.prepare("SELECT * FROM books WHERE id=?").bind(id).first();
  if (!book) return pageError("找不到这本书", 404);
  if (!action) return manageBook(ctx, book);
  if (action === "chapters" && key) return editChapter(ctx, book, key);
  return pageError("找不到此页", 404);
}
