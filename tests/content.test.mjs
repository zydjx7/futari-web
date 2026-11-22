import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, origin, request, secrets, setup, signIn } from "./support.mjs";

let admin, her;
before(async () => {
  await setup();
  admin = await signIn(secrets.PASSCODE_ADMIN);
  her = await signIn(secrets.PASSCODE_HER);
});
const get = (url, headers = her) => request(url, { headers });
async function post(url, body, headers = admin) {
  const wire = new Request(origin, { method: "POST", body: body instanceof FormData ? body : new URLSearchParams(body) });
  return request(url, { method: "POST", headers: { ...headers, Origin: origin, "Content-Type": wire.headers.get("Content-Type") },
    body: await wire.arrayBuffer() });
}
async function text(url, headers) {
  const res = await get(url, headers);
  assert.equal(res.status, 200);
  return res.text();
}
function image(form) {
  form.set("image", new Blob([Uint8Array.of(137,80,78,71,13,10,26,10,0,0)], { type: "image/png" }), "配图.png");
}

test("主厨推荐按周和原文顺序展示，管理员配图仅登录可读", async () => {
  const monday = "2027-03-01", friday = "2027-03-05";
  const first = randomUUID(), second = randomUUID();
  await db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(monday).run();
  const add = db.prepare("INSERT INTO menu_chef_picks(id,week,position,name,station,source_url) VALUES(?,?,?,?,?,?)");
  await db.batch([
    add.bind(second,monday,2,"肉臊油泼面","7F 面馆","https://example.com/menu#second"),
    add.bind(first,monday,1,"清汤牛肉<蘸水菜>","7F 匠鱼先生","https://example.com/menu#first")
  ]);
  const edit = "/admin/menu/chef-photo?day=" + friday;
  const form = new FormData();
  form.set("pick", first);
  image(form);
  assert.equal((await post(edit, form, her)).status, 403);
  assert.equal((await post("/admin/menu/chef-photo?day=2027-03-08", form)).status, 404);
  const missing = new FormData();
  missing.set("pick", first);
  assert.equal((await post(edit, missing)).status, 422);
  const before = await text("/menu?day=" + friday);
  assert.match(before, /本周主厨推荐/);
  assert.ok(before.indexOf("#first") < before.indexOf("#second"));
  assert.match(before, /清汤牛肉&lt;蘸水菜&gt;/);
  assert.match(before, /在飞书看图/);
  const saved = await post(edit, form);
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get("Location"), "/admin/menu?day=" + friday + "#chef-photos");
  const key = await db.prepare("SELECT image_key FROM menu_chef_picks WHERE id=?").bind(first).first("image_key");
  const src = "/api/files/" + key;
  for (const [day, headers] of [[monday,her],[friday,admin]]) {
    const html = await text("/menu?day=" + day, headers);
    assert.ok(html.includes('<img src="' + src + '"'));
    assert.ok(html.includes('href="' + src + '"'));
    assert.match(html, /href="https:\/\/example.com\/menu#second"/);
  }
  assert.equal((await request(src)).status, 401);
  assert.equal((await get(src)).headers.get("Content-Type"), "image/png");
  form.set("preview",new Blob(["RIFF0000WEBP"], { type: "image/webp" }),"small.webp");
  assert.equal((await post(edit,form)).status,303);
  const pair = await db.prepare("SELECT image_key,preview_key FROM menu_chef_picks WHERE id=?").bind(first).first();
  const gallery = await text("/menu?day=" + monday);
  assert.ok(gallery.includes('href="/api/files/' + pair.image_key + '"'));
  assert.ok(gallery.includes('<img src="/api/files/' + pair.preview_key + '"'));
  assert.equal((await get("/api/files/" + pair.preview_key)).headers.get("Content-Type"), "image/webp");
  assert.equal((await request("/api/files/" + pair.preview_key)).status, 401);
  assert.doesNotMatch(await text("/menu?day=2027-03-08"), /<details class="chef-picks"/);
});

