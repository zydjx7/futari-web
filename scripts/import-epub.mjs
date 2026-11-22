import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { readEpub } from "./epub-content.mjs";

const root = fileURLToPath(new URL("../",import.meta.url));
const lit = text => "'" + text.replaceAll("'","''") + "'";
const limit = 80000;

function statements(table, chapter) {
  const { number, title, body } = chapter;
  const insert = `INSERT INTO ${table}(number,title,body) VALUES(${number},${lit(title)},`;
  const append = `UPDATE ${table} SET body=body||`;
  const end = ` WHERE number=${number};`;
  if (body.includes("\0") || title.includes("\0")) throw new Error("章节含有空字符");
  if (Buffer.byteLength(insert + lit(body) + ");") < limit) return [insert + lit(body) + ");"];
  const result = [];
  let part = "", bytes = 0;
  function flush() {
    result.push(result.length ? append + lit(part) + end : insert + lit(part) + ");");
    part = ""; bytes = 0;
  }
  for (const ch of body) {
    const size = ch === "'" ? 2 : Buffer.byteLength(ch);
    if (bytes + size > 72000) flush();
    part += ch; bytes += size;
  }
  if (part) flush();
  return result;
}

async function main() {
  const {values,positionals} = parseArgs({ allowPositionals:true, options:{title:{type:"string"},local:{type:"boolean"},remote:{type:"boolean"}} });
  if (positionals.length !== 1 || (values.local && values.remote)) throw new Error("用法：node scripts/import-epub.mjs 文件.epub [--title 书名] [--local | --remote]");
  const book = readEpub(await readFile(positionals[0]));
  const title = (values.title ?? book.title).trim();
  if (!title || title.length > 200) throw new Error("请提供 1–200 字的书名");
  const tmp = await mkdtemp(join(tmpdir(),"futari-epub-sql-"));
  const stage = "epub_" + randomUUID().replaceAll("-","");
  const file = join(tmp,"batch.sql");
  const args = ["node_modules/wrangler/bin/wrangler.js","d1","execute","DB","--json",...(values.remote ? ["--env","production","--remote"] : ["--local"])];
  function call(extra) {
    const proc = spawnSync(process.execPath,[...args,...extra],{cwd:root,encoding:"utf8",maxBuffer:16*1024*1024});
    if (proc.error) throw proc.error;
    const stdout = proc.stdout || "";
    if (proc.status !== 0) throw new Error("D1 导入失败：" + (stdout || proc.stderr).trim().slice(-600));
    for (const match of stdout.matchAll(/^\s*\[/gm)) {
      try { const r = JSON.parse(stdout.slice(match.index)); if (r.every(x => x.success)) return r; } catch { /* Upload progress can precede JSON. */ }
    }
    throw new Error("无法确认 D1 执行结果");
  }
  const query = sql => call(["--command",sql])[0].results;
  async function run(sql) {
    if (sql.some(s=>Buffer.byteLength(s)>=limit)) throw new Error("SQL 超出导入窗口");
    await writeFile(file,sql.join("\n"),"utf8");
    return call(["--file",file,"--yes"]);
  }
  let created = false;
  try {
    const matches = query(`SELECT id FROM books WHERE title=${lit(title)} LIMIT 2`);
    if (matches.length > 1) throw new Error("有多本同名书，请先区分书名");
    // Concurrent first imports of the same title converge on the same book.
    const key = createHash("sha256").update("FUTARI EPUB\0"+title).digest("hex");
    const id = matches[0]?.id || [key.slice(0,8),key.slice(8,12),"5"+key.slice(13,16),"a"+key.slice(17,20),key.slice(20,32)].join("-");
    const bid = lit(id), chapters = book.chapters;
    await run([`CREATE TABLE ${stage}(number INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL) STRICT;`]);
    created=true;
    for (let i=0;i<chapters.length;i+=30) {
      const batch=chapters.slice(i,i+30);
      await run(batch.flatMap(c=>statements(stage,c)));
      if ((i/30)%15===0 || i+30>=chapters.length) console.log(`${title} · ${Math.min(i+30,chapters.length)} / ${chapters.length}`);
    }
    // One D1 file transaction publishes the verified stage. A retry never exposes half a book.
    const guard = stage+"_check";
    const stale = `NOT EXISTS(SELECT 1 FROM ${stage} s WHERE s.number=chapters.number)`;
    const publish = [`CREATE TABLE ${guard}(ok INTEGER CHECK(ok=1)) STRICT;`,
      `INSERT INTO ${guard} SELECT count(*)=${chapters.length} FROM ${stage};`,
      `INSERT INTO ${guard} SELECT NOT EXISTS(SELECT 1 FROM book_notes n JOIN chapters c ON c.book_id=n.book_id AND c.number=n.chapter LEFT JOIN ${stage} s ON s.number=n.chapter WHERE n.book_id=${bid} AND (s.number IS NULL OR s.body<>c.body));`,
      `INSERT INTO books(id,title) VALUES(${bid},${lit(title)}) ON CONFLICT(id) DO UPDATE SET title=excluded.title,source_key=NULL;`];
    for(let i=0;i<chapters.length;i+=30) {
      const batch=chapters.slice(i,i+30);
      publish.push(`INSERT INTO chapters(book_id,number,title,body) SELECT ${bid},number,title,body FROM ${stage} WHERE number BETWEEN ${batch[0].number} AND ${batch.at(-1).number} ON CONFLICT(book_id,number) DO UPDATE SET title=excluded.title,body=excluded.body WHERE chapters.title<>excluded.title OR chapters.body<>excluded.body;`);
    }
    publish.push(
      `UPDATE reading_progress SET chapter=coalesce((SELECT min(number) FROM ${stage} WHERE number>=reading_progress.chapter),(SELECT max(number) FROM ${stage})),paragraph=0,char_offset=0,revision=revision+1 WHERE book_id=${bid} AND chapter NOT IN(SELECT number FROM ${stage});`,
      `DELETE FROM chapter_read_starts WHERE book_id=${bid} AND chapter NOT IN(SELECT number FROM ${stage});`,
      `DELETE FROM chapters WHERE book_id=${bid} AND ${stale};`,
      `DELETE FROM book_reading_links WHERE book_id=${bid};`,
      `INSERT INTO ${guard} SELECT NOT EXISTS(SELECT 1 FROM ${stage} s LEFT JOIN chapters c ON c.book_id=${bid} AND c.number=s.number WHERE c.number IS NULL OR c.title<>s.title OR c.body<>s.body);`,
      `DROP TABLE ${guard};`);
    await run(publish);
    console.log(`${values.remote?"production":"local"} · ${title} · ${chapters.length} 个正文条目 · 合并或略过 ${book.skipped} 个卷页/空项 · ${id}`);
  } finally {
    try { if (created) query(`DROP TABLE IF EXISTS ${stage}`); }
    finally { await rm(tmp,{recursive:true,force:true}); }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
