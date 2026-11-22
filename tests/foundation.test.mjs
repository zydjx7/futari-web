import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { db, files, origin, request, secrets, setup, signIn, submit } from "./support.mjs";
import { configured, issueCookie, nowSeconds, readSession, signingKey } from "../src/shared/session.js";

before(setup);

test("双暗号 8–256 字符、签名密钥 32 字符起，三者独立",async()=>{
  for(const field of ["PASSCODE_HER","PASSCODE_ADMIN"]) {
    assert.equal(secrets[field].length,8);
    assert.ok(configured(secrets));
    const cookie=await signIn(secrets[field]);
    assert.equal((await request("/api/session",{headers:cookie})).status,200);
    for(const n of [7,257]) assert.equal(configured({...secrets,[field]:"x".repeat(n)}),false);
    assert.equal(configured({...secrets,[field]:"x".repeat(256)}),true);
  }
  assert.equal(configured({...secrets,SESSION_SECRET:"s".repeat(31)}),false);
  assert.equal(configured({...secrets,SESSION_SECRET:"🐰".repeat(16)}),false);
  assert.equal(configured({...secrets,SESSION_SECRET:"s".repeat(32)}),true);
  assert.equal(configured({...secrets,PASSCODE_ADMIN:secrets.PASSCODE_HER}),false);
  assert.equal(configured({...secrets,PASSCODE_HER:secrets.SESSION_SECRET}),false);
  assert.equal(configured({...secrets,PASSCODE_HER:"🐰".repeat(4)}),false);
  assert.equal(configured({...secrets,PASSCODE_HER:"🐰".repeat(256)}),true);
});

test("网页入口拒绝桌宠会话，签名类型和 D1 scope 必须同时匹配",async()=>{
  const id=crypto.randomUUID(), expires=nowSeconds()+600, key=await signingKey(secrets), env={...secrets,DB:db};
  await db.prepare("INSERT INTO sessions(id,role,expires_at,scope) VALUES(?,'her',?,'desktop')").bind(id,expires).run();
  const headers={Cookie:(await issueCookie(key,id,expires,"desktop")).split(";")[0]};
  const from=new Request(origin,{headers});
  assert.equal(await readSession(from,env),null);
  assert.equal((await readSession(from,env,"desktop")).role,"her");
  for(const path of ["/menu","/novels","/api/session","/api/album","/admin"])
    assert.equal((await request(path,{headers})).status,401);
  assert.equal((await request("/api/rabbit/rename", {
    method: "POST", headers: { ...headers, Origin: origin }, body: new URLSearchParams({ name: "小团" })
  })).status, 401);
  const webSigned=new Request(origin,{headers:{Cookie:(await issueCookie(key,id,expires)).split(";")[0]}});
  assert.equal(await readSession(webSigned,env),null);
  await db.prepare("UPDATE sessions SET scope='web' WHERE id=?").bind(id).run();
  assert.equal(await readSession(from,env,"desktop"),null);
  assert.equal((await readSession(webSigned,env)).role,"her");
  // Migrated rows default to web; pre-scope signatures cannot establish either identity.
  const legacyPayload=id+"."+expires;
  const signature=createHmac("sha256",secrets.SESSION_SECRET).update("session:"+legacyPayload).digest("hex");
  const legacy={Cookie:"__Host-notes="+legacyPayload+"."+signature};
  assert.equal((await request("/menu",{headers:legacy})).status,401);
  assert.equal(await readSession(new Request(origin,{headers:legacy}),env,"desktop"),null);
});

