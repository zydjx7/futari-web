import { h } from "../../shared/content.js";
import { servingKey, portionState, estimateLabel } from "./serving.js";

export function portions(dish,role) {
  const n=Number(dish.servings ?? 1), q=portionState(servingKey(dish),n);
  if(role!=="her") return `<span class="portion-value">${q.label}</span>`;
  return `<form method="post" action="/menu/servings" class="portion-control"><input type="hidden" name="id" value="${h(dish.id)}">
    <button name="servings" value="${q.minus}" aria-label="减少 ${q.step}"${q.minus>=n?" disabled":""}>−</button><output>${q.label}</output><button name="servings" value="${q.plus}" aria-label="增加 ${q.step}"${q.plus<=n?" disabled":""}>+</button></form>`;
}
export function budget(rows,target,day,role) {
  const chosen=rows.filter(d=>d.wanted);
  const totals={午餐:0,晚餐:0,加餐:0};
  let unknown=0;
  for(const d of chosen) {
    if(d.servings===0) continue;
    if(d.kcal===null) unknown++; else totals[d.meal]+=d.kcal*d.servings;
  }
  const used=Math.round(Object.values(totals).reduce((a,b)=>a+b,0)),left=target-used;
  const extra=rows.some(d=>d.meal==="加餐"&&d.station)?"当日供应":"加餐";
  const subtotal=`午餐约 ${Math.round(totals.午餐)} kcal · 晚餐约 ${Math.round(totals.晚餐)} kcal`+(chosen.some(d=>d.meal==="加餐")?` · ${extra}约 ${Math.round(totals.加餐)} kcal`:"");
  return `<section class="kcal-card" data-budget data-target="${target}" data-day="${day}" data-role="${role}"><header><h2>今日热量参考</h2>
    <details class="target-edit"><summary>调整参考值</summary><form method="post" action="/menu/target"><input type="hidden" name="day" value="${day}">
    <label>每日参考（kcal）<input name="target" type="number" min="800" max="4000" step="1" value="${target}" required></label>
    <div>${[1500,1600,1700].map(n=>`<button name="preset" value="${n}" class="subtle">${n}</button>`).join("")}<button class="primary">保存</button></div></form></details></header>
    <div class="kcal-values"><span>今日参考 <strong data-target-label>${target.toLocaleString("en-US")} kcal</strong></span><span>已选估算 <strong data-used>${used} kcal</strong></span></div>
    <progress data-kcal-bar aria-label="已选热量占参考值" max="${target}" value="${Math.min(used,target)}"${left<0?" data-over":""}></progress>
    <div class="kcal-left" data-left>${left>=0?`还可以选约 ${left} kcal`:`已高于参考值约 ${-left} kcal，吃饱吃开心最重要`}</div>
    <div class="kcal-sub" data-subtotals>${subtotal}</div><small data-unknown${unknown?"":" hidden"}>另含 ${unknown} 道未标热量</small>
    <small class="kcal-reference">参考区间 1,500–1,700 kcal · 基础代谢估算约 1,230 kcal</small>
    <details class="selected-dishes"><summary>今日已选清单 <span data-picked-count>(${chosen.length})</span></summary>
    <ul data-selected>${chosen.map(d=>`<li><span>${h(d.name)} <small>${d.meal==="加餐"?extra:d.meal}</small><span class="selected-estimate">${estimateLabel(servingKey(d),d.servings,d.kcal)}</span></span>${portions(d,role)}</li>`).join("")}</ul>
    <span data-none-picked${chosen.length?" hidden":""}>今天还没有选菜。</span></details><output class="form-error" data-budget-error role="status"></output>
    <template data-portions-template>${portions({id:"",servings:1},role)}</template></section>`;
}
