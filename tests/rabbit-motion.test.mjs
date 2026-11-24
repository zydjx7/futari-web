import { bakeFoldStops, foldStop } from "../src/modules/rabbit/groom-bridge.client.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import art from "../src/modules/rabbit/art/action-layout.client.js";
import layout from "../src/modules/rabbit/art/layout.client.js";
import { createPaper } from "../src/modules/rabbit/scenes/paper.client.js";
import { Puppet, poseCels, readMasks, maskAt } from "../src/modules/rabbit/motion.client.js";
import { GroomPaint, groomDuration, rubbingHands, rubProgress } from "../src/modules/rabbit/groom.client.js";

import { willowShape, willowRestAngle, snackTask, furnitureTask } from "../src/modules/rabbit/stationery.client.js";

// The Worker serves browser modules under extension-mapped URLs.
const text = await readFile(new URL("../src/modules/rabbit/movement.client.js", import.meta.url), "utf8");
const motion = new URL("../src/modules/rabbit/motion.client.js", import.meta.url).href;
const { RabbitLife, hopBeat } = await import(
  "data:text/javascript;base64," +
    Buffer.from(text.replace('"./motion.js"', JSON.stringify(motion))).toString("base64")
);

function world(t, contacts = []) {
  t.mock.method(globalThis, "matchMedia", () => ({ matches: true }));
  return new RabbitLife(createPaper(), (...point) => contacts.push(point));
}
if (!globalThis.matchMedia) globalThis.matchMedia = () => ({ matches: false });

test("摸头压耳保留椭圆眼，端坐与压耳都能自然眨眼", (t) => {
  const rig = new Puppet(null, layout, art);
  const life = world(t);
  const ctx = { globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {}, rotate() {} };
  for (const press of [0, 1]) {
    for (const blink of [0, 1]) {
      const eyes = [];
      rig.part = (_, name) => { if (/Eye$|Lid$/.test(name)) eyes.push(name); };
      rig.front(ctx, { ...life.pose(), action: press ? "pet" : "idle", press, blink });
      const part = blink ? "Lid" : "Eye";
      assert.deepEqual(eyes, ["fLeft" + part, "fRight" + part]);
    }
  }
});

test("两种蹬跃原地蓄力，前爪先着地，后脚收回后停止水平位移", (t) => {
  for (const distance of [0.04, 0.35]) {
    const contacts = [],
      life = world(t, contacts);
    life.face = { view: "side", dir: 1 };
    life.go(life.x + distance, life.y);
    const s = life.state;
    assert.equal(s.kind, "hop");
    assert.equal(s.gait, distance < 0.05 ? "short" : "bound");
    const sample = (phase) => life.update(phase * s.duration - s.age);
    sample(0.219);
    assert.equal(life.x, s.x0);
    assert.equal(life.pose().height, 0);
    sample(0.42);
    assert.ok(life.pose().height > 0.035);
    assert.ok(life.x > s.x0 + (s.x1 - s.x0) * 0.58);
    sample(0.619);
    assert.equal(contacts.length, 0);
    sample(0.621);
    assert.equal(life.pose().height, 0);
    assert.equal(life.pose().planted, 1);
    assert.deepEqual(
      contacts.map((c) => c[5]),
      ["fore"]
    );
    sample(0.851);
    assert.deepEqual(
      contacts.map((c) => c[5]),
      ["fore", "hind"]
    );
    const planted = life.x;
    sample(0.999);
    assert.equal(life.x, planted);
    assert.ok(Math.abs(life.x - s.x1) < 1e-10);
  }
  for (let i = 1; i <= 1000; i++) assert.ok(hopBeat(i / 1000).travel >= hopBeat((i - 1) / 1000).travel);
});

test("连续远跳中嗅闻后继续赴约，打断伸展不会闪回或吞掉投喂", (t) => {
  const life = world(t);
  t.mock.method(Math, "random", () => 0.15);
  life.x = 0.08;
  life.go(0.91, 0.78, "groom");
  const states = new Set();
  for (let i = 0; i < 1800 && life.state.kind !== "groom"; i++) {
    life.update(1 / 100);
    states.add(life.state.kind);
  }
  assert.ok(states.has("sniff"));
  assert.equal(life.state.kind, "groom");
  assert.ok(Math.abs(life.x - 0.91) < 0.001);
  life.stay();
  life.issue({ key: "rest" });
  for (let i = 0; i < 4200 && life.state.kind !== "stretch"; i++) life.update(0.01);
  assert.equal(life.state.kind, "stretch");
  life.update(0.9);
  const before = life.pose().weight;
  life.issue({ key: "eat" });
  assert.equal(life.pose().weight, before);
  life.update(0.12);
  assert.ok(life.pose().weight < before);
  for (let i = 0; i < 120 && life.state.kind !== "eat"; i++) life.update(0.01);
  assert.equal(life.state.kind, "eat");
  assert.equal(life.face.view, "front");
});

