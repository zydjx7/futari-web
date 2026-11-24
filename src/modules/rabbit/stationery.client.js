export const icons = {
  hay: 0,
  carrot: 1,
  ball: 2,
  bed: 3,
  acorn: 4,
  letter: 5,
  snow: 6,
  basket: 7,
  store: 8
};
const goods = ["dandelion", "apple", "strawberry", "applewood", "bell", "toastbed", "knitbed", "mat", "teaset", "lantern"];
let goodsSheet;
export function loadGoods() {
  if (!goodsSheet) {
    goodsSheet = new Image();
    goodsSheet.crossOrigin = "anonymous";
    goodsSheet.src = new URL("./art/goods.webp", import.meta.url).href;
  }
  return goodsSheet;
}
export const stories = {
  dandelion: "晒干的鹅黄花瓣还带着草坡的风。它凑近闻了又闻，先咬住最圆的那一朵。",
  apple: "切得薄薄的，果心像一枚小星星。嚼起来咔嚓咔嚓，耳朵都跟着轻轻晃。",
  strawberry: "粉扑扑的一小颗，甜味藏不住。吃完了，它还会把小鼻尖舔得干干净净。",
  applewood: "用细麻绳串起几截带皮的苹果枝。无聊的时候啃两下，木头清香就散开了。",
  bell: "风一过，小铜铃就轻轻晃。没有吵人的响声，只有它竖起耳朵歪着头看。",
  toastbed: "烤得蓬松焦黄的厚吐司，中间压出一块软软的奶油凹陷。它一揣爪窝上去，就像一块刚出炉的小吐司。",
  knitbed: "粗毛线一圈圈织得厚实，里头垫着蓬松的羊羔绒。冬天窝进这里，只肯露出两只小耳朵。",
  mat: "细细密密编出来的干草香气。趴上去凉丝丝的，四只小脚总忍不住往外伸长。",
  teaset: "矮木墩上温着一杯洋甘菊茶。它踮起后脚悄悄张望，好像也在等下午三点。",
  lantern: "吹制玻璃罩像一朵胖乎乎的小蘑菇。天暗下来以后，整个窝里都沾上一层蜂蜜色。",

  bowl: "把今天的小零嘴放进盆里，等它凑过来吃。",
  tunnel: "圆木桶里藏得下整只兔子，偶尔能看见两只耳朵探出来。",
  hay: "草尖还藏着午后的太阳味。最嫩的那一根，它总要留到最后。",
  carrot: "脆生生的一小口，两边的腮帮就轮流鼓起来了。",
  ball: "柳条绕了一圈又一圈。轻轻推给它，圆球便从爪尖滚走。",
  bed: "亚麻边边刚好托住下巴。它有时把脸埋进去，只肯留个圆屁股给你。"
};
export function icon(name) {
  const i = document.createElement("i");
  i.className = "book-icon";
  i.setAttribute("aria-hidden", "true");
  if (name === "camera" || name === "album") {
    i.classList.add("photo-icon");
    i.style.backgroundPosition = name === "album" ? "100% 0" : "0 0";
    return i;
  }
  const ix = goods.indexOf(name);
  if (ix >= 0) {
    i.classList.add("goods-icon");
    i.style.backgroundPosition = (ix % 4 * 100 / 3) + "% " + Math.floor(ix / 4) * 50 + "%";
    return i;
  }
  const cell = icons[name];
  i.style.backgroundPosition = (cell % 3) * 50 + "% " + Math.floor(cell / 3) * 50 + "%";
  return i;
}
export function paintIcon(c, sheet, name, x, y, size) {
  const ix = goods.indexOf(name);
  if (ix >= 0) {
    loadGoods();
    if (goodsSheet.naturalWidth) {
      const side = goodsSheet.naturalWidth / 4;
      c.drawImage(goodsSheet, ix % 4 * side, Math.floor(ix / 4) * side, side, side, x-size/2, y-size/2, size, size);
    }
    return;
  }
  const n = icons[name],
    cell = (sheet.naturalWidth || sheet.width) / 3;
  c.drawImage(
    sheet,
    (n % 3) * cell,
    Math.floor(n / 3) * cell,
    cell,
    cell,
    x - size / 2,
    y - size / 2,
    size,
    size
  );
}

