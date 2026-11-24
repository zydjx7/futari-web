import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createTestHarness, unstable_splitSqlQuery as split } from "wrangler";
const secrets = Object.fromEntries(
  ["PASSCODE_HER", "PASSCODE_ADMIN", "SESSION_SECRET"].map((k) => [
    k,
    randomBytes(32).toString("hex"),
  ]),
);
const harness = createTestHarness({
  workers: [{ configPath: "desktop/cloud/wrangler.jsonc", secrets },{configPath:"wrangler.jsonc",secrets}],
});
after(() => harness.close());
function call(name, { token, body, ip = "192.0.2.2" } = {}) {
  return harness.fetch("https://test.invalid/v1/" + name, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
      ...(token && { Authorization: "Bearer " + token }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
test("only the native notebook can invoke rename", async () => {
  const directory = "desktop-app/desktop/src-tauri/capabilities/";
  const permitted = [];
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".json")) continue;
    const capability = JSON.parse(await readFile(directory + file, "utf8"));
    if (capability.permissions.includes("allow-rename")) permitted.push(...capability.windows);
  }
  assert.deepEqual(permitted, ["card"]);
});
test("desktop bridge • role, cloud wallet, idempotency, mail, session revocation and IP lock", async () => {
  await harness.listen();
  const { DB } = await harness.getWorker().getEnv();
  for (const f of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile("migrations/" + f, "utf8");
    await DB.batch(split(sql).map((s) => DB.prepare(s)));
  }
  assert.equal((await call("state")).status, 401);
  assert.equal(
    (await call("session", { body: { passcode: secrets.PASSCODE_ADMIN } }))
      .status,
    403,
  );
  const auth = await call("session", {
    body: { passcode: secrets.PASSCODE_HER },
  });
  assert.equal(auth.status, 200);
  const { token } = await auth.json();
  assert.ok(token);
  assert.equal((await call("update/manifest")).status,401);
  assert.equal((await call("update/ui/test")).status,401);
  assert.equal((await call("update/ui/%2E%2E%2Fbad",{token})).status,400);
  assert.deepEqual(await (await call("update/manifest",{token})).json(),{ui:null,app:null});
  const {FILES}=await harness.getWorker().getEnv();
  await FILES.put("desktop/updates/ui-test.zip","test archive");
  const bundle=await call("update/ui/test",{token});
  assert.equal(bundle.headers.get("Content-Type"),"application/zip");
  assert.equal(await bundle.text(),"test archive");
  for(const route of ["update/manifest","update/ui/test"]){
    const denied=await harness.fetch("https://test.invalid/v1/"+route,{headers:{Origin:"https://external.invalid",Authorization:"Bearer "+token}});
    assert.equal(denied.status,403);
  }
  const site=harness.getWorker("private-notes-local");
  const web=await site.fetch("https://test.invalid/login",{method:"POST",headers:{Origin:"https://test.invalid"},body:new URLSearchParams({passcode:secrets.PASSCODE_HER}),redirect:"manual"});
  assert.equal(web.status,303);
  const webCookie=web.headers.get("Set-Cookie").split(";")[0];
  assert.equal((await site.fetch("https://test.invalid/api/session",{headers:{Cookie:webCookie}})).status,200);
  assert.equal((await call("state",{token:webCookie.slice(webCookie.indexOf("=")+1)})).status,401);
  for (const path of ["/menu","/novels","/api/session","/api/album","/admin"]) {
    for (const headers of [{Cookie:"__Host-notes="+token},{Authorization:"Bearer "+token}])
      assert.equal((await site.fetch("https://test.invalid"+path,{headers,redirect:"manual"})).status,401);
  }
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM sessions WHERE scope='desktop' AND role='her'").first()).n,1);
  assert.equal((await DB.prepare("SELECT count(*) AS n FROM sessions WHERE scope='desktop' AND role='admin'").first()).n,0);
  await DB.prepare(
    "INSERT INTO wallet_entries(kind,idempotency_key,delta,note) VALUES('adjustment','desktop-test-gift',14,'给焦糖兔的小礼物')",
  ).run();
  const state = async () => (await call("state", { token })).json();
  const initial = await state();
  assert.equal(initial.name,"焦糖兔");
  const bridgeRequest = (route, headers, body) => harness.getWorker("futari-desktop-local")
    .fetch("https://test.invalid/v1/"+route,{method:"POST",headers,body});
  const bearer = { Authorization:"Bearer "+token, "Content-Type":"application/json" };
  const nameBody = JSON.stringify({name:"糯米"});
  assert.equal((await call("rename",{body:{name:"糯米"}})).status,401);
  assert.equal((await call("rename",{token})).status,405);
  assert.equal((await bridgeRequest("rename",{...bearer,Origin:"https://test.invalid"},nameBody)).status,403);
  assert.equal((await bridgeRequest("rename",{...bearer,"Content-Type":"text/plain"},nameBody)).status,400);
  for (const body of [{},{name:14},{name:""},{name:"花\n花"},
    {name:"兔".repeat(13)},{name:"花",extra:true}])
    assert.equal((await call("rename",{token,body})).status,400);
  assert.equal((await state()).name,initial.name);
  const renameResult=await call("rename",{token,body:{name:"  糯米🐇  "}});
  assert.deepEqual(await renameResult.json(),{name:"糯米🐇"});
  const webRabbit = (route, opts={}) => site.fetch("https://test.invalid/api/rabbit/"+route,{
    ...opts,headers:{Cookie:webCookie,Origin:"https://test.invalid",...opts.headers}});
  assert.equal((await (await webRabbit("state")).json()).name,"糯米🐇");
  assert.equal((await webRabbit("rename",{method:"POST",body:new URLSearchParams({name:"团团"})})).status,200);
  assert.equal((await state()).name,"团团");
  assert.equal((await state()).balance,initial.balance);
  for (const name of ["visit", "pulse", "pet", "pet"])
    assert.equal((await call(name, { token, body: {} })).status, 200);
  assert.equal((await state()).balance, initial.balance + 1);
  const order = { item: "hay", request_id: randomUUID() };
  for (const res of await Promise.all(
    [1, 2].map(() => call("buy", { token, body: order })),
  ))
    assert.equal(res.status, 200);
  assert.equal((await state()).balance, initial.balance - 1);
  const feed = { item: "hay", request_id: randomUUID() };
  for (let i = 0; i < 2; i++)
    assert.equal((await call("feed", { token, body: feed })).status, 200);
  assert.equal((await state()).inventory.hay || 0, initial.inventory.hay || 0);
  const mail = await (await call("mail", { token })).json();
  const note = mail.letters.find((x) => x.note === "给焦糖兔的小礼物");
  assert.ok(note);
  assert.equal(
    (await call("open-letter", { token, body: { id: note.id } })).status,
    200,
  );
  assert.equal((await state()).unread, initial.unread - 1);
  const webpage=path=>site.fetch("https://test.invalid/api/rabbit/"+path,{headers:{Cookie:webCookie}});
  assert.equal((await (await webpage("mail")).json()).letters.find(n=>n.id===note.id).opened,1);
  const purchase=await site.fetch("https://test.invalid/api/rabbit/buy",{method:"POST",headers:{Cookie:webCookie,Origin:"https://test.invalid"},body:new URLSearchParams({item:"ball",request_id:randomUUID()})});
  assert.equal(purchase.status,200);assert.equal((await state()).inventory.ball,1);
  assert.equal((await call("place",{token,body:{item:"ball"}})).status,200);
    const shared=await (await webpage("state")).json();
  assert.ok(shared.placed.includes("ball"));assert.equal(shared.balance,(await state()).balance);
  for (const mode of ["day", "dusk", "night", "auto"]) {
    assert.equal((await call("atmosphere", { token, body: { atmosphere: mode } })).status, 200);
    assert.equal((await (await webpage("state")).json()).atmosphere, mode);
    assert.equal((await state()).atmosphere, mode);
  }
  assert.equal((await call("atmosphere", { token, body: { atmosphere: "fog" } })).status, 400);
  assert.equal((await bridgeRequest("atmosphere", { ...bearer, Origin: "https://test.invalid" }, '{"atmosphere":"day"}')).status, 403);
  const pixels = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAtAAAALQAQAAAACRLHoxAAAAVUlEQVR42u3BAQEAAACCIP+vbkhAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8Gj/8AAB3Rn5DAAAAABJRU5ErkJggg==",
    "base64",
  );
  const shotId = randomUUID();
  const form = new FormData();
  for (const [k, v] of Object.entries({
    id: shotId,
    captured: Date.now(),
    offset: 540,
    scene: "snow",
    light: "night",
    pose: "nap",
    title: "桌宠拍的雪夜",
  }))
    form.set(k, String(v));
  form.set("image", new Blob([pixels], { type: "image/png" }), "exposure.png");
  const wire = new Request("https://test.invalid/", { method: "POST", body: form });
  const up = await bridgeRequest(
    "album",
    {
      Authorization: "Bearer " + token,
      "Content-Type": wire.headers.get("Content-Type"),
    },
    await wire.arrayBuffer(),
  );
  assert.equal(up.status, 200, await up.clone().text());
  assert.deepEqual(await up.json(), { id: shotId, title: "桌宠拍的雪夜" });
  const deskList = await (await call("album?moment=nap", { token })).json();
  assert.equal(deskList.covers.nap, shotId);
  assert.equal(deskList.photos.length, 1);
  assert.equal(deskList.rabbitName, "团团");
  const webImg = await site.fetch("https://test.invalid/api/album/" + shotId + "/image", {
    headers: { Cookie: webCookie },
  });
  assert.equal(webImg.status, 200);
  assert.deepEqual(Buffer.from(await webImg.arrayBuffer()), pixels);
  const bridge=harness.getWorker("futari-desktop-local");
  const deskImg = await bridge.fetch("https://test.invalid/v1/album/" + shotId + "/image", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(deskImg.status, 200);
  assert.equal(deskImg.headers.get("Content-Type"), "image/png");
  assert.deepEqual(Buffer.from(await deskImg.arrayBuffer()), pixels);
  const renamed = await call("album/" + shotId + "/title", {
    token,
    body: { title: "改名后的雪夜", revision: 1 },
  });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).revision, 2);
  assert.equal(
    (await call("album/" + shotId + "/title", { token, body: { title: "旧版本", revision: 1 } })).status,
    409,
  );
  assert.equal((await call("album/" + shotId + "/delete", { token, body: { revision: 2 } })).status, 200);
  assert.equal(
    (await site.fetch("https://test.invalid/api/album/" + shotId + "/image", { headers: { Cookie: webCookie } }))
      .status,
    404,
  );
  assert.equal((await bridge.fetch("https://test.invalid/v1/state",{headers:{Cookie:webCookie}})).status,401);
  assert.equal((await bridge.fetch("https://test.invalid/v1/menu",{headers:{Authorization:"Bearer "+token}})).status,404);
  assert.equal((await call("logout", { token, body: {} })).status, 200);
  assert.equal((await call("state", { token })).status, 401);
  for (let i = 0; i < 5; i++) {
    const res = await call("session", {
      ip: "192.0.2.3",
      body: { passcode: "invalid" },
    });
    assert.equal(res.status, i === 4 ? 429 : 401);
  }
});