test("补件裁框逐件独立、透明命中掩码与尺寸匹配", () => {
  const masks = readMasks(art.hits);
  const entries = Object.entries(art.parts);
  for (const [i, [name, [x, y, w, h]]] of entries.entries()) {
    assert.ok(maskAt(masks[name], 0.5, 0.5), name);
    assert.equal(maskAt(masks[name], -0.01, 0.5), false);
    for (const [, [xx, yy, ww, hh]] of entries.slice(i + 1))
      assert.ok(x + w <= xx || xx + ww <= x || y + h <= yy || yy + hh <= y);
  }
});

test("侧睡接伸懒腰时承接躺姿，吐司醒来时双脚始终着地", (t) => {
  t.mock.method(Math, "random", () => 0.1);
  const life = world(t);
  for (const nap of ["flop", "sploot", "loaf"]) {
    life.stay();
    life.face = { view: nap === "loaf" ? "front" : "side", dir: -1 };
    life.issue({ key: nap });
    life.update(life.state.duration - 0.01);
    assert.equal(life.pose().weight, 1);
    life.update(0.011);
    if (nap === "loaf") {
      assert.equal(life.state.waking, true);
      life.update(0.24);
      assert.equal(life.pose().height, 0);
      life.update(0.25);
    }
    assert.equal(life.state.kind, "stretch");
    assert.equal(life.pose().carry, 1);
    life.update(0.24);
    assert.ok(Math.abs(life.pose().carry + life.pose().weight - 1) < 1e-12);
  }
});

test("蹬跃、伸腰与侧翻到中间时也只曝光一只兔子", (t) => {
  const life = world(t);
  const rig = new Puppet(null, { parts: {}, hits: {} }, art);
  const painted = [];
  rig.cel = (_, key) => painted.push(key);
  const ctx = { save() {}, restore() {}, transform() {} };
  const actions = {
    hop: [
      "side",
      [
        [0.16, "hopLoad"],
        [0.44, "hopAir"],
        [0.62, "hopLand"],
        [0.85, "hopGather"]
      ]
    ],
    flop: [
      "side",
      [
        [0.105, "halfRoll"],
        [0.35, "onFlank"]
      ]
    ],
    stretch: [
      "side",
      [
        [0.27, "stretchLow"],
        [0.52, "stretchYawn"]
      ]
    ]
  };
  for (const [key, [view, keys]] of Object.entries(actions)) {
    const face = { view, dir: -1 };
    for (const [phase, expected] of keys) {
      const pose = { ...life.pose(), action: key, phase, weight: 1 };
      rig.paint(ctx, face, pose);
      assert.equal(painted.pop(), expected);
    }
    for (let i = 0; i <= 200; i++) {
      const pose = { ...life.pose(), action: key, phase: i / 200, weight: Math.min(1, i / 20) };
      rig.paint(ctx, face, pose);
      assert.equal(painted.length, 1);
      painted.length = 0;
    }
  }
  assert.deepEqual(poseCels({ view: "back", dir: -1 }, { action: "hop", phase: 0.44 }), [null, null, 0]);
});

test("侧睡被叫起的侧向掉头经正面整姿，腾空时保留躯干宽度", (t) => {
  const life = world(t);
  life.face = { view: "side", dir: -1 };
  life.issue({ key: "flop" });
  life.update(life.state.duration * .4);
  life.go(.85, life.y);
  const rig = new Puppet(null, { parts: {}, hits: {} }, art);
  let width = 1;
  const poses = [];
  const ctx = { save() {}, restore() {}, scale(x) { width *= x; }, transform(x) { width *= x; } };
  rig.cel = (_, key, face) => {
    const name = key ? key + face.dir : face.view;
    if (poses.at(-1) !== name) poses.push(name);
  };
  for (let i = 0; i < 240; i++) {
    life.update(1 / 200);
    const p = life.pose();
    if (!p.turn) continue;
    width = 1;
    rig.paintTurn(ctx, p.turn, p);
    assert.ok(width >= .90, "侧面掉头不应压成薄片");
  }
  assert.deepEqual(poses, ["hopGather-1", "front", "hopGather1"]);
});

test("四个方向间的十二条转身路径，每个时刻曝光一个完整朝向并保留体宽", (t) => {
  const life = world(t), rig = new Puppet(null, {parts:{},hits:{}}, art);
  const faces = [{view:"front",dir:-1},{view:"back",dir:-1},{view:"side",dir:1},{view:"side",dir:-1}];
  let width, exposures;
  const ctx = {save(){},restore(){},scale(x){width*=x;},transform(x){width*=x;}};
  rig.cel = () => { exposures++; };
  for (const from of faces) for (const to of faces) {
    if (from===to) continue;
    life.face=from; life.aim(to,"idle");
    for (let i=0;i<=120;i++) {
      life.state.age=life.state.duration*i/120;
      const p=life.pose();
      width=1; exposures=0;
      rig.paintTurn(ctx,p.turn,p);
      assert.equal(exposures,1);
      assert.ok(width>=.90);
    }
  }
});