// Convex outline of the opaque wicker illustration in its 144-pixel stationery cell.
// The body rotates around the woven sphere, including its small protruding willow tip.
const wickerHull = [
  [128, 26],
  [139, 50],
  [139, 51],
  [120, 104],
  [112, 117],
  [102, 129],
  [79, 140],
  [74, 141],
  [59, 141],
  [49, 139],
  [29, 130],
  [20, 123],
  [14, 114],
  [4, 94],
  [4, 72],
  [10, 54],
  [14, 47],
  [37, 24],
  [46, 19],
  [49, 18],
  [106, 2],
  [109, 2]
];
export const willowRestAngle = -0.64;
export function willowShape(x, floor, size, angle) {
  const scale = size / 144,
    cs = Math.cos(angle) * scale,
    sn = Math.sin(angle) * scale;
  const vertices = wickerHull.map(([u, v]) => [cs * (u - 64) - sn * (v - 79), sn * (u - 64) + cs * (v - 79)]);
  const y = floor - Math.max(...vertices.map((v) => v[1]));
  const edge = (dir) => {
    // Average the ends of a flat side to touch the ink rather than the corner of its box.
    const near = Math.min(...vertices.map((v) => dir * v[0]));
    const points = vertices.filter((v) => dir * v[0] <= near + size * 0.008);
    return { x: x + dir * near, y: y + points.reduce((sum, v) => sum + v[1], 0) / points.length };
  };
  return { x, y, size, angle, edge };
}
export function paintWillow(c, sheet, ball) {
  c.save();
  c.translate(ball.x, ball.y);
  c.rotate(ball.angle);
  paintIcon(c, sheet, "ball", ball.size * (0.5 - 64 / 144), ball.size * (0.5 - 79 / 144), ball.size);
  c.restore();
}

export const furnishingSize = {toastbed:.22, knitbed:.22, mat:.16, bell:.10, applewood:.08, teaset:.12, lantern:.14};
export function furnitureTask(id, visit) {
  switch(id) {
    case "toastbed": return visit % 4 === 3 ? "sploot" : "loaf";
    case "knitbed": return visit % 2 ? "flop" : "loaf";
    case "mat": return visit % 2 ? "sploot" : "flop";
    case "applewood": return {key:"sniff",follow:"nibble"};
    case "bell": return {key:visit%2?"alert":"listen",follow:"tilt"};
    case "teaset": return "stand";
    case "lantern": return visit%2?"peek":"loaf";
  }
}
export function snackTask(id){
  if(id==="dandelion") return {key:"sniff", follow:"eat"};
  return {key:"eat",follow:id==="strawberry"?"groom":id==="apple"?"apple-heart":null};
}
export function drawFurnishing(c, sheet, o, clock, light) {
  const {name,w,h}=o, age=clock-(o.touched??-10), swing=age<2?Math.exp(-2*age)*Math.sin(12*age):0;
  c.save();c.translate(o.x+w/2,o.y+h/2);
  if(name==="applewood") c.rotate(swing*.09);
  if(name==="bell" && swing){
    // Keep the wooden stand fixed. Only the string and suspended brass bell swing.
    const bellPath=()=>c.rect(-w*.15,-h*.12,w*.3,h*.39);
    c.save();c.beginPath();c.rect(-w/2,-h/2,w,h);bellPath();c.clip("evenodd");
    paintIcon(c,sheet,name,0,0,w);c.restore();
    c.save();c.translate(0,-h*.12);c.rotate(swing*.17);c.translate(0,h*.12);
    c.beginPath();bellPath();c.clip();paintIcon(c,sheet,name,0,0,w);c.restore();
  } else paintIcon(c,sheet,name,0,0,w);
  if(name==="bell" && age<2){
    c.strokeStyle="rgba(135,100,65,"+(.23*(1-age/2))+")";c.beginPath();
    c.arc(0,-h*.11,w*.24,.9,1.6);c.stroke();
  }
  if(name==="teaset" && light!=="day"){
    const t=clock%2/2;c.strokeStyle="rgba(248,227,195,"+(.34*Math.sin(t*Math.PI))+")";c.beginPath();
    c.moveTo(-w*.16,-h*(.22+t*.1));c.quadraticCurveTo(-w*.10,-h*.4,-w*(.16+.02*Math.sin(clock)),-h*(.4+t*.14));c.stroke();
  }
  if(name==="lantern" && light!=="day"){
    const glow=c.createRadialGradient(0,0,0,0,0,w*.76);
    glow.addColorStop(0,"rgba(255,195,99,"+(.23+.14*Math.abs(swing))+")");glow.addColorStop(1,"rgba(255,207,123,0)");
    c.fillStyle=glow;c.fillRect(-w,-w,2*w,2*w);
  }
  c.restore();
}
export function petals(c,x,y,size,age){
  if(age>1.5)return;
  c.save();c.fillStyle="rgba(225,192,109,"+(.6*(1-age/1.5))+")";
  for(const direction of [-1,1]){c.beginPath();c.ellipse(x+direction*size*.08*age,y-size*.1*age,size*.017,size*.008,direction*age,0,Math.PI*2);c.fill();}
  c.restore();
}
