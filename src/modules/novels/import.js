import { InputError } from "../../shared/content.js";

// Leave room for D1's row and bound-value limits, including Chinese text.
export const maxChapterLength = 120000;
const heading = /^(?:(?:正文[\s　]+)?第[零〇一二两三四五六七八九十百千万亿\d０-９]+[章节回卷部篇集].*|(?:序章|楔子|序言|前言|引子|尾声|尾聲|后记|後記|番外)(?:$|[\s　：:（(·—\-一二三四五六七八九十\d].*)|chapter\s+(?:\d+|[ivxlcdm]+)\b.*)$/iu;

export function decodeBook(bytes) {
  let encodings = ["utf-8", "gb18030"];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encodings = ["utf-16le"];
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encodings = ["utf-16be"];
  for (const encoding of encodings) {
    try {
      const result = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (result.includes("\0")) break;
      return result;
    } catch { /* Try the next recognized text encoding. */ }
  }
  throw new InputError("无法识别 TXT 编码，请另存为 UTF-8 后导入");
}

export function splitChapters(source) {
  const chapters = [];
  let title = "正文", lines = [], size = 0, part = 1, explicit = false;
  function flush() {
    chapters.push({ number: chapters.length + 1, title: part === 1 ? title : title + "（续 " + part + "）", body: lines.join("\n") });
    lines = []; size = 0; part++;
  }
  for (const raw of source.split(/\r\n?|\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line.length <= 100 && heading.test(line)) {
      if (lines.length || explicit) flush();
      title = line; part = 1; explicit = true;
      continue;
    }
    while (line.length > maxChapterLength) {
      if (lines.length) flush();
      let end = maxChapterLength;
      if (/[\uD800-\uDBFF]/.test(line[end - 1])) end--;
      lines.push(line.slice(0, end)); flush(); line = line.slice(end);
    }
    if (size + line.length + 1 > maxChapterLength && lines.length) flush();
    lines.push(line); size += line.length + 1;
  }
  if (lines.length || explicit) flush();
  if (!chapters.length) throw new InputError("TXT 没有可导入的正文");
  return chapters;
}

export function chapterInserts(db, id, chapters) {
  const statements = [];
  let buffer = [], size = 0;
  function flush() {
    statements.push(db.prepare(`INSERT INTO chapters(book_id,number,title,body)
      SELECT ?, value->>'number', value->>'title', value->>'body' FROM json_each(?)`)
      .bind(id, "[" + buffer.join(",") + "]"));
    buffer = []; size = 0;
  }
  for (const chapter of chapters) {
    const json = JSON.stringify(chapter);
    if (size + json.length > 400000 && buffer.length) flush();
    buffer.push(json); size += json.length + 1;
  }
  if (buffer.length) flush();
  return statements;
}