test("起身、弹耳以及中断收势的引导每个像素只采一张画稿", () => {
  const keys = ["idle","wash1_lift","wash2_paws","wash3_cheekUp","wash4_cheekDown","wash5_earReach","wash6_earStroke"];
  const n=6, g=Object.create(GroomPaint.prototype), used=[];
  Object.assign(g,{rig:{},guide:art.groom,fields:new Map(),geometry:{left:0,top:0,w:n,h:n},
    plate:{canvas:{},putImageData(){}},output:{width:n,height:n,data:new Uint8ClampedArray(4*n*n)}});
  g.source=key=>{
    used.push(key);
    const bytes=new Uint8ClampedArray(4*n*n).fill(35+20*keys.indexOf(key||"idle"));
    for(let i=3;i<bytes.length;i+=4) bytes[i]=255;
    return bytes;
  };
  const ctx={drawImage(){}};
  for(const pair of Object.keys(art.groom.fields)) {
    const names=pair.split("/").map(k=>k==="idle"?null:k);
    for(const [a,b] of [names,[names[1],names[0]]]) for(const t of [.25,.5,.75]){
      used.length=0; g.draw(ctx,a,b,t,0);
      assert.deepEqual(used,[t<.5?a:b]);
      const value=35+20*keys.indexOf(used[0]||"idle");
      assert.ok(g.lastMask.data.every((v,i)=>v===(i%4===3?255:value)));
    }
  }
  for(const release of [.1,.35,.8]){
    used.length=0; g.draw(ctx,keys[5],keys[2],.41,release);
    assert.equal(used.length,1);
  }
});

test("侧睡自然醒和被叫起都先半翻身，向右移动后吐司仍向左舒展", (t) => {
  t.mock.method(Math, "random", () => 0.1);
  const life = world(t);
  const seen = (n) => {
    const result = [];
    for (let i=0;i<n;i++) {
      const [a,b,t]=poseCels(life.face,life.pose());
      const current=t<.5?a:b;
      if(result.at(-1)!==current)result.push(current);
      life.update(.005);
    }
    return result;
  };
  for(const interrupt of [false,true]){
    life.stay();life.face={view:"side",dir:1};life.issue({key:"flop"});
    life.update(interrupt ? .9 : life.state.duration-.005);
    if(interrupt)life.go(.85,life.y);
    const order=seen(interrupt?55:98);
    const expected=["onFlank","halfRoll",interrupt?"hopGather":"stretchLow"];
    assert.deepEqual(order.slice(0,3),expected);
  }
  life.stay();life.face={view:"front",dir:1};life.issue({key:"loaf"});
  life.update(life.state.duration+.001);
  assert.equal(life.state.to.dir,-1);
  life.update(.481);
  assert.deepEqual(life.face,{view:"side",dir:-1});
});

test("两次离地抛物线之间在木桶内转正、探头停留，前后脚都回到地面", (t) => {
  const life=world(t);
  life.issue({key:"tunnel"});life.update(.60);
  assert.equal(life.state.kind,"tunnel");assert.equal(life.face.view,"back");
  const at = (sec) => { life.update(sec-life.state.age); return life.pose(); };
  assert.equal(life.state.duration,3.68);
  assert.ok(at(.12).squash > .05); assert.equal(at(.24).height,0);
  const entry=at(.58);
  assert.ok(Math.abs(entry.height-.12)<1e-6 && entry.rear>.90 && !entry.turn);
  assert.ok(at(.96).impact > .5);
  assert.ok(at(1.31).turn);
  for (const sec of [1.86,2.15,2.65]) {
    const peek=at(sec);
    assert.equal(peek.turn,null);assert.equal(life.face.view,"front");
    assert.equal(peek.inside,1);assert.equal(peek.tunnelPeek,1);
  }
  assert.ok(at(2.76).squash > .05);
  assert.ok(Math.abs(at(3.18).height-.135)<1e-6);
  const end=at(3.67);assert.equal(end.inside,0);assert.equal(end.height,0);assert.equal(life.face.view,"front");
});

