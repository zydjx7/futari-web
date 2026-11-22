import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, origin, request, secrets, setup, signIn } from "./support.mjs";
import { rewards } from "../src/modules/wallet/config.js";
import { completePuzzle, recordPresence } from "../src/modules/wallet/earnings.js";

let her, admin, otherDevice;
before(async () => {
  await setup();
  her = await signIn(secrets.PASSCODE_HER);
  otherDevice = await signIn(secrets.PASSCODE_HER);
  admin = await signIn(secrets.PASSCODE_ADMIN);
});
beforeEach(async () => {
  await db.batch(["DELETE FROM wallet_entries", "UPDATE wallets SET balance=0", "DELETE FROM companion_runs",
    "DELETE FROM companion_days", "DELETE FROM allowance_claims"].map(sql => db.prepare(sql)));
});
const get = (path, headers = her) => request(path, { headers });
const post = (path, data, member = her, site = origin) => request(path, {
  method: "POST", headers: { ...member, Origin: site, Accept: "application/json" }, body: new URLSearchParams(data)
});
const readWallet = async (member = her) => (await get("/api/wallet", member)).json();
const claim = async (id, member = her) => (await post("/api/wallet/claim", { request_id: id }, member)).json();
const adjust = (request_id, direction, amount, note = "") => post("/admin/wallet", { request_id, direction, amount, note }, admin);
const day = Date.UTC(2026, 10, 20) / 1000 - rewards.dayOffsetSeconds;
const setDailyTerms = start => db.prepare("INSERT INTO companion_days VALUES(?,300,12)").bind(start).run();

test("唯一的钱包、角色与同源限制，日常页面静默", async () => {
  assert.deepEqual((await db.prepare("SELECT * FROM wallets").all()).results, [{ owner: "her", balance: 0 }]);
  await assert.rejects(db.prepare("INSERT INTO wallets(owner) VALUES ('admin')").run());
  assert.equal((await request("/api/wallet")).status, 401);
  assert.equal((await get("/api/wallet", admin)).status, 403);
  assert.equal((await get("/admin/wallet")).status, 403);
  assert.equal((await post("/admin/wallet", {})).status, 403);
  const key = randomUUID();
  for (const [path, payload] of [["/api/wallet/claim", { request_id: key }], ["/api/companion/pulse", { stream: key }]]) {
    assert.equal((await get(path)).status, 405);
    assert.equal((await post(path, payload, admin)).status, 403);
    assert.equal((await post(path, payload, her, "https://elsewhere.test")).status, 403);
    assert.equal((await post(path, {})).status, 422);
  }
  for (const page of ["/menu", "/novels", "/puzzles", "/news"]) {
    const html = await (await get(page)).text();
    assert.match(html, /<title>FUTARI<\/title>/);
    assert.doesNotMatch(html, /金币|钱包|零花钱|<canvas|\/api\/wallet|\/api\/rabbit/);
    assert.match(html, /src="\/app\/presence.js"/);
    assert.doesNotMatch(await (await get(page, admin)).text(), /src="\/app\/presence.js"/);
  }
  assert.equal((await post("/api/companion/pulse", { stream: key, seconds: 86400, now: day })).status, 204);
  const run = await db.prepare("SELECT started_at,last_seen FROM companion_runs WHERE stream=?").bind(key).first();
  assert.ok(Math.abs(run.started_at-Date.now()/1000)<10);
  assert.equal(run.started_at, run.last_seen);
  assert.deepEqual(await db.prepare("SELECT seconds_per_coin,daily_cap FROM companion_days").first(),
    { seconds_per_coin: rewards.companionSecondsPerCoin, daily_cap: rewards.companionDailyCap });
  assert.deepEqual(await readWallet(), {balance: 0, pending: 0, entries: [], nextBefore: null});
});

