import { adminPage, pageError, shell } from "../../app/views.js";
import { deviceDay, empty, h, imageField, InputError, isId, monday, newImage, photo, readForm, saveBar,
  selectedDay, shiftDay, shortDate, validDay, weekdayName } from "../../shared/content.js";
import { plain, saved } from "../../shared/http.js";
import { dishDetails, mealSections } from "./offerings.js";
import { budget } from "./budget.js";
import { servingKey, defaultServings, validServings } from "./serving.js";
import { chefGallery, chefPhotoEditor, saveChefPhoto, weeklyPicks } from "./chef-picks.js";

const meals = ["午餐", "晚餐", "加餐"];
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const weekDays = week => weekdays.map((_, i) => shiftDay(week, i));
const options = (values, current, labels = values) => values.map((v, i) =>
  `<option value="${h(v)}"${v === current ? " selected" : ""}>${h(labels[i])}</option>`).join("");

function weekNav(path, day) {
  const start = monday(day);
  return `<nav class="week-nav" aria-label="切换周次"><span class="week-range">${start.slice(0, 4)} 年 · ${shortDate(start)} – ${shortDate(shiftDay(start, 6))}</span>
    <a href="${path}?day=${shiftDay(day, -7)}" aria-label="上一周">‹</a><a href="${path}?day=${shiftDay(day, 7)}" aria-label="下一周">›</a>
    <a class="today-link" href="${path}">本周</a></nav>`;
}

async function selectionResponse(ctx,day,location) {
  if (!ctx.request.headers.get("Accept")?.includes("application/json")) return saved(ctx,location);
  const [target,chosen]=await Promise.all([
    ctx.db.prepare("SELECT daily_kcal_target FROM menu_settings WHERE id=1").first("daily_kcal_target"),
    ctx.db.prepare("SELECT id,servings FROM menu_dishes WHERE week=? AND day=? AND wanted=1 AND meal<>'早餐' ORDER BY position,id").bind(monday(day),day).all()
  ]);
  return Response.json({location,target,selected:chosen.results});
}
async function want(ctx,adjust) {
  if (ctx.role !== "her") return plain("仅她可以点菜", 403);
  const form = await readForm(ctx.request);
  const id = form.get("id"), wanted = form.get("wanted");
  if (!isId(id)) throw new InputError("点菜记录无效");
  const record=await ctx.db.prepare(dishDetails+" WHERE d.id=? AND d.meal<>'早餐'").bind(id).first();
  if (!record) return pageError("找不到这道菜",404);
  const key=servingKey(record);
  let dish;
  if (adjust) {
    const value=form.get("servings");
    const n=typeof value==="string" && value.trim()!=="" ? Number(value) : NaN;
    if (!validServings(key,n)) throw new InputError("所选用量超出范围或精度，请用加减按钮调整");
    dish=await ctx.db.prepare("UPDATE menu_dishes SET servings=? WHERE id=? AND wanted=1 AND meal<>'早餐' RETURNING day").bind(n,id).first();
    if(!dish)return plain("请先选一道想吃的菜",409);
  } else {
    if (!["0","1"].includes(wanted)) throw new InputError("点菜记录无效");
    dish=await ctx.db.prepare("UPDATE menu_dishes SET wanted=?1,servings=CASE WHEN ?1=1 AND wanted=1 THEN servings ELSE ?3 END WHERE id=?2 AND meal<>'早餐' RETURNING day")
      .bind(Number(wanted),id,defaultServings(key)).first();
  }
  if (!dish) return pageError("找不到这道菜", 404);
  const view = new URLSearchParams({ day: dish.day });
  for (const [key, value] of ctx.url.searchParams) {
    if (/^(meal|wanted|(lunch|dinner|extra)-(floor|station|q))$/.test(key)) view.set(key, value.slice(0, 200));
  }
  return selectionResponse(ctx,dish.day,"/menu?" + view + "#dish-" + id);
}
async function target(ctx) {
  const form=await readForm(ctx.request);
  const n=Number(form.get("preset") ?? form.get("target")), day=form.get("day") || deviceDay(ctx.request);
  if(!Number.isInteger(n) || n<800 || n>4000 || !validDay(day)) throw new InputError("每日参考值须为 800 到 4000 的整数");
  await ctx.db.prepare("UPDATE menu_settings SET daily_kcal_target=? WHERE id=1").bind(n).run();
  return selectionResponse(ctx,day,"/menu?day="+day);
}

