import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, files, request, origin, secrets, setup, signIn } from "./support.mjs";
import { daylight } from "../src/modules/rabbit/light.client.js";

// A 720px square monochrome PNG.
const pixels = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAtAAAALQAQAAAACRLHoxAAAAVUlEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8Gj/8AAB3Rn5DAAAAABJRU5ErkJggg==",
  "base64"
);
let her, admin, second;
const get = (path, member = her) => request(path, { headers: member });
async function send(path, body, member = her, site = origin) {
  const wire = new Request(origin, { method: "POST", body });
  return request(path, {
    method: "POST",
    headers: {
      ...member,
      Origin: site,
      Accept: "application/json",
      "Content-Type": wire.headers.get("Content-Type")
    },
    body: await wire.arrayBuffer()
  });
}
const shot = (props = {}) => ({
  id: randomUUID(),
  captured: Date.now(),
  offset: 540,
  scene: "snow",
  light: "day",
  pose: "stump",
  title: "雪地里的耳朵",
  ...props
});
function upload(s, member = her, png = pixels, site = origin) {
  const body = new FormData();
  for (const [k, v] of Object.entries(s)) body.set(k, v);
  body.set("image", new Blob([png], { type: "image/png" }), "photo.png");
  return send("/api/album", body, member, site);
}
const list = async (query = "", member = her) => (await get("/api/album" + query, member)).json();
const modify = (s, action, data, member = her) =>
  send("/api/album/" + s.id + "/" + action, new URLSearchParams(data), member);
