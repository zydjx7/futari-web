import { profiles, defaultServings, portionState, estimateLabel } from "/app/serving.js";

export function initCalories(card,menu,applyFilters) {
  const rows=new Map([...menu.querySelectorAll("li[data-wanted]")].map(li=>[li.id.slice(5),{
    li, name:li.querySelector(".dish-title").firstChild.textContent, meal:li.closest(".meal").dataset.meal,
    key:li.dataset.serving, energy:li.dataset.kcal===""?null:Number(li.dataset.kcal)
  }]));
  let chosen=new Map([...rows].filter(([,r])=>r.li.dataset.wanted==="1").map(([id,r])=>[id,Number(r.li.dataset.servings)]));
  let target=Number(card.dataset.target), sending=false;
  const pending=[], template=card.querySelector("[data-portions-template]");
  const set=(selector,text)=>{card.querySelector(selector).textContent=text;};
  function portionControl(id,n) {
    const q=portionState(rows.get(id).key,n);
    const node=template.content.firstElementChild.cloneNode(true);
    if(node.matches("form")) {
      node.elements.id.value=id;node.querySelector("output").textContent=q.label;
      const [minus,plus]=node.querySelectorAll("button");
      minus.value=q.minus;minus.disabled=q.minus>=n;minus.setAttribute("aria-label","减少 "+q.step);
      plus.value=q.plus;plus.disabled=q.plus<=n;plus.setAttribute("aria-label","增加 "+q.step);
    } else node.textContent=q.label;
    return node;
  }
  function draw() {
    const selected=new Map(chosen);
    let goal=target;
    for(const item of pending) {
      if(item.kind==="target") goal=item.value;
      else if(item.kind==="want") {if(item.value)selected.set(item.id,selected.get(item.id)??defaultServings(rows.get(item.id).key));else selected.delete(item.id);}
      else if(selected.has(item.id)) selected.set(item.id,item.value);
    }
    let sum=0,unknown=0,extra="";
    const totals=new Map(), list=document.createDocumentFragment();
    for(const [id,row] of rows) {
      const n=selected.get(id), on=n!==undefined, el=row.li;
      const initial=defaultServings(row.key);
      if(el.dataset.wanted!==String(+on) || (on && Number(el.dataset.servings)!==n)) {
        el.dataset.wanted=String(+on);el.dataset.servings=n??initial;
        const wish=el.querySelector(".wish");
        if(wish){wish.setAttribute("aria-pressed",String(on));wish.form.elements.wanted.value=on?"0":"1";}
        else if(card.dataset.role==="admin") {
          const mark=el.querySelector(".wish-mark");
          if(on && !mark) {
            const label=document.createElement("span");label.className="wish-mark";label.textContent="她想吃";el.querySelector(".dish-actions").prepend(label);
          } else if(!on) mark?.remove();
        }
        el.querySelector("[data-row-portions]").replaceChildren(...(on?[portionControl(id,n)]:[]));
        el.querySelector("[data-portion-note]").textContent=on?estimateLabel(row.key,n,row.energy):
          profiles[row.key].scale===100?"起步 "+portionState(row.key,initial).label:"";
      }
      if(!on)continue;
      const kcal=(row.energy || 0)*n;
      sum+=kcal;if(row.energy===null && n>0)unknown++;
      totals.set(row.meal,(totals.get(row.meal)||0)+kcal);
      if(!["午餐","晚餐"].includes(row.meal))extra=row.meal;
      const item=document.createElement("li"),name=document.createElement("span"),meal=document.createElement("small");
      const estimate=document.createElement("span");estimate.className="selected-estimate";estimate.textContent=estimateLabel(row.key,n,row.energy);
      meal.textContent=row.meal;name.append(row.name+" ",meal,estimate);item.append(name,portionControl(id,n));list.append(item);
    }
    const used=Math.round(sum),left=goal-used;
    set("[data-used]",used+" kcal");set("[data-target-label]",goal.toLocaleString("en-US")+" kcal");
    set("[data-left]",left>=0?"还可以选约 "+left+" kcal":"已高于参考值约 "+(-left)+" kcal，吃饱吃开心最重要");
    set("[data-subtotals]",["午餐","晚餐",...(extra?[extra]:[])].map(m=>m+"约 "+Math.round(totals.get(m)||0)+" kcal").join(" · "));
    const missing=card.querySelector("[data-unknown]");missing.hidden=!unknown;missing.textContent="另含 "+unknown+" 道未标热量";
    const bar=card.querySelector("progress");bar.max=goal;bar.value=Math.min(used,goal);bar.toggleAttribute("data-over",left<0);
    card.dataset.target=goal;
    set("[data-picked-count]","("+selected.size+")");card.querySelector("[data-selected]").replaceChildren(list);
    card.querySelector("[data-none-picked]").hidden=selected.size>0;
    menu.querySelector("[data-only-wanted] span").textContent="("+selected.size+")";
    const day=document.querySelector(".days [aria-current=date]");
    if(day) {
      const marks=day.querySelector(".day-marks"),dot=marks.querySelector(".wish-dot");
      if(selected.size&&!dot){const i=document.createElement("i");i.className="wish-dot";marks.append(i);}
      if(!selected.size)dot?.remove();
      const status=selected.size?"有菜，已点想吃":"有菜";day.title=card.dataset.day+" · "+status;day.querySelector(".sr-only").textContent=status;
      const legend=document.querySelector(".week-key");
      if(legend){let key=legend.querySelector(".wish-dot")?.parentElement;
        if(document.querySelector(".days .wish-dot")){if(!key){key=document.createElement("span");const i=document.createElement("i");i.className="wish-dot";key.append(i,"想吃");legend.append(key);}}
        else key?.remove();}
    }
    applyFilters();
  }
  async function drain() {
    if(sending)return;sending=true;
    while(pending.length) {
      const item=pending[0];
      try {
        const res=await fetch(item.url,{method:"POST",headers:{Accept:"application/json"},body:item.data});
        if(!res.ok)throw new Error();
        const state=await res.json();chosen=new Map(state.selected.map(d=>[d.id,d.servings]));target=state.target;
        if(item.kind==="target"){card.querySelector('[name="target"]').value=target;card.querySelector(".target-edit").open=false;}
      } catch {set("[data-budget-error]","这次调整未能确认，请重试。");}
      pending.shift();draw();
    }
    sending=false;
  }
  document.addEventListener("submit",e=>{
    const form=e.target;
    if(!menu.contains(form) && !card.contains(form))return;
    const url=new URL(form.action),kind=url.pathname.split("/").pop();
    if(!["want","servings","target"].includes(kind))return;
    e.preventDefault();
    const data=new URLSearchParams(new FormData(form,e.submitter));
    const value=Number(data.get("preset") ?? data.get(kind==="want"?"wanted":kind));
    pending.push({kind,url,data,value,id:data.get("id")});
    set("[data-budget-error]","");draw();drain();
  });
}