test("章节须开始并到达完成条件；重新打开、换设备和保存书签不会重发", async () => {
  const book = randomUUID(), base = "/novels/" + book;
  await db.batch([
    db.prepare("INSERT INTO books(id,title) VALUES(?,'冬日来信')").bind(book),
    db.prepare("INSERT INTO chapters(book_id,number,title,body) VALUES(?,1,'来信','她在窗边读信。'),(?,2,'回信','她拿起笔。')").bind(book, book)
  ]);
  const read = (phase, chapter = 1, member = her) => post(base + "/read", { phase, chapter }, member);
  assert.equal((await post(base + "/progress", { chapter:1, paragraph:0, offset:6, revision:0 })).status, 200);
  assert.equal((await read("finish")).status, 409);
  assert.equal((await read("start", 7)).status, 404);
  assert.equal((await read("start", 1, admin)).status, 403);
  assert.equal((await read("start")).status, 204);
  assert.equal((await read("finish")).status, 409);
  assert.equal((await readWallet()).balance, 0);
  await db.prepare("UPDATE chapter_read_starts SET started_at=unixepoch()-? WHERE book_id=?")
    .bind(rewards.chapterVisibleSeconds + 2, book).run();
  const results = await Promise.all([read("finish"), read("finish", 1, otherDevice), read("start"), read("finish")]);
  assert.ok(results.every(res => res.status === 204));
  assert.equal((await read("finish", 2)).status, 409);
  const wallet = await readWallet(otherDevice);
  assert.equal(wallet.balance, rewards.chapterCoins);
  assert.deepEqual(wallet.entries.map(row => [row.kind,row.detail]), [["reading","冬日来信 · 来信"]]);
  await db.prepare("UPDATE chapters SET title='再次来信' WHERE book_id=? AND number=1").bind(book).run();
  assert.equal((await read("finish")).status, 204);
  assert.equal((await read("start", 2)).status, 204);
  await db.prepare("UPDATE chapter_read_starts SET started_at=unixepoch()-? WHERE book_id=? AND chapter=2")
    .bind(rewards.chapterVisibleSeconds + 2, book).run();
  assert.equal((await read("finish", 2)).status, 204);
  assert.equal((await readWallet()).balance, 2 * rewards.chapterCoins);
});

test("做题只在她首次完成时与完成记录一起入账，保留旧完成记录", async () => {
  const puzzle = randomUUID(), old = randomUUID();
  for (const id of [puzzle, old]) {
    await db.prepare("INSERT INTO puzzles(id,category,title,question,formula,solution) VALUES(?,'数学','圆','题干','','解')")
      .bind(id).run();
  }
  await db.prepare("INSERT INTO puzzle_completions(member,puzzle_id) VALUES('her',?)").bind(old).run();
  const done = (id, member) => post("/puzzles/" + id + "/done", {}, member);
  assert.equal((await done(puzzle,admin)).status, 200);
  assert.equal((await done(old,her)).status, 200);
  assert.equal((await get("/puzzles/" + puzzle)).status, 200);
  assert.equal((await readWallet()).balance, 0);
  const results = await Promise.all([done(puzzle,her),done(puzzle,otherDevice),done(puzzle,her)]);
  assert.ok(results.every(res => res.status === 200));
  const wallet = await readWallet();
  assert.equal(wallet.balance, rewards.puzzleCoins);
  assert.deepEqual(wallet.entries.map(row => [row.kind,row.detail]), [["puzzle","圆"]]);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM puzzle_completions WHERE puzzle_id=?").bind(puzzle).first()).n, 2);
});

test("完成记录写入失败时，同一事务中的金币也会回滚", async () => {
  const missingPuzzle = { id: randomUUID(), title: "已不存在的题目" };
  await assert.rejects(completePuzzle({ db, role: "her" }, missingPuzzle));
  assert.deepEqual(await readWallet(), {balance: 0, pending: 0, entries: [], nextBefore: null});
});

test("多标签与多设备的在线区间取并集，长时间失联与当天上限", async () => {
  await setDailyTerms(day);
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  const heartbeat = (id, seconds) => recordPresence(db, id, day + seconds);
  for (const t of [0,100,200,300,360]) await heartbeat(a,t);
  for (const t of [30,120,220,320,400,480]) await heartbeat(b,t);
  for (const t of [45,120]) await heartbeat(c,t);
  await heartbeat(a, 9000);
  const report = () => db.prepare("SELECT seconds,earned,claimed FROM companion_earnings WHERE day_start=?").bind(day).first();
  assert.deepEqual(await report(), { seconds: 480, earned: 1, claimed: 0 });
  for (let t = 9100; t <= 13000; t += 100) await heartbeat(a,t);
  assert.deepEqual(await report(), { seconds: 4480, earned: 12, claimed: 0 });
  assert.equal((await readWallet()).balance, 0);
  assert.equal((await readWallet()).pending, 12);
});

