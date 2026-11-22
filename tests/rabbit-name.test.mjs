import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { load } from "cheerio";
import { chromium } from "playwright-core";
import { db, origin, request, secrets, setup, signIn } from "./support.mjs";

let base, her, second, admin;
const get = (path, member = her) => request(path, { headers: member });
const state = async (member) => (await get("/api/rabbit/state", member)).json();
const rename = (name, member = her, site = origin) => request("/api/rabbit/rename", {
  method: "POST", headers: { ...member, Origin: site, Accept: "application/json" },
  body: new URLSearchParams({ name })
});
const jsonRename = (body) => request("/api/rabbit/rename", {
  method: "POST", headers: { ...her, Origin: origin, Accept: "application/json", "Content-Type": "application/json" },
  body
});
async function openPage(browser, path, passcode) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.goto(new URL(path, base).href);
  await page.locator('input[name="passcode"]').fill(passcode);
  await page.getByRole("button", { name: "进入" }).click();
  return page;
}

before(async () => {
  base = await setup({
    async beforeMigration(file, old) {
      if (file === "0012_rabbit_name.sql") {
        await old.prepare("UPDATE rabbit_home SET satiety=61 WHERE owner='her'").run();
      }
    }
  });
  her = await signIn(secrets.PASSCODE_HER);
  second = await signIn(secrets.PASSCODE_HER);
  admin = await signIn(secrets.PASSCODE_ADMIN);
});

test("旧兔窝保留饱食度并得到默认名字，改名去掉首尾空白，跨会话持久化", async () => {
  const original = await state();
  assert.equal(original.name, "焦糖兔");
  assert.equal(original.satiety, 61);
  for (const name of ["团", "🐇".repeat(12)]) {
    const response = await rename("  " + name + "　");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name });
    assert.equal((await state(second)).name, name);
    assert.equal(await db.prepare("SELECT name FROM rabbit_home WHERE owner='her'").first("name"), name);
  }
});

test("空名、超过十二个 Unicode 字符、控制字符和错误类型均不改写兔名", async () => {
  assert.equal((await jsonRename(JSON.stringify({ name: " 小禾 " }))).status, 200);
  for (const name of ["", "　 \t", "兔".repeat(13), "🐇".repeat(13), "糯\n米", "兔\u0000子"]) {
    assert.equal((await rename(name)).status, 422, JSON.stringify(name));
  }
  for (const body of ["{}", "null", '{"name":42}', "{"]) {
    assert.equal((await jsonRename(body)).status, 422);
  }
  assert.equal((await state(second)).name, "小禾");
});

test("只有她的同源网页会话可以改名，后台和两人的相册安全显示原名文本", async () => {
  const name = "<b>糖&</b>";
  assert.equal((await rename(name)).status, 200);
  assert.equal((await rename("不应保存", {})).status, 401);
  assert.equal((await rename("不应保存", admin)).status, 403);
  assert.equal((await rename("不应保存", her, "https://elsewhere.test")).status, 403);
  for (const method of ["GET", "HEAD", "PUT"]) {
    assert.equal((await request("/api/rabbit/rename", { method, headers: her })).status, 405);
  }
  assert.equal((await get("/api/rabbit/state", admin)).status, 403);
  assert.equal((await request("/api/rabbit/state")).status, 401);
  assert.equal((await state()).name, name);
  for (const member of [second, admin]) {
    assert.equal((await (await get("/api/album", member)).json()).rabbitName, name);
  }
  const dashboard = load(await (await get("/admin", admin)).text());
  const link = dashboard('a[href="/admin/album"]');
  assert.equal(link.text(), name + "的手账相册›");
  assert.equal(link.find("b").length, 0);
  const album = load(await (await get("/admin/album", admin)).text());
  assert.equal(album("h1").text(), name + "的手账相册");
  assert.equal(album("h1 b").length, 0);
  assert.equal(album("[data-album-page]").attr("data-rabbit-name"), name);
});