async function page(ctx, rest) {
  if (!ctx.read && (rest === "want" || rest === "servings")) return want(ctx,rest==="servings");
  if (!ctx.read && rest === "target") return target(ctx);
  if (rest || !ctx.read) return pageError("找不到此页", 404);
  const day = selectedDay(ctx), week = monday(day);
  const [record, weekSummary, dishes, kcalTarget, picks] = await Promise.all([
    ctx.db.prepare("SELECT image_key FROM menu_weeks WHERE week = ?").bind(week).first(),
    ctx.db.prepare("SELECT day,max(wanted) AS wanted FROM menu_dishes WHERE week=? AND meal != '早餐' GROUP BY day").bind(week).all(),
    ctx.db.prepare(dishDetails + " WHERE d.week=? AND d.day=? AND d.meal != '早餐' ORDER BY d.position,d.id").bind(week, day).all(),
    ctx.db.prepare("SELECT daily_kcal_target FROM menu_settings WHERE id=1").first("daily_kcal_target"),
    weeklyPicks(ctx.db, week)
  ]);
  const today = deviceDay(ctx.request);
  const byDay = new Map(weekSummary.results.map(row => [row.day, row]));
  const rows = dishes.results;
  const dates = weekDays(week).map((date, i) => {
    const hasDishes = byDay.has(date), wanted = byDay.get(date)?.wanted;
    const status = wanted ? "有菜，已点想吃" : hasDishes ? "有菜" : "暂无菜品";
    return `<a href="/menu?day=${date}" data-calendar-day="${date}" title="${date} · ${status}"${date === today ? " data-today" : ""}${date === day ? ' aria-current="date"' : ""}>
      <small><span class="weekday">周${weekdays[i]}</span><span class="today-name">今日</span></small><strong>${Number(date.slice(-2))}</strong>
      <span class="day-marks" aria-hidden="true">${hasDishes ? '<i class="dish-dot"></i>' : ""}${wanted ? '<i class="wish-dot"></i>' : ""}</span><span class="sr-only">${status}</span></a>`;
  }).join("");
  const groups = mealSections(rows, ctx.role);
  const total = rows.length && rows.every(row => row.kcal !== null && !row.station)
    ? `<span>当日合计 <strong>${Number(rows.reduce((sum, row) => sum + row.kcal, 0).toFixed(2))} kcal</strong></span>` : "";
  const note = total ? `<div class="total">${total}</div>` : "";
  const meta = `<div class="heading-meta"><time datetime="${day}"${ctx.url.searchParams.has("day") ? "" : ` data-default-day="${day}"`}>${shortDate(day)} · ${weekdayName(day)}</time><span data-greeting hidden></span></div>`;
  const key = byDay.size ? `<div class="week-key"><span><i class="dish-dot"></i>有菜</span>${weekSummary.results.some(dish => dish.wanted) ? '<span><i class="wish-dot"></i>想吃</span>' : ""}</div>` : "";
  return shell("/menu", ctx, { title: "菜单", meta, script: "today",
    body: `<div class="week-sheet">${weekNav("/menu", day)}<nav class="days" aria-label="选择日期">${dates}</nav>${key}</div>` +
      chefGallery(picks) + (groups ? budget(rows,kcalTarget,day,ctx.role)+groups : empty("当天还没有菜单")) + note + photo(record?.image_key, "本周菜单附图") });
}

function dishEditor(days, dish) {
  return `<div class="dish-edit"><input type="hidden" name="id" value="${dish.id}">
    <label><span>日期</span><select name="date">${options(days, dish.day, weekdays.map((d,i) => "周" + d + " · " + days[i].slice(5)))}</select></label>
    <label><span>餐次</span><select name="meal">${options(dish.meal === "早餐" ? [...meals, "早餐"] : meals, dish.meal)}</select></label>
    <label class="dish-name"><span>${h([dish.station, dish.category].filter(Boolean).join(" · ") || "菜名")}</span><input name="name" maxlength="160" value="${h(dish.name)}"></label>
    <label><span>${dish.portion ? "估算 kcal / " + h(dish.portion) : "kcal"}</span><input name="kcal" type="number" min="0" max="100000" step="any" value="${dish.kcal ?? ""}"></label>
    <button type="button" class="remove" data-remove-dish aria-label="移除这道菜">×</button>
    ${dish.wanted ? '<small class="wish-mark">她想吃</small>' : ""}</div>`;
}

async function largeWeek(db, week) {
  return Boolean(await db.prepare("SELECT 1 FROM menu_dishes WHERE week=? LIMIT 1 OFFSET 500").bind(week).first());
}

