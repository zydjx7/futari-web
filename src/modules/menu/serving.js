// Quantities are kept in g/ml (or half pieces/portions) until crossing the D1 multiplier boundary.
const weight = (start,step,hint,unit="g") => ({unit,start,step,hint,scale:100,min:10,max:1000});
const counted = unit => ({unit,start:1,step:.5,hint:"",scale:1,min:.5,max:5});
export const profiles = {
  portion:counted("份"), piece:counted("个"),
  drink:weight(200,50,"约 1 小杯","ml"), soup:weight(200,50,"约 1 小碗"),
  rice:weight(100,50,"约小半碗"), grain:weight(100,50,"约 1 块"),
  pastry:weight(70,35,"约 1 小个"), sandwich:weight(150,50,"约 1 个"),
  noodles:weight(350,50,"1 碗少喝汤"), bowl:weight(250,50,"约 1 小份"),
  dumplings:weight(200,50,"约 10 个"), side:weight(100,50,"约 1 小份"),
  topping:weight(30,30,"约 1 小勺")
};

export function servingKey({kcal,portion="",name="",category="",station=""}) {
  const base=(portion || "").trim();
  if (/^1\s*个(?:\s*[（(].*[）)])?$/.test(base)) return "piece";
  if (kcal==null) return "portion";
  if (/^100\s*毫升$/.test(base)) return "drink";
  if (!/^100\s*克$/.test(base)) return "portion";
  if (/小咸菜|自助配料|自选配料/.test(category) || /^(小咸菜|自助配料|自选配料)$/.test(name)) return "topping";
  if (/手抓饼|三明治|披萨|比萨|汉堡|鸡肉卷/.test(name)) return "sandwich";
  if (/馒头|花卷|发糕|松糕|南瓜饼|鸡蛋.*饼|包子|[肉蛋菜]包$/.test(name)) return "pastry";
  if (/拌面|干拌|麻辣拌|盖饭|煲仔饭|烤鸡饭|烩饭|乱炖|能量碗|轻食沙拉/.test(name)) return "bowl";
  if (/(汤.*面|牛肉面|肥牛面|汤面|米线|泡馍|麻辣烫|汤米粉)|面$/.test(name)) return "noodles";
  if (/水饺|云饺|云吞|抄手|馄饨|蒸饺/.test(name)) return "dumplings";
  if (/汤|粥|流食/.test(category) || /瓦罐汤|[汤粥]$/.test(name)) return "soup";
  if (/白米饭|杂粮饭/.test(name) || category==="杂粮饭") return "rice";
  if (category==="杂粮" || /^(?:蒸)?(?:小?土豆|红薯|蜜薯|玉米|(?:贝贝|板栗)?南瓜|小?芋头)$/.test(name)) return "grain";
  if (category==="面食") return "pastry";
  if ((/沙拉/.test(name) && /轻食|套餐/.test(station+" "+category)) || (/餐品|主菜|套餐/.test(category) && /饭$/.test(name))) return "bowl";
  return "side";
}

export function defaultServings(key) {
  const p=profiles[key];
  return p.start/p.scale;
}
export function validServings(key,n) {
  if (n===0) return true;
  const p=profiles[key], raw=n*p.scale;
  if (!Number.isFinite(n) || raw<p.min || raw>p.max) return false;
  if (p.scale===1) return Number.isInteger(n*2);
  const amount=Math.round(raw);
  // A half 70 g bun is 35 g, so this profile also accepts half-tenths.
  return Math.abs(raw-amount)<1e-7 && amount%(key==="pastry"?5:10)===0;
}
export function portionState(key,n) {
  const p=profiles[key], amount=p.scale===1?n:Math.round(n*p.scale);
  const less=amount-p.step;
  const hint=amount===p.start?p.hint:key==="rice"&&amount===150?"约 1 小碗":key==="pastry"&&amount===35?"约半个":"";
  return {label:amount+" "+p.unit, hint, step:p.step+" "+p.unit,
    minus:less<p.min?0:less/p.scale,plus:Math.min(p.max,amount+p.step)/p.scale};
}
export function estimateLabel(key,n,kcal) {
  const {label,hint}=portionState(key,n);
  if (n===0) return label+" ≈ 0 kcal";
  return label+(hint?"（"+hint+"）":"")+(kcal==null?" · 热量未标":" ≈ "+Math.round(kcal*n)+" kcal");
}
export function density(key,kcal) {
  if (profiles[key].scale!==100 || kcal==null) return null;
  if (kcal<100) return {tone:"light",label:"轻"};
  return kcal<=200?{tone:"medium",label:"中"}:{tone:"high",label:"偏高"};
}
