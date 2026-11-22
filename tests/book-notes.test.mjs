import { before,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, origin, request, setup, signIn, secrets } from "./support.mjs";

let her,admin;
const book=randomUUID(), base="/novels/"+book, notes="/api"+base+"/notes";
before(async()=>{
  await setup(); her=await signIn(secrets.PASSCODE_HER);admin=await signIn(secrets.PASSCODE_ADMIN);
  await db.prepare("INSERT INTO books(id,title) VALUES(?,'长篇')").bind(book).run();
  await db.prepare(`WITH RECURSIVE s(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM s WHERE i<350)
    INSERT INTO chapters(book_id,number,title,body) SELECT ?,i*2,'篇章 '||i,'青山依旧。'||char(10)||'天空放晴。' FROM s`).bind(book).run();
});
const get=(path,headers=her)=>request(path,{headers});
const post=(path,body,headers=her,from=origin)=>request(path,{method:"POST",headers:{...headers,Origin:from,Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(body)});
const count=async hdr=>(await (await get("/api/messages/count",hdr)).json()).unread;

test("长书只渲染邻章，稀疏编号的目录定位、搜索、管理分页和只读索引",async()=>{
  const raw=await (await get(base+"?chapter=402")).text();
  assert.match(raw,/篇章 200/);assert.match(raw,/篇章 202/);assert.doesNotMatch(raw,/篇章 350/);
  assert.ok(Buffer.byteLength(raw)<20000);
  const page=await (await get(base+"/toc?size=400&around=402")).json();
  assert.equal(page.size,100);assert.equal(page.page,3);assert.equal(page.total,350);assert.equal(page.items.length,100);assert.equal(page.items[0].number,402);
  assert.equal((await (await get(base+"/toc?q=700")).json()).items[0].title,"篇章 350");
  assert.equal((await (await get(base+"/toc?q="+encodeURIComponent("篇章 349"))).json()).total,1);
  const editor=await (await get("/admin"+base+"?page=4",admin)).text();
  assert.match(editor,/篇章 350/);assert.doesNotMatch(editor,/篇章 101/);
  assert.match(await (await get(base+"/toc?view=html&page=2")).text(),/篇章 101/);
  assert.notEqual((await request(base+"/toc")).status,200);
  const plan=await db.prepare("EXPLAIN QUERY PLAN SELECT number,title FROM chapters INDEXED BY chapters_toc WHERE book_id=? AND number>? ORDER BY number LIMIT 1").bind(book,400).all();
  assert.match(plan.results.map(x=>x.detail).join(" "),/COVERING INDEX chapters_toc/);
  assert.equal(await db.prepare("SELECT total FROM book_chapter_counts WHERE book_id=?").bind(book).first("total"),350);
});

test("双角色评论和回复、作者权限、幂等、按段/单条/全部已读与消息直达",async()=>{
  const write={id:randomUUID(),chapter:2,paragraph:0,quote:"青山",body:"一起读到这里。"};
  assert.equal((await post(notes,write,her,"https://invalid.test")).status,403);
  assert.equal((await post(notes,{...write,paragraph:2})).status,422);
  assert.equal((await post(notes,{...write,quote:"别处的句子"})).status,422);
  assert.equal((await post(notes,{...write,body:"字".repeat(1001)})).status,422);
  assert.equal((await post(notes,write)).status,201);assert.equal((await post(notes,write)).status,200);
  assert.equal(await count(admin),1);assert.equal(await count(her),0);
  const menu=await (await get("/menu",admin)).text();
  assert.match(menu,/消息，1 条未读/);
  const msg=await (await get("/messages",admin)).text();
  assert.match(msg,/她评论了这一段/);assert.match(msg,/青山/);assert.doesNotMatch(msg,/<canvas|<audio|<video|小信箱|小橡果|金币|钱包|\/app\/rabbit\//);
  assert.equal((await post(notes+"/"+write.id+"/delete",{},admin)).status,403);
  const reply={chapter:2,paragraph:0,parent_id:write.id,body:"我也读到了。"};
  assert.equal((await post(notes,{...reply,paragraph:1},admin)).status,422);
  const answer=await (await post(notes,reply,admin)).json();
  assert.equal((await post(notes,{...reply,parent_id:answer.id})).status,422);
  assert.equal((await (await post("/api/messages/read",{id:write.id,open:1},admin)).json()).location,base+"?chapter=2#note-p-0");
  assert.equal(await count(admin),0);assert.equal(await count(her),1);
  const herPage=await (await get("/messages",her)).text();
  assert.match(herPage,/他回复了你/);assert.match(herPage,/青山依旧/);
  assert.equal((await (await post("/api/messages/read",{book_id:book,chapter:2,paragraph:0})).json()).unread,0);
  assert.equal((await (await get(notes+"?chapter=2&paragraph=0",admin)).json()).notes.length,2);
  const first=await (await post(notes,{chapter:2,paragraph:1,body:"另一段"})).json();
  const displayed=(await (await get(notes+"?chapter=2&paragraph=1",admin)).json()).notes;
  assert.equal(displayed[0].id,first.id);assert.equal(displayed[0].unread,1);
  await post(notes,{chapter:2,paragraph:1,body:"刚刚又收到的一条"});
  assert.equal((await (await post("/api/messages/read",{book_id:book,chapter:2,paragraph:1,ids:[first.id]},admin)).json()).unread,1);
  assert.equal((await (await post("/api/messages/read",{all:1},admin)).json()).unread,0);
  assert.equal((await post(notes+"/"+write.id+"/delete",{})).status,200);
  assert.equal((await (await get(notes+"?chapter=2&paragraph=0")).json()).notes.length,0);
});

