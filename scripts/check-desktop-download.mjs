// Local-only acceptance, against the persisted development site.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { parseEnv } from "node:util";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:8787";
const secrets = parseEnv(await readFile(".dev.vars", "utf8"));
const browser = await chromium.launch({ channel:"msedge", headless:true });
const hash = data => createHash("sha256").update(data).digest("hex");
try {
  const ctx = await browser.newContext({ viewport:{width:1260,height:850} });
  const page = await ctx.newPage(), api = ctx.request;
  const file = "FUTARI-Desktop-Windows-x64.zip", url = origin + "/api/files/downloads/" + file;
  assert.equal((await api.get(url)).status(),401);
  for (const role of ["ADMIN","HER"]) {
    const session = await api.post(origin + "/login",{form:{passcode:secrets["PASSCODE_" + role]}, headers:{Origin:origin},maxRedirects:0});
    assert.equal(session.status(),303);
    try {
      if (role === "ADMIN") {
        assert.equal((await api.get(origin + "/api/rabbit/downloads")).status(),403);
      } else {
        await page.goto(origin + "/menu");
        await page.locator("[data-room-shortcut]").click();
        await page.getByRole("button",{name:"风景册"}).click();
        const card = page.locator(".desktop-postcard");
        const link = card.getByRole("link",{name:/下载 Windows/});
        await link.scrollIntoViewIfNeeded();
        await mkdir("outputs/桌宠下载验收",{recursive:true});
        await page.screenshot({path:"outputs/桌宠下载验收/本地兔窝下载.png"});
        const [download] = await Promise.all([page.waitForEvent("download"),link.click()]);
        assert.equal(download.suggestedFilename(),file);
        const local = await readFile("desktop/dist/"+file);
        assert.equal(hash(await readFile(await download.path())),hash(local));
        const head = await api.head(url);
        assert.equal(head.status(),200);
        assert.equal(head.headers()["content-type"],"application/zip");
        console.log("Anonymous 401 · admin 403 · her 200 · ZIP SHA-256",hash(local));
      }
    } finally { await api.post(origin+"/logout",{headers:{Origin:origin}}); }
  }
} finally { await browser.close(); }
