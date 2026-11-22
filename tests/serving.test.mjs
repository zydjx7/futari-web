import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db,origin,request,secrets,setup,signIn } from "./support.mjs";
import { profiles,servingKey,defaultServings,portionState,estimateLabel,density,validServings } from "../src/modules/menu/serving.js";

test("按基准单位、档口分类和菜名区分小面点、汤面、配料与计件菜",()=>{
  const samples=[
    ["花生豆浆","饮品","100 毫升","drink",200,50],["紫菜汤","汤/粥","100 克","soup",200,50],
    ["三色藜麦饭","杂粮饭","100 克","rice",100,50],["蒸红薯","杂粮","100 克","grain",100,50],
    ["鸡蛋香葱饼","面食","100 克","pastry",70,35],["土豆丝手抓饼","餐品","100 克","sandwich",150,50],
    ["香辣汤肥牛面","面食","100 克","noodles",350,50],["沙茶酱干拌吊龙米线","餐品","100 克","bowl",250,50],
    ["鲜肉虾仁水饺","餐品","100 克","dumplings",200,50],["土豆丝","配菜","100 克","side",100,50],
    ["杂粮饭","自选配料","100 克","topping",30,30],["菠菜","主荤","100 克","side",100,50],
    ["鸡蛋","蛋类","1 个（约 50 克）","piece",1,.5],["手录汤面","","","portion",1,.5]
  ];
  for(const [name,category,portion,key,start,step] of samples) {
    assert.equal(servingKey({name,category,portion,kcal:130}),key,name);
    assert.equal(profiles[key].start,start);assert.equal(profiles[key].step,step);
  }
  assert.equal(servingKey({kcal:null,portion:"100 克",name:"牛肉面"}),"portion");
  assert.equal(estimateLabel("drink",2,50),"200 ml（约 1 小杯） ≈ 100 kcal");
  assert.equal(estimateLabel("rice",1.5,130),"150 g（约 1 小碗） ≈ 195 kcal");
  assert.equal(portionState("pastry",.7).plus,1.05);
  for(const [n,label] of [[0,"轻"],[99,"轻"],[100,"中"],[200,"中"],[201,"偏高"]]) assert.equal(density("side",n).label,label);
  assert.equal(density("piece",201),null);assert.equal(density("portion",null),null);
  assert.equal(validServings("pastry",.35),true);assert.equal(validServings("pastry",1.05),true);
  for(const n of [.1,.7,2,10])assert.equal(validServings("drink",n),true);
  for(const n of [.09,.305,10.1,NaN]) assert.equal(validServings("drink",n),false);
  assert.equal(validServings("piece",.5),true);assert.equal(validServings("piece",.7),false);
});

test("每类用量都能逐步减到零，并从零按原步长增加",()=>{
  for(const [key,profile] of Object.entries(profiles)) {
    let n=defaultServings(key);
    while(n>0) {
      const next=portionState(key,n).minus;
      assert.ok(next<n && validServings(key,next),key+" at "+n);
      n=next;
    }
    assert.equal(portionState(key,0).minus,0);
    assert.equal(portionState(key,0).plus,profile.step/profile.scale);
  }
  assert.equal(portionState("rice",.1).minus,0);
  assert.equal(portionState("pastry",.4).minus,0);
  assert.equal(estimateLabel("portion",0,null),"0 份 ≈ 0 kcal");
});

let her,admin;
const previousDay="2026-11-09", previousRice=randomUUID(), unlabeled=randomUUID();
const day="2026-11-16", dishes=[
  ["花生豆浆",50,"100 毫升","午餐","drink"],["火龙果馒头",200,"100 克","晚餐","pastry"],
  ["香辣汤肥牛面",90,"100 克","晚餐","noodles"],["白米饭",130,"100 克","午餐","rice"],
  ["蜜饯",null,"100 克","加餐","portion"],["鸡蛋",75,"1 个（约 50 克）","晚餐","piece"]].map(a=>[...a,randomUUID()]);
