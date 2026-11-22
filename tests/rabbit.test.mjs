import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { db, origin, request, setup, signIn, secrets } from "./support.mjs";
import { shop, rewards } from "../src/modules/wallet/config.js";

let her, second, admin, migrated;
const get = (url, member = her) => request(url, { headers: member });
const post = (action, data = {}, member = her, site = origin) =>
  request("/api/rabbit/" + action, {
    method: "POST",
    headers: { ...member, Origin: site, Accept: "application/json" },
    body: new URLSearchParams(data)
  });
const order = (action, item, key = randomUUID(), member = her) => post(action, { item, request_id: key }, member);
const home = async () => (await get("/api/rabbit/state")).json();
const wallet = async () => (await get("/api/wallet")).json();
const fund = (amount) =>
  db
    .prepare("INSERT INTO wallet_entries(kind,idempotency_key,delta,note) VALUES('adjustment',?,?,'一份心意')")
    .bind("admin:" + randomUUID(), amount)
    .run();

before(async () => {
  await setup({
    async beforeMigration(file, old) {
      if (!file.startsWith("0006_")) return;
      await old.batch([
        old.prepare(`INSERT INTO wallet_entries(id,kind,idempotency_key,delta,note,created_at)
        VALUES(41,'adjustment','admin:before',11,'旧留言',100),(43,'adjustment','admin:correction',-2,'更正',200)`),
        old.prepare("INSERT INTO companion_days VALUES(0,300,12)"),
        old.prepare("INSERT INTO companion_runs VALUES('existing',300,900)"),
        old.prepare(
          "INSERT INTO wallet_entries(id,kind,idempotency_key,delta,day_start) VALUES(57,'allowance','allowance:her:0:1',1,0)"
        )
      ]);
    }
  });
  her = await signIn(secrets.PASSCODE_HER);
  second = await signIn(secrets.PASSCODE_HER);
  admin = await signIn(secrets.PASSCODE_ADMIN);
  migrated = await wallet();
});
beforeEach(async () => {
  await db.batch(
    [
      "DELETE FROM rabbit_feeds",
      "DELETE FROM rabbit_inventory",
      "DELETE FROM wallet_entries",
      "DELETE FROM companion_runs",
      "DELETE FROM companion_days",
      "UPDATE wallets SET balance=0",
      "UPDATE rabbit_home SET last_fed=NULL,satiety=35,last_visit=NULL"
    ].map((sql) => db.prepare(sql))
  );
});

test("从已有钱包迁移保留余额、旧流水的编号和留言、未领的陪伴时间", () => {
  assert.deepEqual([migrated.balance, migrated.pending], [10, 1]);
  assert.deepEqual(
    migrated.entries.map((e) => [e.id, e.delta, e.note]),
    [
      [57, 1, ""],
      [43, -2, "更正"],
      [41, 11, "旧留言"]
    ]
  );
  assert.equal(migrated.entries[2].created_at, 100);
});

test("四栏仅在她的导航保留兔耳入口，私有画稿与定稿 atlas 逐字节一致", async () => {
  for (const url of ["/menu", "/novels", "/puzzles", "/news"]) {
    const html = await (await get(url)).text();
    const $ = load(html);
    assert.equal($(".rail button[aria-haspopup=dialog]").length, 1);
    assert.equal($(".rail > button[data-room-shortcut]").attr("aria-label"), "打开兔窝");
    assert.doesNotMatch($("details.account").text(), /兔子|兔窝/);
    assert.equal($("details.account form[action='/logout']").length, 1);
    assert.doesNotMatch(html, /<dialog|<canvas|\/app\/rabbit\/|\/api\/wallet|零花钱|金币/);
    assert.doesNotMatch(await (await get(url, admin)).text(), /data-room-shortcut|data-open-room|room-launch/);
  }
  const url = "/app/rabbit/art/caramel.webp",
    atlas = await readFile("src/modules/rabbit/art/caramel.webp");
  const img = await get(url);
  assert.equal(img.headers.get("Content-Type"), "image/webp");
  assert.ok(atlas.equals(Buffer.from(await img.arrayBuffer())));
  assert.equal((await get("/app/rabbit/atlas.webp")).status,404);
  for (const path of [url, "/app/rabbit/room.js", "/api/rabbit/state"]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await get(path, admin)).status, 403);
  }
  for (const action of ["visit", "pet", "buy", "feed"]) {
    assert.equal((await post(action, {}, admin)).status, 403);
    assert.equal((await post(action, {}, her, "https://elsewhere.test")).status, 403);
    assert.equal((await get("/api/rabbit/" + action)).status, 405);
  }
  assert.deepEqual((await home()).inventory, {});
  assert.ok(!Object.hasOwn(await home(), "visitor_slot"));
});

