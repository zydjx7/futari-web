import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { db, origin, request, secrets, setup, signIn } from "./support.mjs";
import { recordPresence } from "../src/modules/wallet/earnings.js";
import { rewards } from "../src/modules/wallet/config.js";

let her, other, admin, oldRoom;
const get = (path, member = her) => request(path, { headers: member });
const post = (path, data = {}, member = her, site = origin) =>
  request(path, {
    method: "POST",
    headers: { ...member, Origin: site, Accept: "application/json" },
    body: new URLSearchParams(data)
  });
const read = async (path, member) => (await get(path, member)).json();
const room = () => read("/api/rabbit/state");
const adjust = (delta, note = "") =>
  db
    .prepare("INSERT INTO wallet_entries(kind,idempotency_key,delta,note) VALUES('adjustment',?,?,?)")
    .bind("admin:" + randomUUID(), delta, note)
    .run();

before(async () => {
  await setup({
    async beforeMigration(file, old) {
      if (file.startsWith("0007"))
        await old.prepare("INSERT INTO rabbit_inventory(item,quantity) VALUES('bed',1)").run();
    }
  });
  her = await signIn(secrets.PASSCODE_HER);
  other = await signIn(secrets.PASSCODE_HER);
  admin = await signIn(secrets.PASSCODE_ADMIN);
  oldRoom = await room();
});
beforeEach(async () => {
  await db.batch(
    [
      "DELETE FROM rabbit_feeds",
      "DELETE FROM rabbit_inventory",
      "DELETE FROM wallet_entries",
      "UPDATE wallets SET balance=0",
      "DELETE FROM companion_runs",
      "DELETE FROM companion_days",
      "UPDATE rabbit_home SET scene='paper',last_visit=NULL"
    ].map((sql) => db.prepare(sql))
  );
});
test("日常壳仅加载召唤器，场景与新图集私有，多朝向定稿原样上线", async () => {
  for (const path of ["/menu", "/novels", "/puzzles", "/news"]) {
    const html = await (await get(path)).text();
    assert.match(html, /data-room-shortcut[^>]+Alt\+B/);
    assert.match(html, /<title>FUTARI<\/title>/);
    assert.doesNotMatch(html, /小橡果|小信箱|<canvas|\/app\/rabbit\//);
    assert.doesNotMatch(await (await get(path, admin)).text(), /data-room-shortcut/);
  }
  for (const name of [
    "art/caramel.webp",
    "art/stationery.webp",
    "art/snow-field.webp",
    "art/snow-foreground.webp",
    "scenes/snow.js",
    "layout.js"
  ]) {
    const path = "/app/rabbit/" + name;
    assert.equal((await request(path)).status, 401);
    assert.equal((await get(path, admin)).status, 403);
    assert.equal((await get(path)).status, 200);
  }
  // Pin the accepted paintings and the contact-paint bank served with them.
  for (const [name, digest] of [
    ["art/caramel.webp", "894a978e118d33b6d5acb196890251f866f1cd3462db5d163fdb4fd7cce63b0b"],
    ["art/actions.webp", "a539e711c7ca38d8f73ad3b07ff08013c780d34dd727c6ba255180657aa1fea7"],
    ["action-layout.js", "83c777acabeae341ff93e672adbd47e556e0eeabc97b3707a33e785275beaa10"]
  ]) {
    const response = await get("/app/rabbit/" + name);
    assert.equal(response.status, 200);
    assert.equal(createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), digest, name);
  }
});
test("真实心跳和打开兔窝并发静默入账，日上限、跨设备与升级前未领都守恒", async () => {
  const now = Math.floor(Date.now() / 1000),
    day = Math.floor((now + rewards.dayOffsetSeconds) / 86400) * 86400 - rewards.dayOffsetSeconds;
  const stream = randomUUID(),
    start = now - 620;
  for (let t = start; t <= now - 20; t += 100) await recordPresence(db, stream, t);
  const jobs = await Promise.all([
    post("/api/companion/pulse", { stream }),
    post("/api/rabbit/visit", {}, other),
    post("/api/rabbit/visit"),
    post("/api/companion/pulse", { stream }, other)
  ]);
  assert.ok(jobs.every((j) => j.ok));
  const current = await read("/api/wallet");
  // The six hundred seconds can touch a ledger day boundary.
  const combined = await db.prepare("SELECT sum(earned) earned FROM companion_earnings").first();
  assert.ok(combined.earned >= 1);
  assert.equal(current.balance, combined.earned);
  assert.equal(current.pending, 0);
  await db.batch([
    db.prepare("INSERT INTO companion_days VALUES(?,300,12)").bind(day - 86400 * 4),
    db
      .prepare("INSERT INTO companion_runs VALUES(?,?,?)")
      .bind(randomUUID(), day - 86400 * 4, day - 86400 * 4 + 8300)
  ]);
  const fresh = await post("/api/companion/pulse", { stream: randomUUID() }, other);
  assert.equal(fresh.status, 204);
  assert.equal((await room()).balance, current.balance + 12);
  await Promise.all([post("/api/rabbit/visit", {}, other), post("/api/rabbit/visit")]);
  const after = await read("/api/wallet");
  assert.equal(after.balance, current.balance + 12);
  assert.equal(after.pending, 0);
  assert.equal(
    after.entries.reduce((sum, e) => sum + e.delta, 0),
    after.balance
  );
});
test("场景偏好双设备共用，旧摆件自动保留，新摆件显式摆放且幂等", async () => {
  assert.deepEqual(oldRoom.placed, ["bed"]);
  assert.equal(oldRoom.scene, "paper");
  assert.equal((await post("/api/rabbit/scene", { scene: "snow" })).status, 204);
  assert.equal((await read("/api/rabbit/state", other)).scene, "snow");
  assert.equal((await post("/api/rabbit/scene", { scene: "unknown" })).status, 422);
  assert.equal((await post("/api/rabbit/place", { item: "bed" })).status, 409);
  await adjust(30);
  await post("/api/rabbit/buy", { item: "bed", request_id: randomUUID() });
  assert.deepEqual((await room()).placed, []);
  for (const member of [her, other])
    assert.equal((await post("/api/rabbit/place", { item: "bed" }, member)).status, 204);
  assert.deepEqual((await room()).placed, ["bed"]);
  assert.equal((await room()).balance, 18);
  assert.equal((await post("/api/rabbit/place", { item: "hay" })).status, 422);
  for (const action of ["place", "scene", "open-letter"]) {
    assert.equal((await post("/api/rabbit/" + action, {}, admin)).status, 403);
    assert.equal((await post("/api/rabbit/" + action, {}, her, "https://elsewhere.test")).status, 403);
  }
});
test("火漆信只收管理员留言和赠礼，逐封阅读、乱序翻页和并发已读都跨设备同步", async () => {
  for (let i = 0; i < 22; i++) await adjust(1, "信 " + i);
  await adjust(4);
  await adjust(-1);
  await adjust(-1, "留给你读的字");
  await post("/api/rabbit/pet");
  assert.equal((await room()).unread, 24);
  const first = await read("/api/rabbit/mail"),
    second = await read("/api/rabbit/mail?before=" + first.nextBefore);
  assert.equal(first.letters.length, 20);
  assert.equal(second.letters.length, 4);
  assert.equal(first.letters[0].note, "留给你读的字");
  assert.equal(first.letters[1].note, "");
  const id = second.letters.at(-1).id;
  await Promise.all([
    post("/api/rabbit/open-letter", { id }),
    post("/api/rabbit/open-letter", { id }, other)
  ]);
  assert.equal((await read("/api/rabbit/state", other)).unread, 23);
  assert.equal((await read("/api/rabbit/mail?before=" + first.nextBefore, other)).letters.at(-1).opened, 1);
  assert.equal((await post("/api/rabbit/open-letter", { id: 999999 })).status, 404);
  assert.equal((await get("/api/rabbit/mail?before=ouch")).status, 422);
  const ledger = await (await get("/admin/wallet", admin)).text();
  assert.match(ledger, /摸摸头/);
  assert.match(ledger, /留给你读的字/);
});

test("三种新零食可投喂，三个窝互换且可收回", async () => {
  await adjust(150);
  for (const item of ["dandelion","apple","strawberry","bed","toastbed","knitbed"]) {
    assert.equal((await post("/api/rabbit/buy",{item,request_id:randomUUID()})).status,200);
    if ((await room()).shop[item].category === "snack") {
      await db.prepare("UPDATE rabbit_home SET last_fed=NULL,satiety=0").run();
      assert.equal((await post("/api/rabbit/feed",{item,request_id:randomUUID()})).status,200);
      assert.equal((await room()).inventory[item] || 0,0);
    } else {
      assert.equal((await post("/api/rabbit/place",{item})).status,204);
      assert.deepEqual((await room()).placed,[item]);
    }
  }
  assert.equal((await post("/api/rabbit/place",{item:"knitbed",placed:"0"})).status,204);
  assert.deepEqual((await room()).placed,[]);
});