test("真实兔窝的 Esc 只取消改名，回车和小勾保存，相纸与收集墙跟随名字", async (t) => {
  await rename("焦糖兔");
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  t.after(() => browser.close());
  const page = await openPage(browser, "/menu", secrets.PASSCODE_HER);
  const dir = process.env.FUTARI_RABBIT_NAME_SHOTS;
  if (dir) await mkdir(dir, { recursive: true });
  const screenshot = (file) => dir && page.screenshot({ path: join(dir, file) });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let writes = 0;
  page.on("request", (r) => { if (new URL(r.url()).pathname === "/api/rabbit/rename") writes++; });

  const launcher = page.locator("[data-room-shortcut]");
  await launcher.click();
  const room = page.locator("dialog.pet-room");
  const trigger = room.locator(".rabbit-name-trigger");
  const input = room.getByRole("textbox", { name: "小兔子的名字" });
  const title = room.locator("#room-title");
  const check = room.getByRole("button", { name: "保存兔名" });
  await room.locator(".room-body:not([aria-busy])").waitFor();
  await trigger.click();
  await input.fill("不保存的草稿");
  await input.press("Escape");
  assert.equal(await room.evaluate((el) => el.open), true);
  assert.equal(await title.textContent(), "焦糖兔的窝");
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  assert.equal(writes, 0);
  await page.keyboard.press("Escape");
  await room.waitFor({ state: "detached" });
  await launcher.click();
  await trigger.click();
  await input.fill("　");
  await input.press("Enter");
  await room.locator('input[aria-invalid="true"]').waitFor();
  await input.fill("  奶糖  ");
  await page.route("**/api/rabbit/rename", (route) => route.abort("internetdisconnected"), { times: 1 });
  await input.press("Enter");
  await room.getByText("名字还没记下来，再点一下小勾试试。").waitFor();
  assert.equal(await input.inputValue(), "  奶糖  ");
  assert.equal((await state()).name, "焦糖兔");
  await input.fill("奶糖");
  await screenshot("01-原地取名.png");
  await input.press("Enter");
  await room.getByRole("button", { name: "给奶糖改名" }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "奶糖的窝" }).count(), 1);
  assert.equal(await room.locator("[data-mood]").count(), 0);
  assert.equal(await room.locator(".room-clock").count(), 0);
  assert.match(await room.locator(".book-stage").getAttribute("aria-label"), /奶糖/);
  assert.match(await launcher.getAttribute("aria-label"), /奶糖/);
  const stageBox = await room.locator(".book-stage").boundingBox();
  const dragX = stageBox.x + stageBox.width * 0.49;
  const dragY = stageBox.y + stageBox.height * 0.65;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - 120, dragY, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(await room.locator(".book-stage").getAttribute("data-action"), "pet");
  await page.mouse.click(dragX - 120, dragY);
  await room.locator('.book-stage[data-action="pet"]').waitFor();
  await screenshot("02-取名后的兔窝.png");

  const camera = room.locator('[data-item="camera"]');
  const album = room.locator('[data-item="album"]');
  const print = room.locator(".instant-camera .instant-print");
  for (const caption of ["奶糖第一次看雪", ""]) {
    await camera.click();
    await room.getByRole("button", { name: "按下快门" }).click();
    await print.waitFor();
    assert.match(await print.getAttribute("aria-label"), /奶糖/);
    if (caption) await room.getByRole("textbox", { name: "照片短标题" }).fill(caption);
    await room.getByRole("button", { name: "收进相册" }).click();
    await room.getByRole("button", { name: "翻开相册" }).waitFor();
    await room.getByRole("button", { name: "收起相机" }).click();
  }
  await trigger.click();
  await input.fill("小满");
  await check.click();
  await room.getByRole("button", { name: "给小满改名" }).waitFor();
  assert.equal((await state(second)).name, "小满");
  const rows = await db.prepare("SELECT title, revision FROM rabbit_photos ORDER BY captured").all();
  assert.deepEqual(rows.results.map((row) => [row.title, row.revision]), [["奶糖第一次看雪", 1], ["", 1]]);
  await album.click();
  const automatic = room.locator(".journal-thumb").filter({ hasText: "小满" });
  await automatic.waitFor();
  assert.equal(await room.getByText("奶糖第一次看雪", { exact: true }).count(), 1);
  await automatic.click();
  const paper = room.locator(".journal-spread canvas");
  await room.getByRole("button", { name: "下载拍立得 PNG" }).waitFor();
  const download = page.waitForEvent("download");
  await room.getByRole("button", { name: "下载拍立得 PNG" }).click();
  const exported = await download;
  assert.match(exported.suggestedFilename(), /^小满-.*\.png$/);
  assert.match(await paper.getAttribute("aria-label"), /小满/);
  if (dir) await exported.saveAs(join(dir, "03-拍立得自动批注.png"));
  await room.getByRole("button", { name: "‹ 返回相册" }).click();
  await room.getByRole("button", { name: "瞬间收集墙" }).click();
  await room.getByRole("heading", { name: "小满的瞬间收集墙" }).waitFor();
  assert.match(await room.locator(".wall-link").first().getAttribute("aria-label"), /小满/);
  await screenshot("04-瞬间收集墙.png");
  await room.getByRole("button", { name: "合上相册" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await input.fill("糯米团");
  await screenshot("05-手机改名.png");
  await room.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await title.textContent(), "小满的窝");
  assert.equal(await room.evaluate((el) => el.open), true);
  const longName = "一二三四五六七八九十冬雪";
  await trigger.click();
  await input.fill(longName);
  await check.click();
  await room.getByRole("button", { name: "给" + longName + "改名" }).waitFor();
  const bounds = await trigger.boundingBox();
  assert.ok(bounds.x + bounds.width <= (await room.locator(".room-close").boundingBox()).x);
  const literal = "<b>茶$&</b>";
  await trigger.click();
  await input.fill(literal);
  await check.click();
  await room.getByRole("button", { name: "给" + literal + "改名" }).waitFor();
  assert.equal(await title.locator("b").count(), 0);
  await album.click();
  await room.locator(".journal-thumb").filter({ hasText: literal }).waitFor();
  assert.equal(await room.locator(".journal-thumb strong b").count(), 0);

  const dashboard = await openPage(browser, "/admin", secrets.PASSCODE_ADMIN);
  await dashboard.getByRole("link", { name: literal + "的手账相册" }).waitFor();
  await rename("桂花");
  await dashboard.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  const entry = dashboard.getByRole("link", { name: "桂花的手账相册" });
  await entry.waitFor();
  if (dir) await dashboard.screenshot({ path: join(dir, "06-管理员入口.png") });
  await entry.click();
  await dashboard.getByRole("button", { name: "瞬间收集墙" }).click();
  await dashboard.getByRole("heading", { level: 1, name: "桂花的瞬间收集墙" }).waitFor();
  await dashboard.getByRole("button", { name: "拍立得", exact: true }).click();
  await dashboard.locator(".journal-thumb").filter({ hasText: "奶糖第一次看雪" }).click();
  const draft = dashboard.getByRole("textbox", { name: "照片短标题" });
  await draft.fill("写到一半的批注");
  await rename("月饼");
  await dashboard.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await dashboard.getByRole("img", { name: /写到一半的批注.*月饼/ }).waitFor();
  assert.equal(await draft.inputValue(), "写到一半的批注");
  assert.deepEqual(errors, []);
});
