import { posix } from "node:path";
import { unzipSync } from "fflate";
import { load } from "cheerio/slim";
import { maxChapterLength } from "../src/modules/novels/import.js";

const tag = node => (node.name || "").split(":").at(-1).toLowerCase();
function named(doc,name) {
  const usual=doc(name);
  return usual.length ? usual : doc("*").filter((_,n)=>tag(n)===name.toLowerCase());
}
const childrenNamed = (nodes,name) => nodes.children().filter((_,n)=>tag(n)===name);
const clean = s => s.replace(/\uFEFF/g, "").trim();
const blocks = new Set("body div section article header footer aside p h1 h2 h3 h4 h5 h6 blockquote li dt dd tr figcaption pre".split(" "));
const omitted = new Set(["script","style","nav","noscript","svg","head","rt"]);
const cn = "零〇一二两三四五六七八九十百千万0-9";
const volume = new RegExp("^第[" + cn + "]+卷(?:$|[　 ：:])");
const appendix = new RegExp("^(?:最终章第[" + cn + "]+[节章]|番外篇第[" + cn + "]+章)");
function resolve(base, href) {
  const [file, fragment = ""] = href.split("#");
  return [file ? posix.normalize(posix.join(posix.dirname(base), decodeURIComponent(file))) : base, decodeURIComponent(fragment)];
}
function parse(bytes, xml) {
  const head = new TextDecoder().decode(bytes.subarray(0, 240));
  const enc = head.match(/encoding=["']([^"']+)/i)?.[1] || "utf-8";
  return load(new TextDecoder(enc).decode(bytes), { xml: { xmlMode: xml, decodeEntities: true } });
}
function splitLong(lines) {
  const out = [];
  let buf = [], n = 0;
  function flush() { if (buf.length) out.push(buf.join("\n")); buf = []; n = 0; }
  for (let line of lines) {
    if (n + line.length + 1 > maxChapterLength) flush();
    while (line.length > maxChapterLength) {
      let end = maxChapterLength;
      if (/[\uD800-\uDBFF]/.test(line[end-1])) end--;
      out.push(line.slice(0,end)); line = line.slice(end);
    }
    buf.push(line); n += line.length + 1;
  }
  flush(); return out;
}

export function readEpub(input) {
  const zip = unzipSync(input);
  function doc(path, xml = true) {
    if (!zip[path]) throw new Error("EPUB 缺少文件：" + path);
    return parse(zip[path], xml);
  }
  const container = doc("META-INF/container.xml");
  const opf = named(container,"rootfile").first().attr("full-path"), $ = doc(opf);
  const title = clean(named($,"metadata").find("*").filter((_,n) => tag(n) === "title").first().text());
  const manifest = new Map(childrenNamed(named($,"manifest"),"item").toArray().map(node => [node.attribs.id, {
    path: resolve(opf,node.attribs.href)[0], type: node.attribs["media-type"], properties: (node.attribs.properties || "").split(/\s+/)
  }]));
  const spineNode=named($,"spine");
  const spine = childrenNamed(spineNode,"itemref").toArray().map(n => manifest.get(n.attribs.idref)?.path);
  const spineFiles = new Set(spine);
  const nav = [...manifest.values()].find(item => item.properties.includes("nav"));
  const ncx = manifest.get(spineNode.attr("toc")) || [...manifest.values()].find(item => item.type === "application/x-dtbncx+xml");
  const toc = new Map();
  function entry(base, href, label) {
    if (!href || !clean(label) || /^[a-z]+:/i.test(href)) return;
    const [path,id] = resolve(base,href);
    if (!spineFiles.has(path)) return;
    if (!toc.has(path)) toc.set(path,new Map());
    if (!toc.get(path).has(id)) toc.get(path).set(id,clean(label));
  }
  if (nav) {
    const navDoc = doc(nav.path,false);
    const navs = named(navDoc,"nav").toArray();
    const primary = navs.find(n => (n.attribs["epub:type"] || "").split(/\s+/).includes("toc") || n.attribs.role === "doc-toc") || navs[0];
    if (primary) navDoc(primary).find("[href]").filter((_,n)=>tag(n)==="a").each((_,a) => entry(nav.path,a.attribs.href,navDoc(a).text()));
  }
  if (!toc.size && ncx) {
    const index = doc(ncx.path);
    named(index,"navPoint").each((_,p) => entry(ncx.path,childrenNamed(index(p),"content").attr("src"),childrenNamed(index(p),"navlabel").text()));
  }
  const chapters = [];
  let current, ordinal = 0, skipped = 0, prefix = "";
  function finish() {
    if (!current) return;
    const { title: name, lines } = current;
    if (volume.test(name) && lines.length <= 1 && (lines[0]?.length || 0) <= 32) {
      prefix = [name,...lines].join(" · "); skipped++; return;
    }
    if (!lines.length) { skipped++; return; }
    const heading = [prefix,name].filter(Boolean).join(" · ");
    prefix = "";
    for (const [i,body] of splitLong(lines).entries()) {
      if (i) ordinal++;
      chapters.push({ number: ordinal, title: heading + (i ? `（续 ${i+1}）` : ""), body });
    }
  }
  function start(name) { finish(); ordinal++; current = { title:name, lines:[] }; }
  for (const path of spine) {
    if (!path || path === nav?.path || path === ncx?.path) continue;
    const html = doc(path,false), body = named(html,"body").first();
    if (!body.length || !clean(body.text())) continue;
    const children = body.children().toArray();
    if (children.length && children.every(n => (n.attribs.class || "").includes("sgc-toc-"))) continue;
    const anchors = toc.get(path) || new Map(), seen = new Set();
    const boundary = id => { if (anchors.has(id) && !seen.has(id)) { seen.add(id); start(anchors.get(id)); } };
    boundary("");
    let buffer = "";
    function flush() {
      const line = clean(buffer); buffer = "";
      if (!line) return;
      if (!current) start("正文");
      if (!current.lines.length && current.title === line) return;
      if (current.lines.length && line.length <= 80 && appendix.test(line)) start(line);
      else current.lines.push(line);
    }
    function visit(node) {
      if (node.type === "text") { buffer += node.data.replace(/[\r\n\t]+/g," "); return; }
      const name = tag(node);
      if (!name || omitted.has(name) || node.attribs.hidden !== undefined) return;
      const id = node.attribs.id || node.attribs.name;
      if (blocks.has(name) || name === "br" || anchors.has(id)) flush();
      if (id) boundary(id);
      if (!toc.size && /^h[1-3]$/.test(name)) {
        const heading = clean(html(node).text());
        if (heading) start(heading);
      }
      for (const child of node.children || []) visit(child);
      if (blocks.has(name)) flush();
    }
    visit(body[0]); flush();
    if (seen.size !== anchors.size) throw new Error("目录锚点不存在：" + path);
  }
  finish();
  if (!chapters.length) throw new Error("EPUB 没有可导入的正文");
  return { title, chapters, skipped };
}