test("跨午夜拆分，隔日与旧日的待领一起结算，同一凭据的重试不会领取后来新攒的钱", async () => {
  const stream = randomUUID(), boundary = day + 86400, firstRequest = randomUUID();
  await setDailyTerms(day);
  await setDailyTerms(boundary);
  assert.deepEqual(await claim(firstRequest), { credited: 0, balance: 0 });
  for (let t = -360; t <= 660; t += 60) await recordPresence(db, stream, boundary+t);
  const perDay = (await db.prepare("SELECT day_start,seconds,earned FROM companion_earnings ORDER BY day_start").all()).results;
  assert.deepEqual(perDay, [
    {day_start: day, seconds: 360, earned: 1}, {day_start: boundary, seconds: 660, earned: 2}
  ]);
  assert.equal((await readWallet()).pending, 3);
  assert.deepEqual(await claim(firstRequest), { credited: 0, balance: 0 });
  const key = randomUUID();
  const receipts = await Promise.all([claim(key),claim(key,otherDevice),claim(randomUUID(),otherDevice)]);
  assert.deepEqual(receipts.map(r=>r.credited).sort(), [0,0,3]);
  let wallet = await readWallet();
  assert.deepEqual([wallet.balance, wallet.pending, wallet.entries.length], [3,0,2]);
  for (const t of [750,850,950]) await recordPresence(db, stream, boundary+t);
  assert.deepEqual(await claim(key), { credited: 0, balance: 3 });
  assert.equal((await readWallet()).pending, 1);
  assert.deepEqual(await claim(randomUUID()), { credited: 1, balance: 4 });
  wallet = await readWallet(otherDevice);
  assert.equal(wallet.entries.reduce((sum,row)=>sum+row.delta,0), wallet.balance);
  assert.equal(wallet.pending, 0);
});

test("后台增扣、留言、幂等重试与并发扣款，余额不会透支", async () => {
  const key = randomUUID(), message = "今天辛苦了 <3";
  const adds = await Promise.all([adjust(key,"add",10,message),adjust(key,"add",10,message)]);
  assert.ok(adds.every(res => res.status === 200));
  assert.equal((await adjust(key,"add",15,message)).status, 422);
  const debits = await Promise.all([adjust(randomUUID(),"subtract",7,"更正"),adjust(randomUUID(),"subtract",7,"更正")]);
  assert.deepEqual(debits.map(r=>r.status).sort(), [200,422]);
  for (const invalid of [0,-1,1.2,"1e2","a"]) assert.equal((await adjust(randomUUID(),"add",invalid)).status, 422);
  assert.equal((await adjust(randomUUID(),"subtract",4)).status, 422);
  const wallet = await readWallet();
  assert.equal(wallet.balance, 3);
  assert.deepEqual(wallet.entries.map(r=>[r.delta,r.note]), [[-7,"更正"],[10,message]]);
  assert.equal(wallet.entries.reduce((sum,row)=>sum+row.delta,0), wallet.balance);
  const html = await (await get("/admin/wallet",admin)).text();
  assert.match(html, /今天辛苦了 &lt;3/);
  assert.match(html, /更正/);
  assert.match(html, /name="request_id"/);
});

test("流水可翻查，翻页期间新记的一笔不会挤掉旧记录", async () => {
  await db.batch(Array.from({length:26},(_,i)=>db.prepare(`INSERT INTO wallet_entries(kind,idempotency_key,delta,note)
    VALUES('adjustment',?,1,?)`).bind("admin:"+randomUUID(),"信 "+i)));
  const first = await readWallet();
  assert.equal(first.entries.length,25);
  assert.equal((await adjust(randomUUID(),"add",1,"新信")).status,200);
  const rest = await (await get("/api/wallet?before="+first.nextBefore)).json();
  assert.equal(rest.balance,27);
  assert.deepEqual(rest.entries.map(row=>row.note),["信 0"]);
  assert.equal(rest.nextBefore,null);
});
