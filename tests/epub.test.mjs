import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync,unzipSync,strFromU8,strToU8 } from "fflate";
import { readEpub } from "../scripts/epub-content.mjs";
import { maxChapterLength } from "../src/modules/novels/import.js";
function fixture(version) {
  const names=["nav.xhtml","toc.ncx","a.xhtml","b.xhtml","c.xhtml","cover.xhtml"];
  const entries=Object.fromEntries(names.map((n,i)=>[n,`<item id="i${i}" href="${n}" media-type="${i===1?"application/x-dtbncx+xml":"application/xhtml+xml"}" ${!i && version===3?'properties="nav"':""}/>`]));
  const files={"META-INF/container.xml":'<container><rootfiles><rootfile full-path="E/content.opf"/></rootfiles></container>',
    "E/content.opf":`<package><metadata><dc:title>样书</dc:title></metadata><manifest>${Object.values(entries).join("")}</manifest><spine toc="i1">${[5,2,3,4].map(i=>`<itemref idref="i${i}"/>`).join("")}</spine></package>`,
    "E/nav.xhtml":'<html><body><nav epub:type="toc"><ol><li><a href="a.xhtml#a">开篇</a></li><li><a href="b.xhtml#b">后篇</a></li></ol></nav></body></html>',
    "E/toc.ncx":'<ncx><navMap><navPoint><navLabel><text>开篇</text></navLabel><content src="a.xhtml#a"/></navPoint><navPoint><navLabel><text>后篇</text></navLabel><content src="b.xhtml#b"/></navPoint></navMap></ncx>',
    "E/cover.xhtml":'<html><body><img src="cover.png"/></body></html>',"E/a.xhtml":'<html><body><h1 id="a">开篇</h1><p>山&amp;海</p></body></html>',
    "E/b.xhtml":'<html><body><p>仍在第一章。</p><h2 id="b">后篇</h2><p>第二章<br/>下一段</p></body></html>',
    "E/c.xhtml":'<html><body><p>'+ '果'.repeat(maxChapterLength+3) +'</p></body></html>'};
  return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])));
}
for(const version of [2,3])test("EPUB"+version+" 按锚点与书脊合并，解码实体，长段完整续分",()=>{
  const b=readEpub(fixture(version));assert.equal(b.title,"样书");assert.equal(b.chapters[0].body,"山&海\n仍在第一章。");
  assert.equal(b.chapters[1].title,"后篇");
  assert.equal(b.chapters.slice(1).map(c=>c.body).join(""),"第二章\n下一段"+"果".repeat(maxChapterLength+3));
  assert.ok(b.chapters.every(c=>c.body.length<=maxChapterLength && c.body.length));
});

test("显式命名空间前缀的 OPF、NCX 和 EPUB3 导航可定位同一段正文",()=>{
  for(const version of [2,3]) {
    const files=unzipSync(fixture(version));
    for(const [path,bytes] of Object.entries(files)) {
      const source=strFromU8(bytes);
      const prefixed=source.replace(/(<\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/g,"$1e:$2");
      files[path]=strToU8(prefixed);
    }
    const parsed=readEpub(zipSync(files));
    assert.equal(parsed.title,"样书");
    assert.deepEqual(parsed.chapters.slice(0,2).map(c=>c.title),["开篇","后篇"]);
    assert.equal(parsed.chapters[0].body,"山&海\n仍在第一章。");
  }
});