test("扣钱与入包一次完成，重试、换设备、余额不足都不多扣", async () => {
  const price = shop.hay.price,
    key = randomUUID();
  await fund(price);
  const buys = await Promise.all([order("buy", "hay", key), order("buy", "hay", key, second)]);
  assert.deepEqual(await Promise.all(buys.map(async (r) => (await r.json()).applied)).then((v) => v.sort()), [
    false,
    true
  ]);
  assert.equal((await order("buy", "carrot", key)).status, 409);
  assert.equal((await order("buy", "hay")).status, 409);
  assert.equal((await order("buy", "unknown")).status, 422);
  assert.deepEqual((await home()).inventory, { hay: 1 });
  const account = await wallet();
  assert.equal(account.balance, 0);
  assert.deepEqual(
    account.entries.filter((e) => e.kind === "purchase").map((e) => [e.delta, e.detail, e.source]),
    [[-price, shop.hay.name, "商店购买"]]
  );
  const html = await (await get("/admin/wallet", admin)).text();
  assert.match(html, /商店购买/);
  assert.match(html, /一份心意/);
});

test("一次性软窝与玩具跨设备只摆一件，食物按服务端价计", async () => {
  await fund(100);
  for (const item of ["bed", "ball"]) {
    const result = await Promise.all([order("buy", item), order("buy", item, randomUUID(), second)]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await order("feed", item)).status, 422);
  }
  assert.equal(
    (await post("buy", { item: "carrot", request_id: randomUUID(), price: "0", quantity: 100 })).status,
    200
  );
  assert.deepEqual((await home()).inventory, { bed: 1, ball: 1, carrot: 1 });
  assert.equal((await wallet()).balance, 100 - shop.bed.price - shop.ball.price - shop.carrot.price);
});

test("两个窗口同时购买最后一份买得起的草，只有一个成功", async () => {
  await fund(shop.hay.price);
  const receipts = await Promise.all([order("buy", "hay"), order("buy", "hay", randomUUID(), second)]);
  assert.deepEqual(receipts.map(receipt => receipt.status).sort(), [200, 409]);
  assert.deepEqual((await home()).inventory, { hay: 1 });
  assert.equal((await wallet()).balance, 0);
});

test("喂食扣一份，连点与重试有回执，第二餐保留整数饱食度", async () => {
  await fund(50);
  assert.equal((await order("feed", "hay")).status, 409);
  for (let i = 0; i < 2; i++) await order("buy", "hay");
  await order("buy", "carrot");
  const initial = (await home()).satiety,
    key = randomUUID();
  const first = await order("feed", "hay", key);
  assert.deepEqual(await first.json(), { applied: true });
  assert.deepEqual(await (await order("feed", "hay", key, second)).json(), { applied: false });
  assert.equal((await order("feed", "carrot", key)).status, 409);
  assert.equal((await order("feed", "hay")).status, 409);
  let room = await home();
  assert.equal(room.satiety, initial + shop.hay.nourishment);
  assert.equal(room.inventory.hay, 1);
  await db
    .prepare("UPDATE rabbit_home SET last_fed=unixepoch()-?")
    .bind(rewards.feedCooldownSeconds + 5)
    .run();
  const next = await Promise.all([order("feed", "carrot"), order("feed", "carrot", randomUUID(), second)]);
  assert.deepEqual(next.map((r) => r.status).sort(), [200, 409]);
  room = await home();
  assert.equal(room.satiety, initial + shop.hay.nourishment + shop.carrot.nourishment);
  assert.deepEqual(room.inventory, { hay: 1 });
  await db
    .prepare("UPDATE rabbit_home SET satiety=99,last_fed=unixepoch()-?")
    .bind(rewards.feedCooldownSeconds + 1)
    .run();
  assert.equal((await order("feed", "hay")).status, 200);
  assert.equal((await home()).satiety, 100);
  await order("buy", "hay");
  const full = await order("feed", "hay");
  assert.equal(full.status, 409);
  assert.equal((await full.json()).error, "兔子已经吃饱了");
  assert.deepEqual((await home()).inventory, { hay: 1 });
  await db
    .prepare("UPDATE rabbit_home SET last_fed=unixepoch()-?")
    .bind(rewards.satietySecondsPerPoint * 200)
    .run();
  assert.equal((await home()).satiety, 0);
  assert.equal((await wallet()).entries.filter((e) => e.kind === "purchase").length, 4);
});

test("每日摸头与久别回礼去重，读取状态不会改来访时间", async () => {
  await home();
  assert.equal((await db.prepare("SELECT last_visit FROM rabbit_home").first()).last_visit, null);
  assert.deepEqual(await (await post("visit")).json(), { gift: 0 });
  await Promise.all([post("pet"), post("pet", {}, second)]);
  assert.equal((await wallet()).balance, rewards.firstPetCoins);
  await db
    .prepare("UPDATE rabbit_home SET last_visit=unixepoch()-?")
    .bind(rewards.returnAfterDays * 86400 + 1)
    .run();
  const returns = await Promise.all([post("visit"), post("visit", {}, second)]);
  const gifts = await Promise.all(returns.map(async (r) => (await r.json()).gift));
  assert.deepEqual(gifts.sort(), [0, rewards.returnCoins]);
  const account = await wallet();
  assert.equal(account.balance, rewards.firstPetCoins + rewards.returnCoins);
  assert.equal(
    account.entries.reduce((sum, e) => sum + e.delta, 0),
    account.balance
  );
});
