// Worker geolocation provides a no-JS default. The device decides at midnight or while travelling.
const calendar = document.querySelector("[data-default-day]");
const greeting = document.querySelector("[data-greeting]");
const days = document.querySelectorAll("[data-calendar-day]");
let clockTimer, updateDefaultMeal;
function syncDay() {
  clearTimeout(clockTimer);
  if (document.hidden || document.documentElement.hasAttribute("data-room-open")) return;
  const now = new Date();
  const local = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
  if (calendar && calendar.dataset.defaultDay !== local) {
    const url = new URL(location.href);
    url.searchParams.set("day", local);
    location.replace(url);
    return;
  }
  for (const day of days) day.toggleAttribute("data-today", day.dataset.calendarDay === local);
  updateDefaultMeal?.(now);
  if (greeting) {
    const hour = now.getHours();
    greeting.textContent = hour < 5 ? "夜深了，慢慢歇一会儿。" : hour < 11 ? "早安，慢慢吃。" :
      hour < 14 ? "午安，好好吃饭。" : hour < 18 ? "下午好，歇一小会儿。" : "晚上好，慢慢享用。";
    greeting.hidden = false;
  }
  if (calendar || greeting) {
    const nextHour = new Date(now);
    if (updateDefaultMeal && now.getHours() === 14 && now.getMinutes() < 30) nextHour.setMinutes(30, 0, 0);
    else nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    clockTimer = setTimeout(syncDay, nextHour - now);
  }
}
document.addEventListener("visibilitychange", syncDay);
document.addEventListener("notes:overlaychange", syncDay);

const archive = document.querySelector(".archive");
if (archive && typeof archive.requestSubmit === "function") {
  archive.querySelector("select").addEventListener("change", () => archive.requestSubmit());
  archive.querySelector("button").hidden = true;
}