test("整周菜单、缺失与零热量、私有附图、点菜重试与批量改菜", async () => {
  const day = "2026-12-31", week = "/admin/menu?day=" + day, id = randomUUID(), second = randomUUID();
  const form = new FormData();
  function dish(key, name, kcal) {
    for (const [k,v] of Object.entries({ id: key, date: day, meal: "午餐", name, kcal })) form.append(k,v);
  }
  dish(id, "山药排骨汤", "320"); dish(second, "清茶", "");
  image(form);
  assert.equal((await post(week, form)).status, 303);
  const menu = "/menu?day=" + day;
  const first = await text(menu);
  assert.match(first, /山药排骨汤/);
  assert.doesNotMatch(first, /当日合计/);
  const src = first.match(/<img src="([^"]+)"/)[1];
  assert.equal((await request(src)).status, 401);
  assert.equal((await get(src)).headers.get("Content-Type"), "image/png");
  for (let i=0;i<2;i++) assert.equal((await post("/menu/want", {id,wanted:"1"}, her)).status, 303);
  assert.match(await text(week, admin), /她想吃/);
  form.delete("image"); form.delete("kcal"); form.append("kcal", "330"); form.append("kcal", "0");
  assert.equal((await post(week,form)).status, 303);
  const changed = await text(menu);
  assert.match(changed, /当日合计 <strong>330 kcal/);
  assert.match(changed, /aria-pressed="true"/);
  assert.ok(changed.includes(src));
  assert.match(await text("/menu?day=2027-01-01"), /当天还没有菜单/);
  form.set("date","2027-05-01");
  assert.equal((await post(week,form)).status, 422);
  assert.match(await text(menu), /山药排骨汤/);
  await post("/menu/want",{id,wanted:"0"},her);
  assert.doesNotMatch(await text(week, admin), /她想吃/);
});

