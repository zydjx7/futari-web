import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, files, secrets, request, signIn } from "./support.mjs";
import { archives } from "../src/modules/rabbit/downloads.js";
import { desktopCard } from "../src/modules/rabbit/download-card.client.js";

test("下载卡只显示就绪平台，电脑优先本机版本，手机仅提示", () => {
  const el=(tag,text)=>({tag,text,children:[], append(...nodes){this.children.push(...nodes);}});
  const data=Object.fromEntries(Object.entries(archives).map(([id,key])=>[id,{ready:true,size:1024,url:"/api/files/"+key}]));
  const render=(packs,userAgent,platform="",maxTouchPoints=0)=>desktopCard(packs,el,{userAgent,platform,maxTouchPoints});
  assert.equal(render({}, "Windows"),null);
  for(const [ua,id] of [["Windows","windows"],["Macintosh","macos"]]){
    const links=render(data,ua).children.filter(n=>n.tag==="a");
    assert.equal(links.length,2);
    assert.equal(links[0].href,data[id].url);
  }
  for(const mobile of [render(data,"iPhone"),render(data,"Macintosh","MacIntel",5)]){
    assert.ok(mobile.children.some(n=>n.text.includes("电脑浏览器")));
    assert.ok(!mobile.children.some(n=>n.tag==="a"));
  }
  assert.equal(render({windows:data.windows},"Macintosh").children.find(n=>n.tag==="a").href,data.windows.url);
});

test("兔窝私有下载按包就绪，直接链接沿用相同权限", async () => {
  await setup();
  const her = await signIn(secrets.PASSCODE_HER), admin = await signIn(secrets.PASSCODE_ADMIN);
  const api = "/api/rabbit/downloads", link = "/api/files/" + archives.windows;
  for (const url of [api, link]) {
    assert.equal((await request(url)).status, 401);
    assert.equal((await request(url, { headers: admin })).status, 403);
  }
  const list = async () => (await request(api, { headers: her })).json();
  assert.equal((await list()).windows.ready, false);
  const bytes = Uint8Array.of(80, 75, 3, 4);
  await files.put(archives.windows, bytes, { httpMetadata: {contentType:"application/zip"} });
  const catalog = await list();
  assert.deepEqual(catalog.windows, {ready:true,size:4,url:link});
  assert.deepEqual(catalog.macos, {ready:false,size:0,url:null});
  const zip = await request(link, {headers:her});
  assert.equal(zip.headers.get("Content-Type"), "application/zip");
  assert.deepEqual(new Uint8Array(await zip.arrayBuffer()),bytes);
  assert.equal((await request("/api/files/%64ownloads%2fFUTARI-Desktop-Windows-x64.zip",{headers:admin})).status,403);
});