before(async()=>{
  await setup({beforeMigration:async(file,db)=>{
    if(file!=="0014_menu_zero_servings.sql")return;
    await db.batch([
      db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(previousDay),
      db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,kcal,position,wanted,servings) VALUES(?1,?2,?2,'午餐','白米饭',130,0,1,0.1)").bind(previousRice,previousDay),
      db.prepare("INSERT INTO menu_dish_details(dish_id,station,category,portion) VALUES(?,'7F 自助餐线','主食','100 克')").bind(previousRice),
      db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,position) VALUES(?1,?2,?2,'晚餐','手录菜',1)").bind(unlabeled,previousDay)
    ]);
  }});her=await signIn(secrets.PASSCODE_HER);admin=await signIn(secrets.PASSCODE_ADMIN);
  await db.prepare("INSERT INTO menu_weeks(week) VALUES(?)").bind(day).run();
  for(const [name,kcal,portion,meal,,id] of dishes) await db.batch([
    db.prepare("INSERT INTO menu_dishes(id,week,day,meal,name,kcal,position) VALUES(?1,?2,?2,?3,?4,?5,0)").bind(id,day,meal,name,kcal),
    db.prepare("INSERT INTO menu_dish_details(dish_id,station,category,portion) VALUES(?,'16F 自助餐线','餐品',?)").bind(id,portion)]);
});
const post=(path,args,actor=her)=>request("/menu/"+path,{method:"POST",headers:{...actor,Origin:origin,Accept:"application/json"},body:new URLSearchParams(args)});
test("已想吃的历史菜可存为零，双方刷新后仍能找到，只有取消想吃才恢复起步量",async()=>{
  const quantity=async()=>db.prepare("SELECT wanted,servings FROM menu_dishes WHERE id=?").bind(previousRice).first();
  assert.deepEqual(await quantity(),{wanted:1,servings:.1});
  assert.equal((await post("servings",{id:previousRice,servings:"0"},admin)).status,403);
  await post("want",{id:unlabeled,wanted:"1"});
  await post("servings",{id:unlabeled,servings:"0"});
  const zero=await post("servings",{id:previousRice,servings:"0"});
  assert.equal(zero.status,200);
  assert.deepEqual((await zero.json()).selected,[{id:previousRice,servings:0},{id:unlabeled,servings:0}]);
  await post("want",{id:previousRice,wanted:"1"});
  for(const values of [{},{servings:""},{servings:" "},{servings:"-0.5"}]) {
    assert.equal((await post("servings",{id:previousRice,...values})).status,422);
  }
  assert.deepEqual(await quantity(),{wanted:1,servings:0});
  for(const headers of [her,admin]) {
    const $=load(await (await request("/menu?day="+previousDay+"&wanted=1",{headers})).text());
    assert.equal($("#dish-"+previousRice).attr("data-wanted"),"1");
    assert.equal($("#dish-"+previousRice+" [data-portion-note]").text(),"0 g ≈ 0 kcal");
    assert.equal($("[data-picked-count]").text(),"(2)");
    assert.equal($("[data-only-wanted] span").text(),"(2)");
    assert.equal($("[data-used]").text(),"0 kcal");
    assert.equal($("[data-unknown]").is("[hidden]"),true);
    assert.equal($("[data-selected] .selected-estimate").last().text(),"0 份 ≈ 0 kcal");
  }
  const adjusted=await post("servings",{id:previousRice,servings:"0.5"});
  assert.equal((await adjusted.json()).selected[0].servings,.5);
  await post("servings",{id:previousRice,servings:"0"});
  await post("want",{id:previousRice,wanted:"0"});
  assert.deepEqual(await quantity(),{wanted:0,servings:1});
  assert.equal((await post("servings",{id:previousRice,servings:"0"})).status,409);
});

test("点选起步、连续调整、重试与取消，SSR、JSON 和双方总量一致",async()=>{
  for(const [,,,,key,id] of dishes) {
    const r=await post("want",{id,wanted:"1"});assert.equal(r.status,200);
    const pick=(await r.json()).selected.find(s=>s.id===id);assert.equal(pick.servings,defaultServings(key));
  }
  const bun=dishes[1][5], rice=dishes[3][5];
  assert.equal((await post("servings",{id:bun,servings:"1.05"})).status,200);
  assert.equal((await post("servings",{id:rice,servings:"1.5"})).status,200);
  await post("want",{id:rice,wanted:"1"});
  for(const h of [her,admin]) {
    const raw=await (await request("/menu?day="+day,{headers:h})).text();
    for(const text of ["200 ml（约 1 小杯） ≈ 100 kcal","105 g ≈ 210 kcal","350 g（1 碗少喝汤） ≈ 315 kcal",
      "150 g（约 1 小碗） ≈ 195 kcal","1 个 ≈ 75 kcal","午餐约 295 kcal · 晚餐约 600 kcal","另含 1 道未标热量"]) assert.ok(raw.includes(text),text);
  }
  assert.equal((await post("servings",{id:bun,servings:"0.333"})).status,422);
  assert.equal((await post("servings",{id:bun,servings:"0.35"},admin)).status,403);
  await post("want",{id:bun,wanted:"0"});assert.equal(await db.prepare("SELECT servings FROM menu_dishes WHERE id=?").bind(bun).first("servings"),.7);
  assert.equal((await post("servings",{id:bun,servings:"0.35"})).status,409);
  await post("want",{id:bun,wanted:"1"});
  assert.equal(await db.prepare("SELECT servings FROM menu_dishes WHERE id=?").bind(bun).first("servings"),.7);
});