before(async () => {
  await setup();
  her = await signIn(secrets.PASSCODE_HER);
  second = await signIn(secrets.PASSCODE_HER);
  admin = await signIn(secrets.PASSCODE_ADMIN);
});
test("私有相册只在授权入口出现，管理员看照片，与养兔权限独立", async () => {
  const id = randomUUID();
  for (const path of [
    "/api/album",
    "/api/album/" + id + "/image",
    "/app/album/book.js",
    "/app/album/paper.webp"
  ]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { method: "HEAD" })).status, 401);
  }
  assert.equal((await request("/admin/album")).headers.get("Location"), "/login?next=%2Fadmin%2Falbum");
  assert.equal((await get("/admin/album", admin)).status, 200);
  assert.equal((await get("/admin/album", her)).status, 403);
  assert.equal((await get("/api/rabbit/state", admin)).status, 403);
  assert.equal((await upload(shot(), admin)).status, 403);
  assert.equal((await upload(shot(), her, pixels, "https://unrelated.test")).status, 403);
  assert.equal((await get("/app/rabbit/camera.js", admin)).status, 403);
  assert.match(await (await get("/admin", admin)).text(), /href="\/admin\/album"/);
  for (const role of [admin, her])
    assert.doesNotMatch(
      await (await get("/novels", role)).text(),
      /book\.js|\/app\/album\/|瞬间收集墙|拍立得/
    );
});
test("同一快门并发、超时重试只收一张，双方读取同一 R2 原片", async () => {
  const s = shot();
  const jobs = await Promise.all([upload(s), upload(s, second), upload(s)]);
  for (const response of jobs) assert.equal(response.status, 200, await response.text());
  for (const role of [her, admin]) {
    const data = await list("", role);
    assert.equal(data.photos.filter((p) => p.id === s.id).length, 1);
    assert.equal(data.covers.stump, s.id);
    const response = await get("/api/album/" + s.id + "/image", role);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pixels);
    assert.equal(
      (await request("/api/album/" + s.id + "/image", { method: "HEAD", headers: role })).headers.get(
        "Content-Length"
      ),
      String(pixels.length)
    );
  }
  assert.equal((await upload({ ...s, pose: "back" })).status, 409);
  assert.equal((await get("/api/files/rabbit-photos%2F" + s.id + ".png")).status, 404);
});
test("相纸标题跨设备同步，同时改字检测版本，删除不被旧快门复活", async () => {
  const s = shot({ pose: "chew" });
  await upload(s);
  const changes = await Promise.all([
    modify(s, "title", { title: "我的题字", revision: 1 }, admin),
    modify(s, "title", { title: "她的题字", revision: 1 })
  ]);
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  const changed = await changes.find((r) => r.ok).json();
  assert.equal((await upload(s)).status, 200);
  assert.equal((await list("?moment=chew", second)).photos[0].title, changed.title);
  assert.equal((await modify(s, "delete", { revision: 1 })).status, 409);
  assert.equal((await modify(s, "delete", { revision: 2 }, admin)).status, 204);
  assert.equal((await modify(s, "delete", { revision: 2 })).status, 204);
  assert.equal((await upload(s)).status, 409);
  assert.equal((await list()).covers.chew, undefined);
  assert.equal((await get("/api/album/" + s.id + "/image", admin)).status, 404);
  assert.equal(await files.head("rabbit-photos/" + s.id + ".png"), null);
});
test("自然动作共用私有相纸、两人的收集墙与各动作筛选", async () => {
  for (const pose of ["sniff", "stand", "groom", "loaf", "sploot", "stretch", "flop", "nudge", "alert", "tilt"]) {
    const photo = shot({ pose, scene: "paper" });
    assert.equal((await upload(photo)).status, 200, pose);
    const gallery = await list("?moment=" + pose, admin);
    assert.equal(gallery.covers[pose], photo.id);
    assert.equal(gallery.photos[0].pose, pose);
  }
  assert.equal((await get("/app/rabbit/art/actions.webp", her)).status, 200);
  assert.equal((await get("/app/rabbit/art/actions.webp", admin)).status, 403);
});
test("时间相同的相纸翻页无遗漏，盖章跨页，空镜和未收片均不盖章", async () => {
  const at = Date.now(),
    shots = Array.from({ length: 14 }, () => shot({ captured: at, pose: "leap" }));
  for (const s of shots) assert.equal((await upload(s)).status, 200);
  await upload(shot({ pose: "scenery" }));
  const a = await list("?moment=leap"),
    b = await list("?moment=leap&before=" + a.next);
  assert.equal(a.photos.length, 12);
  assert.equal(b.photos.length, 2);
  assert.equal(b.next, null);
  assert.deepEqual(
    [...a.photos, ...b.photos].map((p) => p.id),
    shots
      .map((s) => s.id)
      .sort()
      .reverse()
  );
  assert.equal(a.covers.scenery, undefined);
  assert.equal(a.covers.nap, undefined);
  assert.equal(a.covers.leap, a.photos[0].id);
  for (const query of ["?before=bad", "?before=0", "?moment=invalid"])
    assert.equal((await get("/api/album" + query)).status, 422);
});
test("错误原片与不匹配的夜景标记不会发布，相册可续办中断的删除", async () => {
  assert.equal((await upload(shot(), her, new Uint8Array(100))).status, 422);
  assert.equal((await upload(shot(), her, Buffer.alloc(2300001))).status, 422);
  assert.equal((await upload(shot({ light: "day", pose: "nap" }))).status, 422);
  assert.equal((await upload(shot({ pose: "stump", scene: "paper" }))).status, 422);
  assert.equal((await upload(shot({ title: "x".repeat(41) }))).status, 422);
  const s = shot({ pose: "pet" });
  await upload(s);
  await db.prepare("UPDATE rabbit_photos SET status='deleting' WHERE id=?").bind(s.id).run();
  assert.equal((await get("/api/album/" + s.id + "/image")).status, 404);
  assert.equal((await list()).covers.pet, undefined);
  assert.equal((await modify(s, "delete", { revision: 1 })).status, 204);
  assert.equal(await files.get("rabbit-photos/" + s.id + ".png"), null);
});
test("跟随时间为迁移默认，四种光影跨设备保存且只允许她设置", async () => {
  assert.deepEqual(
    [0, 5, 6, 12, 15, 16, 18, 19, 23].map((h) => daylight("auto", h)),
    ["night", "night", "day", "day", "day", "dusk", "dusk", "night", "night"]
  );
  assert.equal(daylight("night", 12), "night");
  const state = async (member) => (await get("/api/rabbit/state", member)).json();
  assert.equal((await state(her)).atmosphere, "auto");
  const light = (s, m = her, site = origin) =>
    send("/api/rabbit/atmosphere", new URLSearchParams({ atmosphere: s }), m, site);
  for (const mode of ["day", "dusk", "night", "auto"]) {
    assert.equal((await light(mode)).status, 204);
    assert.equal((await state(second)).atmosphere, mode);
  }
  assert.equal((await light("haze")).status, 422);
  assert.equal((await light("day", admin)).status, 403);
  assert.equal((await light("day", her, "https://unrelated.test")).status, 403);
});
test("未写完的照片对两个账号都隐藏，重试同一原片能完成落册", async () => {
  const s = shot({ scene: "snow", light: "night", pose: "nap" });
  assert.equal((await upload(s)).status, 200);
  await db.prepare("UPDATE rabbit_photos SET status='writing' WHERE id=?").bind(s.id).run();
  await files.delete("rabbit-photos/" + s.id + ".png");
  assert.equal((await get("/api/album/" + s.id + "/image", admin)).status, 404);
  assert.equal((await list("?moment=nap", admin)).photos.length, 0);
  assert.equal((await upload(s, second)).status, 200);
  assert.equal((await list("?moment=nap", admin)).covers.nap, s.id);
  assert.deepEqual(
    Buffer.from(await (await get("/api/album/" + s.id + "/image", admin)).arrayBuffer()),
    pixels
  );
});
