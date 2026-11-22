import { h } from "../../shared/content.js";
import { portions } from "./budget.js";
import { servingKey, defaultServings, portionState, estimateLabel, density } from "./serving.js";

export const dishDetails = `SELECT d.*, info.station, info.category, info.portion, info.note
  FROM menu_dishes d LEFT JOIN menu_dish_details info ON info.dish_id=d.id`;

const mealKeys = new Map([["午餐", "lunch"], ["晚餐", "dinner"], ["加餐", "extra"]]);

function floorsOf(station) {
  const prefix = station.match(/^\s*\d+\s*F(?:\s*[/／、]\s*\d+\s*F)*/i)?.[0];
  return prefix ? [...new Set(prefix.toUpperCase().replace(/\s/g, "").match(/\d+F/g))] : ["其他"];
}

function dishList(items, role) {
  return `<ul>${items.map(dish => {
    const key=servingKey(dish), badge=density(key,dish.kcal), start=portionState(key,defaultServings(key));
    const quantity=dish.wanted ? estimateLabel(key,dish.servings,dish.kcal) : badge ? "起步 "+start.label : "";
    const mark = role === "her" ? `<form method="post" action="/menu/want"><input type="hidden" name="id" value="${h(dish.id)}">
      <input type="hidden" name="wanted" value="${dish.wanted ? 0 : 1}"><button class="wish" aria-pressed="${Boolean(dish.wanted)}"
      aria-label="${h(dish.name)}，想吃">想吃</button></form>` : (dish.wanted ? '<span class="wish-mark">她想吃</span>' : "");
    const energy = dish.kcal === null ? "" : dish.portion
      ? `约 ${dish.kcal} kcal / ${h(dish.portion)}` : `${dish.kcal} kcal`;
    const detail = [dish.category, dish.note].filter(Boolean).join(" · ");
    return `<li id="dish-${h(dish.id)}" data-kcal="${dish.kcal??""}" data-serving="${key}" data-servings="${dish.servings}" data-wanted="${Number(Boolean(dish.wanted))}" data-find="${h([dish.name, dish.category].filter(Boolean).join(" "))}">
      <span class="dish-title">${h(dish.name)}${detail ? `<small class="dish-detail">${h(detail)}</small>` : ""}</span>
      <div class="dish-measure"><span class="energy">${energy}</span>${badge?`<span class="density" data-density="${badge.tone}" title="热量密度">${badge.label}</span>`:""}<small data-portion-note>${quantity}</small></div><div class="dish-actions">${mark}<div data-row-portions>${dish.wanted?portions(dish,role):""}</div></div></li>`;
  }).join("")}</ul>`;
}

function stationFilters(stations) {
  const floors = [...new Set(stations.flatMap(s => s.floors))].sort((a, b) => (parseInt(a) || Infinity) - (parseInt(b) || Infinity));
  const chip = (key, value, text, extra = "") => `<button type="button" data-${key}="${h(value)}" aria-pressed="${value === ""}"${extra}>${text}</button>`;
  return `<div class="station-filters" data-menu-tools hidden>
    <div class="floor-search"><div class="floor-choices" role="group" aria-label="楼层"><span class="filter-label">楼层</span>
      ${chip("floor", "", "全部")}${floors.map(f => chip("floor", f, h(f))).join("")}</div>
      <label class="dish-search"><span class="sr-only">搜菜名、菜馆或分类</span><input type="search" data-search maxlength="160" placeholder="搜菜名、菜馆或分类"></label></div>
    <div class="station-chooser" role="group" aria-label="选择菜馆"><span class="filter-label">菜馆</span>${chip("station-choice", "", "全部菜馆")}<div class="station-track">
      ${stations.map(s => chip("station-choice", "=" + s.name, `${h(s.name || "未分档口")} <small>${s.items.length}</small>`,
        ` data-floors="${h(s.floors.join(" "))}"`)).join("")}</div>
      <div class="station-arrows"><button type="button" data-slide="-1" aria-label="向前浏览菜馆">‹</button><button type="button" data-slide="1" aria-label="向后浏览菜馆">›</button></div></div></div>`;
}

export function mealSections(rows, role) {
  const groups = new Map();
  for (const dish of rows) {
    if (!mealKeys.has(dish.meal)) continue;
    if (!groups.has(dish.meal)) groups.set(dish.meal, new Map());
    const byStation = groups.get(dish.meal), name = dish.station || "";
    if (!byStation.has(name)) byStation.set(name, { name, floors: floorsOf(name), items: [] });
    byStation.get(name).items.push(dish);
  }
  if (!groups.size) return "";
  const extraLabel = [...(groups.get("加餐")?.keys() ?? [])].some(Boolean) ? "当日供应" : "加餐";
  const tabs = [...mealKeys].filter(([meal]) => meal !== "加餐" || groups.has(meal)).map(([meal, key]) =>
    `<button type="button" data-meal-choice="${key}" aria-pressed="false"${groups.has(meal) ? "" : " disabled"}>${meal === "加餐" ? extraLabel : meal}</button>`).join("");
  const wanted = rows.filter(dish => mealKeys.has(dish.meal) && dish.wanted).length;
  const sections = [...mealKeys].filter(([meal]) => groups.has(meal)).map(([meal, key]) => {
    const label = meal === "加餐" ? extraLabel : meal;
    const stations = [...groups.get(meal).values()].sort((a, b) =>
      Number(b.name.includes("自助餐线")) - Number(a.name.includes("自助餐线")) ||
      (parseInt(a.floors[0]) || Infinity) - (parseInt(b.floors[0]) || Infinity));
    const named = stations.filter(s => s.name).length;
    const total = stations.reduce((n, s) => n + s.items.length, 0);
    const lists = stations.map(s => `<div class="menu-station" data-station="${h(s.name)}" data-floors="${h(s.floors.join(" "))}">
      ${named ? `<h3>${h(s.name || "未分档口")} <small>${s.items.length} 道</small></h3>` : ""}${dishList(s.items, role)}</div>`).join("");
    return `<section class="meal" id="meal-${key}" data-meal="${label}" data-meal-key="${key}">
      <header class="meal-heading"><h2>${label}</h2><span>${named ? named + " 家菜馆 · " : ""}${total} 道菜</span></header>
      ${stations.length > 1 ? stationFilters(stations) : ""}${lists}
      <p class="no-dishes" data-no-dishes hidden>没有符合筛选的菜。</p></section>`;
  }).join("");
  const estimate = rows.some(d => mealKeys.has(d.meal) && d.portion && d.kcal !== null) ? `<details class="estimate"><summary>热量估算说明</summary>
    热量按所选克数与每百克参考值折算，可按实际饭量用 − / + 增减克数。用量减到 0 仍会保留「想吃」。饮品按每 100 毫升折算，标「个」的按个数估算。密度按每百克或每百毫升分为轻（低于 100 kcal）、中（100–200 kcal）、偏高（高于 200 kcal）。<a href="https://www.studenthealth.gov.hk/tc_chi/resources/resources_bl/files/caloric_value_common_food.pdf" target="_blank" rel="noopener noreferrer">常见食物热量参考</a></details>` : "";
  return `<div class="daily-menu" data-menu><div class="meal-bar" data-menu-tools hidden>
    <div class="meal-choices" role="group" aria-label="选择餐次">${tabs}<button type="button" data-meal-choice="all" aria-pressed="true">全部</button></div>
    <button type="button" class="wanted-filter" data-only-wanted aria-pressed="false">只看想吃 <span>(${wanted})</span></button></div>
    ${sections}<span class="sr-only" role="status" data-menu-status></span>${estimate}</div>`;
}