async function saveWeek(ctx, day) {
  const week = monday(day), form = await readForm(ctx.request);
  const dayOnly = form.get("scope") === "day";
  if (!dayOnly && await largeWeek(ctx.db, week)) throw new InputError("请重新打开当天的菜单后保存");
  const columns = ["id", "date", "meal", "name", "kcal"].map(key => form.getAll(key));
  const ids = columns[0], rows = [];
  if (ids.length > 500 || columns.some(col => col.length !== ids.length)) throw new InputError("一次最多可录入 500 道菜");
  for (let i = 0; i < ids.length; i++) {
    const [id, date, meal, rawName, energy] = columns.map(col => String(col[i]).trim());
    if (!rawName && !energy) continue;
    const kcal = energy === "" ? null : Number(energy);
    if (!isId(id) || !validDay(date) || monday(date) !== week || (!meals.includes(meal) && meal !== "早餐")) throw new InputError("请核对菜品日期和餐次");
    if (!rawName || rawName.length > 160) throw new InputError("请为每行填写菜名");
    if (kcal !== null && (!Number.isFinite(kcal) || kcal < 0 || kcal > 100000)) throw new InputError("请填写有效热量或留空");
    rows.push({ id, day: date, meal, name: rawName, kcal, position: i });
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new InputError("菜品行重复，请重新打开本周菜单");
  const key = await newImage(ctx.bucket, form, "menus/" + week);
  const json = JSON.stringify(rows);
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO menu_weeks(week,image_key) VALUES(?1,?2)
      ON CONFLICT(week) DO UPDATE SET image_key = CASE WHEN ?3 THEN NULL ELSE coalesce(excluded.image_key,menu_weeks.image_key) END`)
      .bind(week, key, Number(!key && form.has("remove_image"))),
    ctx.db.prepare("DELETE FROM menu_dishes WHERE week = ?1 AND (?3 IS NULL OR day=?3) AND id NOT IN (SELECT value->>'id' FROM json_each(?2))").bind(week, json, dayOnly ? day : null),
    ctx.db.prepare(`INSERT INTO menu_dishes(id,week,day,meal,name,kcal,position)
      SELECT value->>'id', ?1, value->>'day', value->>'meal', value->>'name', value->>'kcal', value->>'position'
      FROM json_each(?2) WHERE true ON CONFLICT(id) DO UPDATE SET day=excluded.day, meal=excluded.meal,
        name=excluded.name,kcal=excluded.kcal,position=excluded.position
        WHERE menu_dishes.week=excluded.week AND (?3 IS NULL OR menu_dishes.day=?3)`).bind(week, json, dayOnly ? day : null)
  ]);
  return saved(ctx, "/admin/menu?day=" + day);
}

async function manage(ctx, rest) {
  if (rest === "chef-photo" && !ctx.read) return saveChefPhoto(ctx, selectedDay(ctx));
  if (rest) return pageError("找不到此页", 404);
  const day = selectedDay(ctx), week = monday(day), days = weekDays(week);
  if (!ctx.read) return saveWeek(ctx, day);
  const dayOnly = await largeWeek(ctx.db, week);
  const [record, dishes, picks] = await Promise.all([
    ctx.db.prepare("SELECT image_key FROM menu_weeks WHERE week = ?").bind(week).first(),
    ctx.db.prepare(dishDetails + " WHERE d.week=?1 AND (?2 IS NULL OR d.day=?2) ORDER BY d.day,d.position,d.id").bind(week, dayOnly ? day : null).all(),
    weeklyPicks(ctx.db, week)
  ]);
  const fresh = { id: crypto.randomUUID(), day, meal: "午餐", name: "" };
  const rows = dishes.results.length ? dishes.results : [fresh];
  const dayNav = dayOnly ? `<nav class="days" aria-label="选择编辑日期">${days.map((date,i) => `<a href="/admin/menu?day=${date}"${date === day ? ' aria-current="date"' : ""}><small>周${weekdays[i]}</small><strong>${Number(date.slice(-2))}</strong></a>`).join("")}</nav>` : "";
  const body = weekNav("/admin/menu", day) + dayNav + chefPhotoEditor(picks, day) + `<form class="editor" data-editor method="post" enctype="multipart/form-data" action="/admin/menu?day=${day}">
    ${dayOnly ? '<input type="hidden" name="scope" value="day">' : ""}
    <div id="dish-rows">${rows.map(row => dishEditor(days, row)).join("")}</div>
    <template id="dish-template">${dishEditor(days, fresh)}</template><button type="button" class="subtle" data-add-dish>添加一道菜</button>
    ${imageField(record?.image_key)}${saveBar(dayOnly ? "保存当天" : "保存整周")}</form>`;
  return adminPage(ctx, "每周菜单", body);
}

export default { path: "/menu", title: "菜单", page, manage };