test("大菜单按天保存，保留其他日期、想吃记录和份量", async () => {
  const week = "2026-11-16", next = "2026-11-17", id = randomUUID();
  await db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(week).run();
  await db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<500)
    INSERT INTO menu_dishes(id,week,day,meal,name,position) SELECT printf('item-%d',n),?,?, '晚餐','另一日菜品',n FROM seq`).bind(week,next).run();
  await db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,kcal,position,wanted) VALUES(?,?,?,'午餐','白米饭',130,0,1)").bind(id,week,week).run();
  await db.prepare("INSERT INTO menu_dish_details(dish_id,station,category,portion) VALUES(?,'7F 自助餐线','主食','100 克')").bind(id).run();
  const edit = "/admin/menu?day=" + week, page = await text(edit,admin);
  assert.match(page,/保存当天/);
  assert.doesNotMatch(page,/另一日菜品/);
  assert.match(await text("/menu?day="+week),/约 130 kcal \/ 100 克/);
  const row = { id, date:week, meal:"午餐", name:"米饭", kcal:"130" };
  assert.equal((await post(edit,row)).status,422);
  assert.equal((await post(edit,{...row,scope:"day"})).status,303);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM menu_dishes WHERE day=?").bind(next).first()).n,500);
  assert.equal((await db.prepare("SELECT wanted FROM menu_dishes WHERE id=?").bind(id).first()).wanted,1);
});

test("平台阅读入口可从书架打开，有站内章节时优先显示正文", async () => {
  const id = randomUUID(), url = "/novels/" + id;
  await db.prepare("INSERT INTO books(id,title) VALUES(?,'试读书')").bind(id).run();
  await db.prepare("INSERT INTO book_reading_links VALUES(?,1,'中文试读','https://read.douban.com/example')").bind(id).run();
  assert.match(await text("/novels"),/中文试读/);
  assert.match(await text(url),/href="https:\/\/read.douban.com\/example"/);
  await db.prepare("INSERT INTO chapters(book_id,number,title,body) VALUES(?,1,'第一章','站内正文')").bind(id).run();
  assert.match(await text(url),/站内正文/);
});

test("早餐在前台和日期标记中过滤，旧行可编辑，联合楼层可从两层筛选", async () => {
  const week = "2028-01-03", second = "2028-01-04", id = randomUUID(), breakfast = randomUUID();
  await db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(week).run();
  const insert = db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,position,wanted) VALUES(?,?,?,?,?,0,?)");
  await db.batch([insert.bind(breakfast, week, week, "早餐", "旧早餐菜", 1),
    insert.bind(id, week, second, "加餐", "轻食", 0), insert.bind(randomUUID(), week, second, "加餐", "水果", 0),
    db.prepare("INSERT INTO menu_dish_details(dish_id,station,category) VALUES(?,'7F / 16F 轻食','主食')").bind(id)]);
  const empty = await text("/menu?day=" + week), menu = await text("/menu?day=" + second);
  assert.match(empty, /当天还没有菜单/);
  assert.doesNotMatch(empty, /旧早餐菜|有菜，已点想吃/);
  assert.match(menu, /data-meal="当日供应"/);
  assert.match(menu, /data-floors="7F 16F"/);
  assert.match(menu, /data-floor="其他"/);
  assert.match(menu, /<span class="dish-title">水果/);
  const edit = await text("/admin/menu?day=" + week, admin);
  assert.match(edit, /value="早餐" selected/);
  const template = edit.match(/<template id="dish-template">([\s\S]*?)<\/template>/)[1];
  assert.match(template, /<option value="午餐" selected/);
  assert.doesNotMatch(template, /早餐/);
  const saved = await post("/menu/want?meal=all&extra-floor=16F&wanted=1&day=1999-01-01", { id, wanted: "1" }, her);
  assert.equal(saved.headers.get("Location"), "/menu?day=" + second + "&meal=all&extra-floor=16F&wanted=1#dish-" + id);
});

test("阅读外观在正文首绘前从同源加载，五种底色保留纯文本段落", async () => {
  const id = randomUUID();
  await db.batch([db.prepare("INSERT INTO books(id,title) VALUES(?,'纸色')").bind(id),
    db.prepare("INSERT INTO chapters(book_id,number,title,body) VALUES(?,1,'开篇',?)").bind(id,"小于 < 大于\n第二段")]);
  const html = await text("/novels/" + id);
  assert.match(html, /<head>[\s\S]*?<script src="\/app\/reader-appearance\.js"><\/script><style>/);
  assert.equal((await request("/app/reader-appearance.js")).status,401);
  assert.equal((await get("/app/reader-appearance.js")).status,200);
  assert.deepEqual([...html.matchAll(/<button type="button" data-tone="(\w+)"/g)].map(m => m[1]),
    ["blush","paper","green","blue","night"]);
  const body = html.match(/<article class="reader-text"[^>]*>([\s\S]*?)<\/article>/)[1];
  assert.deepEqual([...body.matchAll(/<p>(.*?)<\/p>/g)].map(m => m[1]), ["小于 &lt; 大于","第二段"]);
  assert.doesNotMatch(await text("/novels"), /<script src="\/app\/reader-appearance/);
});

test("TXT 原件、自动分章、手编章节、独立续读及过期标签页", async () => {
  const id = randomUUID(), url = "/novels/" + id, edit = "/admin" + url;
  const src = "\ufeff开头的题记\r\n第一章 秋雨\r\n门外有一封信。\r\n这是第二段文字。\r\nChapter 2 – The Letter\r\n尾章正文。";
  const form = new FormData(); form.set("file", new Blob([src]), "秋日来信.txt");
  for (let i=0;i<2;i++) assert.equal((await post(edit + "/import",form)).status,303);
  const reader = await text(url);
  assert.match(reader,/秋日来信/); assert.match(reader,/开头的题记/);
  assert.match(reader,/Chapter 2 – The Letter/);
  const original = (await text(edit,admin)).match(/href="([^"]+)">下载原 TXT/)[1];
  assert.equal((await request(original)).status,401);
  assert.deepEqual(new Uint8Array(await (await get(original)).arrayBuffer()), new TextEncoder().encode(src));
  const progress = {chapter:"2",paragraph:"1",offset:"3",revision:"0"};
  assert.equal((await post(url+"/progress",progress,her)).status,200);
  assert.equal((await post(url+"/progress",{...progress,chapter:"3",paragraph:"0",offset:"1"},admin)).status,200);
  assert.match(await text(url,her),/data-chapter="2"[\s\S]+data-paragraph="1" data-offset="3"/);
  assert.match(await text(url,admin),/data-chapter="3"[\s\S]+data-paragraph="0" data-offset="1"/);
  assert.equal((await post(url+"/progress",{...progress,chapter:"1"},her)).status,409);
  assert.match(await text(url,her),/data-chapter="2"/);
  assert.equal((await post(edit+"/chapters/2",{title:"第二稿",body:"保留下来的段落。"})).status,303);
  assert.match(await text(url+"?chapter=2"),/第二稿/);
  const addition = { title:"尾声", body:"故事结束。", creation_key:randomUUID() };
  for(let i=0;i<2;i++) assert.equal((await post(edit+"/chapters/new",addition)).status,303);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM chapters WHERE book_id=?").bind(id).first()).n,4);
  assert.equal((await get(url+"?chapter=99")).status,404);
});

test("GBK / UTF-16 TXT、无章节与超长单段原文完整导入", async () => {
  const cases = [
    [Buffer.from("b5dad2bbd5c220b4babafe0ab4babafe", "hex"), "第一章 春湖", 1],
    [Buffer.from("\ufeff第一回 风起\r\n风起了。", "utf16le"), "第一回 风起", 1],
    [new TextEncoder().encode("字".repeat(280000)), "正文", 3]
  ];
  for (const [bytes,title,count] of cases) {
    const id=randomUUID(), form=new FormData();
    form.set("file",new Blob([bytes]),"书.txt");
    assert.equal((await post("/admin/novels/"+id+"/import",form)).status,303);
    const {results}=await db.prepare("SELECT title,length(body) AS n FROM chapters WHERE book_id=? ORDER BY number").bind(id).all();
    assert.equal(results[0].title,title);
    assert.equal(results.length,count);
    if(count>1) assert.equal(results.reduce((n,row)=>n+row.n,0),280000);
  }
});

test("空文件不发布书籍，手动创建的书可从首章开始读", async () => {
  const id = randomUUID(), path = "/admin/novels/" + id;
  const form = new FormData();
  form.set("title", "手录短篇"); form.set("file", new Blob([]), "空.txt");
  assert.equal((await post(path + "/import", form)).status, 422);
  assert.equal((await get("/novels/" + id)).status, 404);
  form.delete("file");
  assert.equal((await post(path + "/import", form)).status, 303);
  assert.match(await text("/novels/" + id), /还没有章节/);
  assert.equal((await post(path + "/chapters/new", { creation_key: randomUUID(), title: "开篇", body: "日光斜落。" })).status, 303);
  assert.match(await text("/novels/" + id), /日光斜落。/);
});

test("Puzzle 分类切换、MathML、放大配图、收起的解析与一次性完成记录", async () => {
  const id=randomUUID(), edit="/admin/puzzles/"+id, url="/puzzles/"+id+"?category="+encodeURIComponent("数学");
  const form=new FormData();
  for(const [k,v] of Object.entries({category:"数学",title:"直角三角形",question:"求 $c$。",formula:"c=\\sqrt{3^2+4^2}",solution:"答案是 \\(5\\)。"})) form.set(k,v);
  image(form);
  assert.equal((await post(edit,form)).status,303);
  const html=await text(url);
  assert.match(html,/<math[\s>]/); assert.match(html,/<msqrt>/); assert.match(html,/<details class="solution">/);
  assert.match(html,/<details class="photo">/);
  assert.doesNotMatch(await text("/puzzles?category="+encodeURIComponent("推理")),/直角三角形/);
  await Promise.all([post("/puzzles/"+id+"/done",{},her),post("/puzzles/"+id+"/done",{},her)]);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM puzzle_completions WHERE puzzle_id=?").bind(id).first()).n,1);
  assert.match(await text(url),/disabled>已完成/); assert.doesNotMatch(await text(url,admin),/disabled>已完成/);
  form.delete("image"); form.set("formula","\\frac{"); assert.equal((await post(edit,form)).status,422);
  assert.match(await text(url),/<msqrt>/);
});

test("新闻按日期归档，摘要先读，改稿后原条目生效", async () => {
  const id=randomUUID(), path="/admin/news/"+id;
  const item={day:"2026-05-17",title:"傍晚展讯",summary:"周末开放。",body:"展厅在二层。",source:"https://example.org/exhibition"};
  assert.equal((await post(path,item)).status,303);
  const first=await text("/news?day=2026-05-17");
  assert.match(first,/<details><summary><h2>傍晚展讯/);
  assert.match(first,/展厅在二层。/); assert.match(first,/rel="noopener noreferrer"/);
  assert.equal((await post(path,{...item,source:"file:///notes"})).status,422);
  assert.equal((await post(path,{...item,day:"2026-05-18",title:"更新的展讯"})).status,303);
  assert.doesNotMatch(await text("/news?day=2026-05-17"),/傍晚展讯/);
  assert.match(await text("/news?day=2026-05-18"),/更新的展讯/);
});

test("四类管理读写保持私密，普通成员不能写入管理内容", async () => {
  for(const section of ["menu","novels","puzzles","news"]) {
    const path="/admin/"+section;
    assert.equal((await get(path)).status,403);
    assert.equal((await post(path,{},her)).status,403);
    assert.equal((await request(path)).status,302);
    assert.equal((await request(path,{method:"POST",headers:admin,body:new URLSearchParams()})).status,403);
  }
});