test("匿名页面进入锁屏，API、文件和页面脚本都要求登录", async () => {
  const fromBook = await request("/novels");
  assert.equal(fromBook.status, 302);
  assert.equal(fromBook.headers.get("Location"), "/login?next=%2Fnovels");
  const lock = await request("/login");
  const html = await lock.text();
  assert.equal(lock.status, 200);
  assert.match(html, /<title>FUTARI<\/title>/);
  assert.match(html, /<h1[^>]*>FUTARI<\/h1>/);
  assert.equal((html.match(/<input /g) || []).length, 1);
  assert.doesNotMatch(html, /<nav|<canvas|type="email"/);
  for (const path of ["/api/session", "/api/files/sample.png", "/app/today.js"]) {
    const response = await request(path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
});

test("双暗号识别角色，主壳只含四栏，管理权限在服务端执行", async () => {
  const her = await signIn(secrets.PASSCODE_HER);
  const admin = await signIn(secrets.PASSCODE_ADMIN);
  for (const [headers, role] of [[her, "her"], [admin, "admin"]]) {
    assert.deepEqual(await (await request("/api/session", { headers })).json(), { role });
    assert.equal((await request("/", { headers })).headers.get("Location"), "/menu");
    for (const page of ["menu", "novels", "puzzles", "news"]) {
      const response = await request("/" + page, { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Security-Policy"), /connect-src 'self'/);
      const html = await response.text();
      assert.match(html, /<title>FUTARI<\/title>/);
      assert.match(html, /aria-label="FUTARI 首页"[^>]*>[\s\S]*?<\/span>FUTARI<\/a>/);
      assert.match(html, /aria-current="page"/);
      assert.doesNotMatch(html, /<canvas|<audio|<video|金币|钱包|\/app\/rabbit\//);
      assert.equal(html.includes("data-room-shortcut"), role === "her");
      assert.doesNotMatch(html, /data-open-room/);
      assert.equal(html.includes('href="/admin"'), role === "admin");
    }
  }
  assert.equal((await request("/admin", { headers: her })).status, 403);
  assert.equal((await request("/api/admin/wallet", { method: "POST", headers: her })).status, 403);
  assert.equal((await request("/admin", { headers: admin })).status, 200);
});

test("已登录才能读取私有 R2 对象，HEAD 同权，原文件以附件交付", async () => {
  const bytes = Uint8Array.of(137, 80, 78, 71);
  const path = "/api/files/" + encodeURI("菜单/封面.png");
  await files.put("菜单/封面.png", bytes, { httpMetadata: { contentType: "image/png" } });
  await files.put("books/source.txt", "原文", { httpMetadata: { contentType: "text/plain" } });
  const headers = await signIn(secrets.PASSCODE_HER);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, { method: "HEAD" })).status, 401);
  const picture = await request(path, { headers });
  assert.equal(picture.status, 200);
  assert.equal(picture.headers.get("Content-Type"), "image/png");
  assert.match(picture.headers.get("Content-Disposition"), /^inline;/);
  assert.deepEqual(new Uint8Array(await picture.arrayBuffer()), bytes);
  const head = await request(path, { method: "HEAD", headers });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), String(bytes.length));
  assert.equal(await head.text(), "");
  const book = await request("/api/files/books/source.txt", { headers });
  assert.equal(await book.text(), "原文");
  assert.match(book.headers.get("Content-Disposition"), /^attachment;/);
  assert.equal((await request("/api/files/missing", { headers })).status, 404);
});

test("五次并发错误触发单 IP 锁定，另一 IP、到期解锁及成功后清零", async () => {
  const ip = "192.0.2.50";
  const wrong = await Promise.all(Array.from({ length: 5 }, () => submit("wrong", ip)));
  assert.deepEqual(wrong.map(r => r.status).sort(), [401, 401, 401, 401, 429]);
  const locked = await submit(secrets.PASSCODE_ADMIN, ip);
  assert.equal(locked.status, 429);
  const wait = Number(locked.headers.get("Retry-After"));
  assert.ok(wait > 890 && wait <= 900);
  await signIn(secrets.PASSCODE_ADMIN, "192.0.2.51");
  await db.prepare("UPDATE login_attempts SET expires_at = 0 WHERE failures = 5").run();
  for (let i = 0; i < 4; i++) {
    assert.equal((await submit("wrong", ip)).status, 401);
    await signIn(secrets.PASSCODE_ADMIN, "192.0.2.51");
  }
  assert.equal((await db.prepare("SELECT count(*) AS n FROM login_attempts WHERE failures = 4").first()).n, 1);
  await signIn(secrets.PASSCODE_HER, ip);
  assert.equal((await submit("wrong", ip)).status, 401);
});

test("会话签名、过期、同源退出与服务端撤销", async () => {
  const headers = await signIn(secrets.PASSCODE_HER);
  const original = headers.Cookie;
  const modified = original.slice(0, -1) + (original.endsWith("0") ? "1" : "0");
  assert.equal((await request("/api/session", { headers: { Cookie: modified } })).status, 401);
  const denied = await request("/logout", { method: "POST", headers: { ...headers, Origin: "https://other.test" } });
  assert.equal(denied.status, 403);
  assert.equal((await request("/api/session", { headers })).status, 200);
  const out = await request("/logout", { method: "POST", headers: { ...headers, Origin: origin } });
  assert.equal(out.status, 303);
  assert.ok(out.headers.get("Set-Cookie").includes("Max-Age=0"));
  assert.equal((await request("/api/session", { headers })).status, 401);
  const expired = await signIn(secrets.PASSCODE_HER);
  const id = expired.Cookie.split("=")[1].split(".")[0];
  await db.prepare("UPDATE sessions SET expires_at = 0 WHERE id = ?").bind(id).run();
  assert.equal((await request("/api/session", { headers: expired })).status, 401);
});

test("登录回到站内原栏目，外部地址回到菜单", async () => {
  const book = await submit(secrets.PASSCODE_HER, "192.0.2.1", "?next=%2Fnovels");
  assert.equal(book.headers.get("Location"), "/novels");
  const outside = await submit(secrets.PASSCODE_HER, "192.0.2.1", "?next=https%3A%2F%2Fother.test");
  assert.equal(outside.headers.get("Location"), "/menu");
});

test("数据迁移只有她的兔窝，访客位默认为空", async () => {
  const rows = await db.prepare("SELECT owner, visitor_slot FROM rabbit_home").all();
  assert.deepEqual(rows.results, [{ owner: "her", visitor_slot: null }]);
});
