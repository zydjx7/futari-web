import { before,test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db,origin,request,setup,signIn,secrets } from "./support.mjs";

let her,admin;
const day="2026-11-16", rice=randomUUID(), soup=randomUUID(), surprise=randomUUID(), breakfast=randomUUID();
before(async()=>{
  await setup();her=await signIn(secrets.PASSCODE_HER);admin=await signIn(secrets.PASSCODE_ADMIN);
  await db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(day).run();
  const stmt=db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,kcal,position) VALUES(?1,?2,?2,?3,?4,?5,0)");
  await db.batch([stmt.bind(rice,day,"午餐","米饭",130),stmt.bind(soup,day,"晚餐","晚餐汤",1500),stmt.bind(surprise,day,"加餐","时令菜",null),stmt.bind(breakfast,day,"早餐","旧菜",900)]);
});
const post=(path,data,h=her,json=true)=>request(path,{method:"POST",headers:{...h,Origin:origin,...(json?{Accept:"application/json"}:{})},body:new URLSearchParams(data)});
const menu=async(h=her)=>(await request("/menu?day="+day,{headers:h})).text();
test("异步和普通表单选菜、分餐、份数、未标热量、参考值与取消重置",async()=>{
  assert.match(await menu(),/1,600 kcal/);
  const add=await post("/menu/want",{id:rice,wanted:"1"});assert.equal(add.status,200);assert.equal((await add.json()).selected[0].servings,1);
  assert.equal((await post("/menu/servings",{id:rice,servings:"1.25"})).status,422);
  assert.equal((await post("/menu/servings",{id:rice,servings:"5.5"})).status,422);
  assert.equal((await post("/menu/servings",{id:rice,servings:"1.5"},admin)).status,403);
  await post("/menu/servings",{id:rice,servings:"1.5"});
  const fallback=await post("/menu/want",{id:soup,wanted:"1"},her,false);assert.equal(fallback.status,303);
  await post("/menu/want",{id:surprise,wanted:"1"});
  assert.equal((await post("/menu/want",{id:breakfast,wanted:"1"})).status,404);
  const view=await menu(admin);
  assert.match(view,/已高于参考值约 95 kcal，吃饱吃开心最重要/);
  assert.match(view,/午餐约 195 kcal · 晚餐约 1500 kcal/);assert.match(view,/另含 1 道未标热量/);
  assert.match(view,/1.5 份/);assert.doesNotMatch(view,/当日合计/);
  assert.equal((await post("/menu/target",{target:"799",day})).status,422);
  assert.equal((await post("/menu/target",{target:"1700",day},admin)).status,200);
  assert.match(await menu(),/还可以选约 5 kcal/);
  await post("/menu/want",{id:rice,wanted:"0"});assert.equal(await db.prepare("SELECT servings FROM menu_dishes WHERE id=?").bind(rice).first("servings"),1);
  assert.equal((await post("/menu/servings",{id:rice,servings:"2"})).status,409);
  assert.doesNotMatch(await (await request("/menu?day=2026-11-17",{headers:her})).text(),/data-budget data-target=/);
});