function enhanceMenu(menu) {
  const url = new URL(location.href);
  const tabs = [...menu.querySelectorAll("[data-meal-choice]")];
  const only = menu.querySelector("[data-only-wanted]");
  const parts = [...menu.querySelectorAll("[data-meal-key]")];
  const target = document.getElementById(location.hash.slice(1));
  const available = new Set(parts.map(part => part.dataset.mealKey));
  function mealAt(now) {
    const key = now.getHours() * 60 + now.getMinutes() < 14 * 60 + 30 ? "lunch" : "dinner";
    return available.has(key) ? key : parts[0].dataset.mealKey;
  }
  const specified = url.searchParams.get("meal");
  let active = mealAt(new Date());
  if (location.hash) active = target?.closest("[data-meal-key]")?.dataset.mealKey || "all";
  if (available.has(specified) || specified === "all") active = specified;
  let wanted = url.searchParams.get("wanted") === "1";

  const sections = parts.map(part => {
    const key = part.dataset.mealKey;
    const floorButtons = [...part.querySelectorAll("[data-floor]")];
    const chips = [...part.querySelectorAll("[data-station-choice]")];
    const search = part.querySelector("[data-search]");
    const query = (name) => url.searchParams.get(key + "-" + name) || "";
    const groups = [...part.querySelectorAll("[data-station]")].map(node => ({
      node, floors: node.dataset.floors.split(" "), name: node.dataset.station,
      rows: [...node.querySelectorAll("[data-find]")].map(li => ({ li, text: (node.dataset.station + " " + li.dataset.find).toLocaleLowerCase() }))
    }));
    const state = { part, key, floorButtons, chips, search, groups,
      floor: floorButtons.some(b => b.dataset.floor === query("floor")) ? query("floor") : "",
      station: chips.some(b => b.dataset.stationChoice === query("station")) ? query("station") : "",
      q: search ? query("q").slice(0, 160) : "" };
    if (search) search.value = state.q;
    const track = part.querySelector(".station-track");
    if (track) {
      const [prev, next] = part.querySelectorAll("[data-slide]");
      state.updateArrows = () => {
        prev.disabled = track.scrollLeft < 2;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
      };
      for (const button of [prev, next]) button.addEventListener("click", () =>
        track.scrollBy({ left: Number(button.dataset.slide) * track.clientWidth * .8,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
      track.addEventListener("scroll", state.updateArrows, { passive: true });
      new ResizeObserver(state.updateArrows).observe(track);
    }
    return state;
  });

  function apply() {
    for (const tab of tabs) tab.setAttribute("aria-pressed", String(tab.dataset.mealChoice === active));
    only.setAttribute("aria-pressed", String(wanted));
    let visible = 0;
    for (const s of sections) {
      s.part.hidden = active !== "all" && active !== s.key;
      if (s.part.hidden) continue;
      for (const button of s.floorButtons) button.setAttribute("aria-pressed", String(button.dataset.floor === s.floor));
      for (const chip of s.chips) {
        chip.hidden = Boolean(s.floor && chip.dataset.floors && !chip.dataset.floors.split(" ").includes(s.floor));
        if (chip.hidden && chip.dataset.stationChoice === s.station) s.station = "";
      }
      for (const chip of s.chips) chip.setAttribute("aria-pressed", String(chip.dataset.stationChoice === s.station));
      const selectedChip = s.station && s.chips.find(chip => chip.dataset.stationChoice === s.station);
      if (selectedChip) {
        const track = selectedChip.parentElement;
        const item = selectedChip.getBoundingClientRect(), area = track.getBoundingClientRect();
        if (item.left < area.left || item.right > area.right) track.scrollLeft += item.left - area.left - (area.width - item.width) / 2;
      }
      const needle = s.q.trim().toLocaleLowerCase();
      let count = 0;
      for (const group of s.groups) {
        const matches = (!s.floor || group.floors.includes(s.floor)) && (!s.station || s.station === "=" + group.name);
        let groupCount = 0;
        if (matches) for (const { li, text } of group.rows) {
          li.hidden = (wanted && li.dataset.wanted !== "1") || !text.includes(needle);
          if (!li.hidden) groupCount++;
        }
        group.node.hidden = !groupCount;
        count += groupCount;
      }
      s.part.querySelector("[data-no-dishes]").hidden = count > 0;
      s.updateArrows?.();
      visible += count;
    }
    menu.querySelector("[data-menu-status]").textContent = `显示 ${visible} 道菜`;
  }
  function viewURL() {
    const next = new URL(location.href);
    next.hash = "";
    next.searchParams.set("meal", active);
    if (wanted) next.searchParams.set("wanted", "1"); else next.searchParams.delete("wanted");
    for (const s of sections) for (const name of ["floor", "station", "q"]) {
      const param = s.key + "-" + name;
      if (s[name]) next.searchParams.set(param, s[name]); else next.searchParams.delete(param);
    }
    return next;
  }
  function change() {
    apply();
    history.replaceState(history.state, "", viewURL());
  }
  for (const tab of tabs) tab.addEventListener("click", () => {
    const scrolled = menu.getBoundingClientRect().top < 0;
    active = tab.dataset.mealChoice;
    change();
    if (scrolled) menu.scrollIntoView({ block: "start" });
  });
  only.addEventListener("click", () => { wanted = !wanted; change(); });
  for (const s of sections) {
    for (const b of s.floorButtons) b.addEventListener("click", () => { s.floor = b.dataset.floor; change(); });
    for (const b of s.chips) b.addEventListener("click", () => { s.station = b.dataset.stationChoice; change(); });
    s.search?.addEventListener("input", () => { s.q = s.search.value; change(); });
  }
  function preserveFilters(event) {
    const action=new URL(event.target.action);action.search=viewURL().search;event.target.action=action;
  }
  menu.addEventListener("submit",preserveFilters);
  const budget=document.querySelector("[data-budget]");
  if(budget) {
    budget.addEventListener("submit",preserveFilters);
    import("/app/calories.js").then(({initCalories})=>initCalories(budget,menu,apply))
      .catch(()=>{ /* Selection and quantity forms still submit to the server. */ });
  }
  for (const control of menu.querySelectorAll("[data-menu-tools]")) control.hidden = false;
  apply();
  updateDefaultMeal = now => {
    if (location.hash || new URL(location.href).searchParams.has("meal")) return;
    const next = mealAt(now);
    if (active !== next) { active = next; apply(); }
  };
  if (target && menu.contains(target)) requestAnimationFrame(() => {
    if (target.getClientRects().length) target.scrollIntoView({ block: target.matches("li") ? "center" : "start" });
    else menu.scrollIntoView({ block: "start" });
  });
}
const dailyMenu = document.querySelector("[data-menu]");
if (dailyMenu) enhanceMenu(dailyMenu);
syncDay();