test("三种自然醒各抽一次，直接起身与偶发伸腰都回到相应朝向的端坐", (t) => {
  let draw = 0;
  t.mock.method(Math,"random",() => draw);
  const life = world(t);
  for (const [rest,chance] of [["loaf",.30],["sploot",.65],["flop",.80]]) {
    for (const shouldStretch of [false,true]) {
      draw = chance + (shouldStretch ? -1e-6 : 1e-6);
      life.stay();
      life.face = {view:rest === "loaf" ? "front" : "side",dir:1};
      life.issue({key:rest});
      life.update(life.state.duration);
      const visited = new Set(), exposure = [];
      for(let i=0;i<320;i++) {
        const [a,b,mix] = poseCels(life.face,life.pose()), key=mix<.5?a:b;
        if (key!==exposure.at(-1)) exposure.push(key);
        visited.add(life.state.kind);
        if (life.state.kind==="idle") break;
        life.update(1/60);
      }
      assert.equal(visited.has("stretch"),shouldStretch,rest);
      assert.equal(visited.has("groom"),false);
      assert.equal(life.state.kind,"idle");
      assert.equal(life.face.view,rest==="loaf" && !shouldStretch ? "front" : "side");
      if (rest==="flop") assert.deepEqual(exposure.slice(0,3),["onFlank","halfRoll",shouldStretch?"stretchLow":"hopGather"]);
    }
  }
  life.stay();life.face={view:"side",dir:-1};life.issue({key:"flop"});
  draw=.95;life.update(life.state.duration);life.update(.16);
  const held=life.pose().phase;
  life.issue({key:"pet"});assert.equal(life.pose().phase,held);
  for(let i=0;i<95 && life.state.kind!=="pet";i++)life.update(1/60);
  assert.equal(life.state.kind,"pet");

});

test("凝听持续 2.1 秒，停住头部时耳尖独立微动，并在半秒内柔和归位", (t) => {
  const life=world(t);life.issue({key:"listen"});
  assert.equal(life.state.duration,2.10);
  const sample=age=>{life.state.age=age;return life.pose();};
  assert.ok(sample(.15).tilt>0 && sample(.15).tilt<12.5);
  for(const age of [.28,.6,1.02,1.42])assert.equal(sample(age).tilt,12.5);
  assert.ok(sample(1.02).ear-sample(.60).ear>2.5);
  const levels=[1.60,1.73,1.86,1.98,2.10].map(t=>sample(t).tilt);
  assert.ok(levels.every((v,i)=>!i||v<levels[i-1]));
  assert.equal(levels.at(-1),0);
});

test("两脚站岗经独立窄脚半起身，停稳张望两秒半，中断沿原高度回落", (t) => {
  const life=world(t);
  life.issue({key:"stand"});
  assert.equal(life.state.duration,3.5);
  const sequence=[];
  for(let i=0;i<=210;i++){
    const p=life.pose(),[a,b,mix]=poseCels(life.face,p), exposure=mix<.5?a:b;
    if (sequence.at(-1)!==exposure) sequence.push(exposure);
    if(i>=33 && i<=182) assert.equal(p.standRise,1);
    life.update(1/60);
  }
  assert.deepEqual(sequence,[null,"standHalf","stand","standHalf",null]);
  assert.ok(art.layers.pieces.standHalf.length>0);
  assert.equal(art.frames.stand.height,270);
  for(const at of [.17,.51,1.52,3.46]){
    life.stay();life.issue({key:"stand"});life.update(at);
    const rise=life.pose().standRise;
    life.issue({key:"pet"});
    assert.equal(life.pose().standRise,rise);
    let prev=rise;
    while(life.state.kind==="stand"){
      assert.ok(life.pose().standRise<=prev+1e-8);
      prev=life.pose().standRise;life.update(1/60);
    }
    assert.equal(life.state.kind,"pet");
  }
});

test("洗脸舒缓连搓两轮、单侧顺耳，身体与右臀始终对齐正面坐姿", (t) => {
  const life = world(t);
  const rig = new Puppet(null, { parts: {}, hits: {} }, art);
  life.issue({ key: "groom" });
  const duration = life.state.duration;
  assert.ok(duration >= 5.6 && duration <= 5.9);
  const lift = "wash1_lift", paw = "wash2_paws", up = "wash3_cheekUp", down = "wash4_cheekDown";
  const reach = "wash5_earReach", stroke = "wash6_earStroke";
  const mid="wash_earMid";
  const sequence = [null, lift, down, paw, up, down, mid, reach, stroke, reach, mid, down, lift, null];
  const contacts=[null,lift,paw,up,down,reach,stroke,mid];
  const seen = [];
  for (let i = 0; i <= Math.ceil(duration*100)+1; i++) {
    const p = life.pose();
    const [a,b,mix] = poseCels(life.face, p);
    const current = mix < .5 ? a : b;
    if (seen.at(-1) !== current) seen.push(current);
    if (a !== b) {
      const f = (a || "idle") + "/" + (b || "idle"), r = (b || "idle") + "/" + (a || "idle");
      const i=contacts.indexOf(a),j=contacts.indexOf(b);
      assert.ok((foldStop(i)!==undefined && foldStop(j)!==undefined) || art.groom.bridges.tri[i+"/"+j] || art.groom.bridges.tri[j+"/"+i] ||
        art.groom.fields[f] || art.groom.fields[r],f);
    }
    if (current) for (const dir of [-1,1]) {
      const g = rig.geometry(current, {view:"front",dir}, p);
      assert.deepEqual([g.mirror,g.sx,g.sy,g.lean,g.dx],[1,1,1,0,0]);
      assert.equal(g.w,264);
      assert.equal(g.h,264);
      assert.ok(Math.abs(g.left + 264*123.75/252)<1e-9 && Math.abs(g.top + 264*249.75/252)<1e-9);
    }
    life.update(.01);
  }
  assert.deepEqual(seen,sequence);
  const wrists=[];
  for(let i=0;i<Math.floor(duration*60);i++){
    const u=rubProgress(i/60/groomDuration);
    if(u===null)continue;
    assert.deepEqual(poseCels({view:"front",dir:-1},{action:"groom",phase:i/60/groomDuration}),[up,up,0]);
    wrists.push(rubbingHands(u));
  }
  assert.equal(wrists.length,109);
  assert.ok(Math.abs(rubProgress(2.64/duration)-.5)<1e-9);
  for(const hand of [0,1]){
    const a=wrists.map(pair=>Math.abs(pair[hand].angle));
    assert.equal(a.filter((v,i)=>i>0&&v>.70&&v>a[i-1]&&v>a[i+1]).length,2);
    for(let i=1;i<a.length;i++)assert.ok(Math.abs(a[i]-a[i-1])<.070);
  }
  assert.ok(art.layers.pieces.left.length && art.layers.pieces.right.length && art.layers.pieces.chest.length);
  assert.equal(life.state.kind,"idle");
  life.issue({key:"groom"});
  life.update(.72);
  const frozen = life.pose().phase;
  life.issue({key:"pet"});
  life.update(.11);
  assert.equal(life.pose().phase,frozen);
  assert.ok(life.pose().groomRelease>0 && life.pose().groomRelease<1);
  life.update(.22);
  assert.equal(life.state.kind,"pet");
});

