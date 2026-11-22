import { desktopCard } from "./download-card.js";
import { createScene } from "./scene.js";
import { icon } from "./stationery.js";
import { tabs, el, button, sheetContents } from "./drawers.js";
import { createCamera } from "./camera.js";
import { mountNameEditor } from "./name-editor.js";
import { mountAlbum } from "/app/album/book.js";

const receipts = new Map();
function receipt(action, item, clear = false) {
  const name = "notes.room." + action + "." + item;
  if (clear) {
    receipts.delete(name);
    try {
      sessionStorage.removeItem(name);
    } catch {}
    return;
  }
  let id = receipts.get(name);
  try {
    id ??= sessionStorage.getItem(name);
  } catch {}
  id ??= crypto.randomUUID();
  receipts.set(name, id);
  try {
    sessionStorage.setItem(name, id);
  } catch {}
  return id;
}
export async function mountRoom(dialog, signal, onName) {
  const body = dialog.querySelector(".room-body");
  body.innerHTML =
    '<canvas class="book-stage" tabindex="0" aria-label="小兔子的画页"></canvas><div class="stage-keys"></div><section class="book-sheet" id="book-sheet" hidden aria-labelledby="sheet-title" tabindex="-1"></section><nav class="book-dock" aria-label="兔窝手账"></nav><div class="book-notice" hidden><span role="status"></span><button type="button" data-action="retry" hidden>再试一次</button></div>';
  const canvas = body.querySelector("canvas"),
    sheet = body.querySelector(".book-sheet"),
    dock = body.querySelector(".book-dock");
  const notice = body.querySelector(".book-notice"),
    retry = notice.querySelector("button");
  for (const [name, [label, art]] of Object.entries(tabs)) {
    const b = button("tab", undefined, name);
    b.className = "book-badge";
    b.setAttribute("aria-controls", name === "camera" ? "rabbit-camera" : "book-sheet");
    if (name === "camera") b.setAttribute("aria-keyshortcuts", "C");
    b.setAttribute("aria-expanded", "false");
    b.append(icon(art), el("span", label));
    if (name === "mail") {
      const glow = icon("letter");
      glow.classList.add("mail-new");
      glow.hidden = true;
      b.append(glow);
    }
    dock.append(b);
  }
  for (const [k, label] of [
    ["pet", "摸摸头"],
    ["peek", "回头偷瞄"],
    ["bowl", "蓝碗喂食"],
    ["tunnel", "木隧道"]
  ])
    body.querySelector(".stage-keys").append(button(k, label));
  let home,
    scene,
    wanted,
    tab = null,
    detail = null,
    mail = [],
    more = null,
    opened = null;
  let downloads;
  let mailVersion = 0,
    loadingMail = false,
    stateVersion = 0,
    busy = false,
    drag = null,
    draggedItem = null,
    preferred = "hay",
    retryAction,
    timer;
  let albumLife = null, setAlbumName, displayedName;
  const setEditorName = mountNameEditor(dialog, async (value) => {
    const { name } = await api("rename", { name: value });
    if (!signal.aborted) {
      ++stateVersion;
      home.name = name;
      render();
    }
    return name;
  }, signal);
  const camera = createCamera(
    body,
    signal,
    () => scene,
    (open) => {
      dock.querySelector('[data-item="camera"]').setAttribute("aria-expanded", String(open));
    },
    () => show("album")
  );
  function message(text = "", again) {
    if (signal.aborted) return;
    clearTimeout(timer);
    notice.hidden = !text;
    notice.querySelector("span").textContent = text;
    retryAction = again;
    retry.hidden = !again;
    if (text && !again)
      timer = setTimeout(() => {
        notice.hidden = true;
      }, 4300);
  }
  async function api(name, data) {
    const opts = { signal, headers: { Accept: "application/json" } };
    if (data) {
      opts.method = "POST";
      opts.body = new URLSearchParams(data);
    }
    const res = await fetch("/api/rabbit/" + name, opts);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const e = new Error(j.error || "兔窝暂时连不上");
      e.status = res.status;
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }
  function clock() {
    scene?.decorate(home?.placed || [], home?.atmosphere || "auto", Boolean(home?.inventory?.bed));
  }
  async function applyScene() {
    if (!scene || !home || wanted === home.scene) return;
    const id = home.scene;
    wanted = id;
    try {
      await scene.setPack(id);
    } catch (e) {
      if (wanted === id) {
        wanted = null;
        message("这页风景还没展开。", applyScene);
      }
    }
  }
  async function refresh() {
    const v = ++stateVersion,
      next = await api("state");
    if (signal.aborted || v !== stateVersion) return;
    const changed = JSON.stringify(next) !== JSON.stringify(home);
    home = next;
    if (changed) {
      render();
      clock();
    }
    await applyScene();
  }
  async function sync() {
    try {
      await refresh();
    } catch {
      message("兔窝暂时连不上。", sync);
    }
  }
  async function letters(append = false) {
    if (loadingMail || (append && !more)) return;
    loadingMail = true;
    const v = ++mailVersion,
      page = append ? more : null;
    try {
      const data = await api("mail" + (page ? "?before=" + page : ""));
      if (signal.aborted || v !== mailVersion || tab !== "mail") return;
      mail = append ? [...mail, ...data.letters] : data.letters;
      more = data.nextBefore;
      render();
    } catch {
      if (v === mailVersion) message("信封暂时没送到。", () => letters(append));
    } finally {
      if (v === mailVersion) loadingMail = false;
    }
  }
  function show(which) {
    camera.close();
    if (tab === "album" && which !== "album") {
      albumLife?.abort();
      albumLife = null;
      setAlbumName = undefined;
    }
    ++mailVersion;
    loadingMail = false;
    tab = which;
    detail = null;
    opened = null;
    message();
    render();
    sheet.scrollTop = 0;
    if (which) {
      sheet.focus({ preventScroll: true });
      if (which === "mail") letters();
      if (which === "scenes") {
        api("downloads").then(data => {
          downloads = data;
          if (tab === "scenes") render();
        }).catch(() => {});
      }
      sync();
    }
  }
  function closeSheet() {
    const b = dock.querySelector('[data-item="' + tab + '"]');
    show(null);
    b?.focus({ preventScroll: true });
  }
  function render() {
    if (signal.aborted || drag?.active) return;
    const focus = sheet.contains(document.activeElement) ? document.activeElement : null,
      scroll = sheet.scrollTop;
    if (home) {
      if (home.name !== displayedName) {
        displayedName = home.name;
        setEditorName(home.name);
        camera.setName(home.name);
        setAlbumName?.(home.name);
        onName?.(home.name);
        canvas.setAttribute("aria-label", home.name + "的画页。点兔子摸头，点地面前往；方向键移动，空格摸头。");
        dock.setAttribute("aria-label", home.name + "的兔窝手账");
        body.querySelector('[data-action="pet"]').setAttribute("aria-label", "摸摸" + home.name + "的头");
      }
      const mailTab = dock.querySelector('[data-item="mail"]');
      mailTab.querySelector(".mail-new").hidden = !home.unread;
      mailTab.setAttribute("aria-label", home.unread ? "小信箱，有新来信" : "小信箱");
    }
    for (const b of dock.children)
      b.setAttribute(
        "aria-expanded",
        String(b.dataset.item === "camera" ? camera.isOpen() : b.dataset.item === tab)
      );
    sheet.classList.toggle("album-sheet", tab === "album");
    sheet.hidden = !tab;
    if (!tab) {
      sheet.replaceChildren();
      return;
    }
    if (tab === "album") {
      if (!albumLife) {
        albumLife = new AbortController();
        setAlbumName = mountAlbum(sheet, { signal: albumLife.signal, close: closeSheet, observe: observeMoment, rabbitName: home?.name });
      }
      return;
    }
    const nodes = sheetContents({ tab, detail, opened, home, mail, more, busy, scene });
    if (tab === "scenes" && home) {
      const card = desktopCard(downloads, el);
      if (card) nodes.append(card);
    }
    sheet.replaceChildren(nodes);
    sheet.scrollTop = scroll;
    if (focus?.dataset.action) {
      const next = [...sheet.querySelectorAll("button")].find(
        (b) =>
          b.dataset.action === focus.dataset.action && b.dataset.item === focus.dataset.item && !b.disabled
      );
      (next || sheet).focus({ preventScroll: true });
    }
  }
  async function transact(action, item, atBowl = false) {
    if (busy || !home || signal.aborted) return;
    if (action === "feed" && (!scene || scene.occupied())) {
      message("等它歇一歇，再递给它吧。");
      return;
    }
    const hasReceipt = action === "buy" || action === "feed";
    busy = true;
    render();
    let committed = false;
    try {
      const result = await api(action, {
        item,
        ...(hasReceipt ? { request_id: receipt(action, item) } : {})
      });
      committed = true;
      if (hasReceipt) receipt(action, item, true);
      if (signal.aborted) return;
      if (action === "feed") {
        preferred = item;
        if (result.applied) scene.act("eat", item, atBowl);
        show(null);
      }
      if (action === "place") {
        show(null);
      }
      if (action === "buy") detail = null;
      await refresh();
      message(
        action === "buy" ? "已放进小篮子。" : action === "place" ? "在窝里摆好了。" : "它把这一口收下了。"
      );
    } catch (e) {
      if (signal.aborted) return;
      if (e.status && e.status < 500 && hasReceipt) receipt(action, item, true);
      if (committed) message("已经记下，手账稍后再翻。", sync);
      else if (e.status === 409 || e.status === 422) {
        message(e.message);
        await sync();
      } else message("还没收到回音。", () => transact(action, item, atBowl));
    } finally {
      busy = false;
      render();
    }
  }
  async function choose(id) {
    if (busy || !scene || !home) return;
    if (home.scene === id && canvas.dataset.scene === id) {
      closeSheet();
      return;
    }
    busy = true;
    ++stateVersion;
    render();
    try {
      await scene.setPack(id);
      await api("scene", { scene: id });
      home.scene = id;
      wanted = id;
      closeSheet();
      clock();
    } catch {
      wanted = null;
      await sync();
      message("这页风景暂时没存好。", () => choose(id));
    } finally {
      busy = false;
      render();
    }
  }
  async function readLetter(id) {
    const m = mail.find((row) => row.id === Number(id));
    if (!m) return;
    opened = m;
    render();
    sheet.focus({ preventScroll: true });
    try {
      await api("open-letter", { id });
      m.opened = 1;
      await refresh();
      render();
    } catch {
      message("信件的已读记号暂未保存。", () => readLetter(id));
    }
  }
  async function chooseLight(id) {
    if (busy || !home || !scene) return;
    busy = true;
    ++stateVersion;
    render();
    try {
      await api("atmosphere", { atmosphere: id });
      home.atmosphere = id;
      clock();
      closeSheet();
    } catch {
      message("光影暂时没存好。", () => chooseLight(id));
    } finally {
      busy = false;
      render();
    }
  }
  function toggleCamera() {
    if (camera.isOpen()) {
      camera.close();
      dock.querySelector('[data-item="camera"]').focus({ preventScroll: true });
    } else if (scene && !drag?.active) {
      show(null);
      camera.start();
    }
  }
  async function observeMoment(id) {
    if (!scene || !home || busy || scene.occupied()) {
      message("等它吃完或钻出隧道，就可以拍了。");
      return;
    }
    if (id === "nudge" && !home.placed.includes("ball")) {
      message("先在小篮子里摆出柳枝球，再来拍它拱球。");
      return;
    }
    const snow = id === "stump" || id === "nap";
    busy = true;
    ++stateVersion;
    try {
      if (snow && home.scene !== "snow") {
        await scene.setPack("snow");
        await api("scene", { scene: "snow" });
        wanted = home.scene = "snow";
      }
      if (id === "nap" && canvas.dataset.light !== "night") {
        await api("atmosphere", { atmosphere: "night" });
        home.atmosphere = "night";
      }
      if (signal.aborted) return;
      clock();
      if (scene.observe(id)) {
        show(null);
        camera.start(true);
      }
    } catch {
      wanted = null;
      await sync();
      message("这页风景还没准备好。", () => observeMoment(id));
    } finally {
      busy = false;
    }
  }
  dialog.addEventListener(
    "keydown",
    (e) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        e.ctrlKey ||
        e.altKey ||
        e.metaKey ||
        e.shiftKey ||
        e.key.toLowerCase() !== "c" ||
        e.target.closest("input:not([type=range]),textarea,select,[contenteditable=true]")
      )
        return;
      e.preventDefault();
      toggleCamera();
    },
    { signal }
  );
  async function recordPet() {
    try {
      await api("pet", {});
      await refresh();
    } catch {
      message("摸头暂未记下。", recordPet);
    }
  }
  function pick(key) {
    if (busy) return;
    if (key === "bowl") {
      if (!home || busy) return;
      const meal = home.inventory[preferred]
        ? preferred
        : Object.keys(home.inventory).find((id) => home.shop[id].nourishment);
      if (meal) transact("feed", meal, true);
      else {
        show("shop");
        message("蓝碗空着，挑一份草吧。");
      }
      return;
    }
    if (scene?.act(key) && key === "pet") recordPet();
  }
  body.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (e.detail && b.dataset.action === "detail" && b.dataset.item === draggedItem) {
        e.preventDefault();
        return;
      }
      const a = b.dataset.action,
        id = b.dataset.item;
      if (!a) return;
      if (a === "tab") {
        if (id === "camera") toggleCamera();
        else if (tab === id) closeSheet();
        else show(id);
      } else if (a === "back") {
        detail = null;
        opened = null;
        render();
        sheet.focus({ preventScroll: true });
      } else if (a === "close-sheet") closeSheet();
      else if (a === "detail") {
        detail = id;
        render();
        sheet.scrollTop = 0;
        sheet.focus({ preventScroll: true });
      } else if (a === "to-shop") show("shop");
      else if (["buy", "feed", "place"].includes(a)) transact(a, id);
      else if (a === "switch-scene") choose(id);
      else if (a === "light") chooseLight(id);
      else if (a === "letter") readLetter(id);
      else if (a === "more") letters(true);
      else if (a === "retry") retryAction?.();
      else pick(a);
    },
    { signal }
  );
  function dragEnd(e, cancelled = false) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    const valid = !cancelled && scene.canFeed(e.clientX, e.clientY);
    d.ghost.remove();
    body.classList.remove("feeding-drag");
    scene.drag(false);
    draggedItem = d.item;
    // Keep the touch target mounted through the browser's corresponding touchend.
    requestAnimationFrame(() => {
      if (signal.aborted) return;
      if (valid) transact("feed", d.item);
      else render();
    });
  }
  // Touch browsers may suppress the next synthetic mouse click after dragging food.
  // Activate a stationary tap on release; a pan, cancelled touch or food drag stays a gesture.
  let tap = null;
  body.addEventListener(
    "touchstart",
    (e) => {
      const button = e.target.closest("button"),
        touch = e.touches[0];
      tap =
        button && e.touches.length === 1
          ? { button, id: touch.identifier, x: touch.clientX, y: touch.clientY }
          : null;
    },
    { signal, passive: true }
  );
  body.addEventListener(
    "touchcancel",
    () => {
      tap = null;
    },
    { signal }
  );
  body.addEventListener(
    "touchend",
    (e) => {
      const start = tap;
      tap = null;
      if (!start || !start.button.isConnected || start.button.disabled) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === start.id);
      if (!touch || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) return;
      if (start.button.dataset.action === "detail" && draggedItem === start.button.dataset.item) return;
      e.preventDefault();
      start.button.click();
    },
    { signal, passive: false }
  );
  body.addEventListener(
    "pointerdown",
    (e) => {
      draggedItem = null;
      const origin = e.target.closest("[data-food]");
      if (!origin || !e.isPrimary || e.button !== 0 || !scene || scene.occupied() || busy) return;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        item: origin.dataset.food,
        origin,
        active: false
      };
    },
    { signal }
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.active) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.active = true;
        drag.origin.setPointerCapture(e.pointerId);
        drag.ghost = icon(drag.item);
        drag.ghost.classList.add("food-ghost");
        body.append(drag.ghost);
        body.classList.add("feeding-drag");
        scene.drag(true);
      }
      scene.hoverFood(e.clientX, e.clientY);
      const r = body.getBoundingClientRect();
      drag.ghost.style.left = e.clientX - r.left + "px";
      drag.ghost.style.top = e.clientY - r.top + "px";
      e.preventDefault();
    },
    { signal, passive: false }
  );
  window.addEventListener("pointerup", (e) => dragEnd(e), { signal });
  window.addEventListener("pointercancel", (e) => dragEnd(e, true), { signal });
  async function enter() {
    try {
      await api("visit", {});
      await refresh();
    } catch {
      message("兔窝暂时连不上。", enter);
    }
  }
  async function art() {
    try {
      scene = await createScene(canvas, signal, pick, camera.update);
      await applyScene();
      clock();
      render();
    } catch {
      message("兔子的画页暂时没展开。", art);
    }
  }
  let lastMailPoll = 0, polling = false;
  const interval = setInterval(async () => {
    if (!document.hidden && !busy && !drag && !polling) {
      clock();
      polling = true;
      try { await sync(); } finally { polling = false; }
      if (tab === "mail" && !opened && mail.length <= 20 && Date.now() - lastMailPoll >= 30000) {
        lastMailPoll = Date.now();
        letters();
      }
    }
  }, 4000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !busy) sync();
  }, { signal });
  signal.addEventListener(
    "abort",
    () => {
      clearInterval(interval);
      clearTimeout(timer);
      albumLife?.abort();
    },
    { once: true }
  );
  await Promise.all([enter(), art()]);
  if (!signal.aborted) body.removeAttribute("aria-busy");
}