test("洗脸只抬坐姿的那一对前爪，顺耳时耳尖来到短爪旁", () => {
  const { arms } = art.groom;
  const density = art.parts.wash1_lift[2] / 252;
  for (const [i, key] of ["idle", "wash1_lift", "wash2_paws", "wash3_cheekUp", "wash4_cheekDown",
    ].entries()) {
    assert.equal(arms[key].length, 2);
    for (const paw of arms[key]) {
      assert.ok(i === 0 ? paw.center[1] > 230*density : paw.center[1] < 200*density, key);
      assert.ok(paw.paint.length > 0);
    }
  }
  // A moving forepaw must not pick up the stationary chin stroke in these two chest poses.
  for (const [key, chinY] of [["wash1_lift", 153], ["wash4_cheekDown", 152]]) {
    for (const paw of arms[key]) {
      assert.ok(paw.edge.every(([, y]) => y > chinY*density), key);
    }
  }
  const back=new Uint8ClampedArray(384*384*4);
  for(let y=83;y<376;y++)for(let x=40;x<336;x++){
    const n=4*(y*384+x);back.set([190+x%43,110+y%39,78,255],n);
  }
  const rub=back.slice(),down=back.slice();
  for(let y=25;y<91;y++)for(let x=190;x<245;x++)rub.set([223,145,128,255],4*(384*y+x));
  for(let y=240;y<303;y++)for(let x=165;x<230;x++)down.set([240,206,159,255],4*(384*y+x));
  const stops=bakeFoldStops(rub,back,down,art.groom.bridges.poses.wash4_cheekDown);
  for(const pixels of stops){
    assert.deepEqual(pixels.subarray(4*384*305),rub.subarray(4*384*305));
    for(let row=95;row<230;row++)assert.deepEqual(
      pixels.subarray(4*(384*row+80),4*(384*row+166)),rub.subarray(4*(384*row+80),4*(384*row+166)));
  }
  assert.notDeepEqual(stops[0],stops[2]);
  assert.ok(art.groom.bridges.edits.mid.length>0);
});

test("球的左右接触点都取自实际球面，推鼻沿地面靠近两侧边缘", (t) => {
  const rig = new Puppet(null, { parts: {}, hits: {} }, art);
  const pose = { ...world(t).pose(), action: "nudge", phase: 0.42, weight: 1, push: 0, sniff: 0, breath: 0 };
  for (const size of [86, 190, 330])
    for (const dir of [-1, 1])
      for (const angle of [willowRestAngle, 1, 2.4]) {
        const radiusScale = size / 220,
          width = size * 0.27,
          ball = willowShape(410, 300, width, angle);
        const face = { view: "side", dir },
          edge = ball.edge(dir);
        const before = rig.landmark("nose", face, pose),
          after = rig.landmark("nose", face, { ...pose, push: 1 });
        const rootX = edge.x - (before.x + 3 * dir) * radiusScale;
        const ground = edge.y - before.y * radiusScale;
        assert.ok(dir * (ball.x - edge.x) > width * 0.34);
        assert.ok(dir * (edge.x - rootX - before.x * radiusScale) > 0);
        assert.ok(dir * (rootX + after.x * radiusScale - edge.x) > 0);
        assert.ok(Math.abs(ground + after.y * radiusScale - edge.y) < 0.001);
      }
});

test("角色含十八张原画与共用底稿的半弯耳画格，实测纹理在预算内", async () => {
  const sizes = await Promise.all(
    ["caramel", "actions"].map(async (id) => {
      const image = await readFile(new URL("../src/modules/rabbit/art/" + id + ".webp", import.meta.url));
      if (image.toString("ascii", 12, 16) === "VP8L") {
        assert.equal(image[20], 0x2f);
        const fields = image.readUInt32LE(21);
        return [(fields & 0x3fff) + 1, ((fields >>> 14) & 0x3fff) + 1];
      }
      assert.equal(image.toString("ascii", 12, 16), "VP8X");
      return [image.readUIntLE(24, 3) + 1, image.readUIntLE(27, 3) + 1];
    })
  );
  const bytes = sizes.reduce((n, [w, h]) => n + 4 * w * h, 0);
  assert.ok(bytes <= 8 * 1024 ** 2);
  assert.equal(Object.keys(art.frames).length, 19);
  assert.equal(art.groom.bridges.base,"wash4_cheekDown");
  assert.deepEqual([...Object.keys(art.parts),"wash_earMid"].sort(), Object.keys(art.frames).sort());
  assert.deepEqual(art.frames.wash_earMid,art.frames.wash4_cheekDown);
  assert.deepEqual(art.hits.wash_earMid.slice(0,2),[96,96]);
  const [aw, ah] = sizes[1];
  for (const [key, [x, y, w, h]] of Object.entries(art.parts)) {
    assert.ok(x >= 0 && y >= 0 && x + w <= aw && y + h <= ah, key);
    if (key.startsWith("wash")) {
      assert.deepEqual([w,h],[384,384]);
      assert.equal((art.groom.cols-1)*art.groom.step,w);
      assert.equal((art.groom.rows-1)*art.groom.step,h);
      assert.ok(Math.abs((1-art.frames[key].pivot[1])-2.25/252)<1e-10);
    }
    else assert.equal(art.frames[key].pivot[1], 1);
  }
});
test("侧面待机、转身与动作收尾都落在同一张收腿整姿", (t) => {
  const life = world(t);
  const chosen = (face, p) => {
    const [a, b, ratio] = poseCels(face, p);
    return ratio < 0.5 ? a : b;
  };
  for (const dir of [-1, 1]) {
    const face = { view: "side", dir };
    for (const key of ["idle", "turn", "sniff", "nudge", "sploot", "flop", "stretch"]) {
      for (const phase of [0, 1])
        assert.equal(chosen(face, { ...life.pose(), action: key, phase, weight: 0 }), "hopGather", key);
    }
    for (const phase of [0, 0.86, 0.96, 1]) {
      assert.equal(chosen(face, { ...life.pose(), action: "hop", phase }), "hopGather");
    }
    assert.equal(
      chosen(face, { ...life.pose(), action: "stretch", phase: 0, carry: 1, fromRest: "flop" }),
      "onFlank"
    );
  }
  const [sx, sy, pw, ph] = art.blink.skin;
  const [px, py] = art.blink.offset;
  const [gx, gy, gw, gh] = art.parts.hopGather;
  assert.ok(px >= 0 && py >= 0 && px + pw <= gw && py + ph <= gh);
  assert.ok(sx >= gx && sy >= gy && sx + pw <= gx + gw && sy + ph <= gy + gh);
  const rig = new Puppet(null, { parts: {}, hits: {} }, art);
  const hopOrder = ["hopGather", "hopLoad", "hopAir", "hopLand", "hopGather"];
  const pose = { ...life.pose(), breath: 0, ear: 0, brace: 0 };
  for (const dir of [-1, 1]) {
    const face = { view: "side", dir };
    for (let i = 1; i < hopOrder.length; i++) {
      const eye = (mix) => {
        const r = rig.register(hopOrder[i - 1], face, hopOrder[i], face, mix, pose);
        const at = rig.marker(r.key, face, pose, "eye");
        return { x: r.sx * at.x + r.lean * at.y, y: r.sy * at.y };
      };
      const a = eye(0.5 - 1e-7),
        b = eye(0.5 + 1e-7);
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 0.1, hopOrder[i]);
    }
  }
  const seen = [];
  rig.cel = (_, key, face) => seen.push([key, face.view]);
  const ctx = { save() {}, restore() {}, scale() {}, transform() {} };
  for (const view of ["front", "back", "side"]) {
    const side = { view: "side", dir: -1 },
      other = { view, dir: 1 };
    for (const [from, to] of [
      [side, other],
      [other, side]
    ]) {
      for (let i = 0; i <= 60; i++) {
        const turn = { from, to, air: i / 60, progress: i / 60 };
        rig.paintTurn(ctx, turn, { ...life.pose(), action: "turn", turn });
        assert.equal(seen.length, 1);
        const [key, drawnView] = seen.pop();
        assert.equal(key, drawnView === "side" ? "hopGather" : null);
      }
    }
  }
});

test("连续短腿蹬跃保留衔接的时间余量，终点完整收腿后才进入侧面待机", (t) => {
  t.mock.method(Math, "random", () => 0.8);
  const run = (dir) => {
    const contacts = [];
    const life = world(t, contacts);
    life.x = dir === 1 ? 0.3 : 0.7;
    life.face = { view: "side", dir };
    life.go(life.x + dir * 0.34, life.y);
    return { life, contacts };
  };
  for (const dir of [1, -1]) {
    const { life, contacts } = run(dir);
    const goal = life.trip.x,
      first = life.state;
    assert.ok(first.continues);
    life.update(first.duration * 0.9 + 0.012);
    assert.equal(life.state.kind, "hop");
    assert.notEqual(life.state, first);
    assert.ok(Math.abs(life.state.age - 0.012) < 1e-8);
    assert.equal(poseCels(life.face, life.pose())[0], "hopGather");
    assert.ok(Math.abs(life.x - first.x1) < 1e-8);
    let final;
    for (let frame = 0; frame < 400 && life.state.kind === "hop"; frame++) {
      if (!life.state.continues) final = life.state;
      life.update(1 / 120);
    }
    assert.ok(final && final.age >= final.duration);
    assert.equal(life.state.kind, "idle");
    assert.equal(life.x, goal);
    assert.deepEqual(poseCels(life.face, life.pose()), ["hopGather", "hopGather", 0]);
    assert.deepEqual(
      contacts.map((c) => c[5]),
      Array.from({ length: contacts.length }, (_, i) => (i % 2 ? "hind" : "fore"))
    );
  }
});

test("新零嘴与摆件按顺序复用动作", (t) => {
  for (const [task, first, second] of [
    [snackTask("dandelion"), "sniff", "eat"],
    [snackTask("strawberry"), "eat", "groom"],
    [furnitureTask("applewood", 0), "sniff", "nibble"],
    [furnitureTask("bell", 1), "alert", "tilt"],
  ]) {
    const life = world(t), seen = [];
    life.issue(task);
    for (let i = 0; i < 250; i++) {
      life.update(.035);
      if (seen.at(-1) !== life.state.kind) seen.push(life.state.kind);
    }
    assert.ok(seen.indexOf(first) >= 0 && seen.indexOf(second) > seen.indexOf(first), seen.join(" → "));
  }
  assert.deepEqual([0,1].map(i=>furnitureTask("knitbed",i)), ["loaf","flop"]);
  const life = world(t);life.issue(snackTask("apple"));
  let heart = false;
  for(let i=0;i<160;i++){life.update(.03);if(life.state.kind!=="eat" && life.pose().heart>.2)heart=true;}
  assert.ok(heart);
});

test("120 秒侧睡在第一秒翻到侧面，自然醒经半翻、伸腰、转正洗脸", t => {
  const life = world(t);
  t.mock.method(Math, "random", () => 2 / 3);
  life.face = { view: "side", dir: 1 };
  life.issue({ key: "flop" });
  assert.equal(life.state.duration, 120);
  const cel = () => {
    const [a, b, mix] = poseCels(life.face, life.pose());
    return mix < .5 ? a : b;
  };
  life.update(.55);
  assert.equal(cel(), "halfRoll");
  life.update(.45);
  assert.equal(cel(), "onFlank");
  life.update(119);
  const keys = [], actions = [];
  for (let i = 0; i < 550 && life.state.kind !== "groom"; i++) {
    if (keys.at(-1) !== cel()) keys.push(cel());
    if (actions.at(-1) !== life.state.kind) actions.push(life.state.kind);
    life.update(.01);
  }
  assert.deepEqual(keys.slice(0, 3), ["onFlank", "halfRoll", "stretchLow"]);
  assert.deepEqual(actions, ["stretch", "turn"]);
  assert.equal(life.state.kind, "groom");
  assert.equal(life.face.view, "front");
  life.habitat = () => ({ desktop: true });
  life.stay();
  life.begin({ key: "flop" });
  life.update(.60);
  assert.equal(life.state.duration, 150);
});

test("受惊与落地冷却只限制自主侧睡，落地先停足一秒", t => {
  const life = world(t);
  let draw = .99;
  t.mock.method(Math, "random", () => draw);
  for (const event of ["alert", "carry"]) {
    life.stay();
    life.face = { view: "front", dir: 1 };
    life.calm = 1;
    if (event === "alert") life.issue({ key: "alert" });
    else life.dropped();
    assert.equal(life.calm, event === "alert" ? .65 : .75);
    assert.equal(life.waryUntil, life.clock + (event === "alert" ? 25 : 15));
    if (event === "carry") {
      draw = .49;
      life.update(.99);
      assert.equal(life.state.kind, "landed");
      life.update(.011);
      assert.equal(life.state.kind, "groom");
    }
    life.stay();
    life.calm = 1;
    life.face = { view: "side", dir: 1 };
    life.activeLeft = 0;
    draw = .99;
    life.wander();
    assert.equal(life.state.kind, "sploot");
    life.issue({ key: "flop" });
    life.update(.24);
    assert.equal(life.state.kind, "flop");
    life.stay();
    life.update(life.waryUntil - life.clock + .01);
    life.activeLeft = 0;
    life.wander();
    assert.equal(life.state.kind, "flop");
  }
});

test("高安全感吐司在地面转成大字趴，承接满权重和连续呼吸", t => {
  const life = world(t);
  t.mock.method(Math, "random", () => .34);
  life.calm = .9;
  life.issue({ key: "loaf" });
  const { x, y } = life;
  let turning = false;
  for (let i = 0; i < 4200; i++) {
    const breath = life.pose().breath;
    life.update(.01);
    assert.ok(Math.abs(life.pose().breath - breath) < .023);
    assert.equal(life.pose().height, 0);
    assert.equal(life.x, x);
    assert.equal(life.y, y);
    if (life.state.kind === "sploot") break;
    if (life.state.kind === "turn") {
      assert.equal(life.pose().turn.waking, true);
      turning = true;
    } else assert.equal(life.state.kind, "loaf");
  }
  assert.ok(turning);
  assert.equal(life.state.kind, "sploot");
  assert.equal(life.pose().weight, 1);
});

test("三种睡姿均可在睡眠中途平滑响应摸头或喂食", t => {
  const life = world(t);
  for (const nap of ["loaf", "sploot", "flop"]) {
    for (const action of ["pet", "eat"]) {
      life.stay();
      life.face = { view: nap === "loaf" ? "front" : "side", dir: 1 };
      life.issue({ key: nap });
      life.update(life.state.duration / 2);
      const before = poseCels(life.face, life.pose());
      life.issue({ key: action });
      assert.deepEqual(poseCels(life.face, life.pose()), before);
      life.update(.12);
      assert.equal(life.state.kind, nap);
      assert.ok(life.pose().weight < 1);
      for (let i = 0; i < 100 && life.state.kind !== action; i++) life.update(.01);
      assert.equal(life.state.kind, action);
      assert.equal(life.face.view, "front");
    }
  }
});

test("连摸按十二秒窗口累计，回味后就地趴下", t => {
  t.mock.method(Math, "random", () => .5);
  for (const count of [2, 3]) {
    const life = world(t);
    for (let i = 0; i < count; i++) {
      life.issue({ key: "pet" });
      life.update(.25);
    }
    assert.equal(life.petStreak, count);
    life.update(2.26);
    assert.equal(life.state.kind, "savor");
    assert.equal(life.face.view, "front");
    assert.equal(life.state.duration, 5.5);
    life.update(5.5);
    if (count === 3) life.update(.60);
    assert.equal(life.state.kind, count === 3 ? "flop" : "loaf");
    life.update(12);
    assert.equal(life.petStreak, 0);
  }
});

test("环境决定安全感基准，缺省与空腹区分，喂食增加安全感", t => {
  const life = world(t);
  assert.equal(life.calm, .45);
  for (const [env, target] of [
    [{}, .60], [{ satiety: 0 }, .30], [{ satiety: 30, night: true }, .55],
    [{ satiety: 70, ownsBed: true, mat: {}, night: true }, .85]
  ]) {
    life.habitat = () => env;
    life.update(900);
    assert.ok(Math.abs(life.calm - target) < .0001);
  }
  life.calm = .5;
  life.issue({ key: "eat" });
  assert.ok(Math.abs(life.calm - .68) < 1e-12);
});

test("自主节奏先活动二至四次再休息，饥饿时可到碗边嗅闻抬头", t => {
  let draw = 0;
  t.mock.method(Math, "random", () => draw);
  for (const [sample, count] of [[0, 2], [.5, 3], [.99, 4]]) {
    draw = sample;
    const life = world(t);
    const tasks = [];
    life.begin = task => tasks.push(task);
    for (let i = 0; i <= count; i++) life.wander();
    assert.ok(tasks.slice(0, count).every(task => !["loaf", "sploot", "flop", "rest"].includes(task.key)
      && !["loaf", "sploot", "flop", "rest"].includes(task.after)));
    assert.ok(["loaf", "sploot"].includes(tasks.at(-1).key));
  }
  draw = .1;
  const life = world(t);
  life.habitat = () => ({ satiety: 0, bowl: { key: "go", x: .7, y: .8 } });
  life.wander();
  assert.deepEqual(life.trip.after, { key: "sniff", follow: "tilt" });
  for (let i = 0; i < 1000 && life.state.kind !== "tilt"; i++) life.update(.01);
  assert.equal(life.state.kind, "tilt");
  assert.equal(life.face.view, "front");
  assert.equal(life.x, .7);
});
