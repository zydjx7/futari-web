import { el, button, sheetContents } from "./vendor/drawers.js";
import { icon } from "./vendor/stationery.js";
import catalog from "./vendor/catalog.js";
import { configureAlbum } from "./vendor/paper.js";
import { mountAlbum } from "./vendor/book.js";
import { savePolaroidPrint } from "./album-bridge.js";
import { handleShortcut } from "./shortcuts.js";

const { invoke } = window.__TAURI__.core,
  { listen } = window.__TAURI__.event;

const isMac = /Mac/.test(navigator.platform);
const systemMenu = isMac ? "菜单栏的兔子菜单" : "托盘";

configureAlbum({
  async api(path, _signal, body) {
    if (!path || path.startsWith("?")) {
      const params = new URLSearchParams(path.startsWith("?") ? path.slice(1) : "");
      return invoke("album_list", {
        moment: params.get("moment"),
        before: params.get("before"),
      });
    }
    const titleMatch = /^\/([^/]+)\/title$/.exec(path);
    if (titleMatch) {
      return invoke("album_title", {
        id: decodeURIComponent(titleMatch[1]),
        title: body.get("title"),
        revision: Number(body.get("revision")),
      });
    }
    const delMatch = /^\/([^/]+)\/delete$/.exec(path);
    if (delMatch) {
      await invoke("album_delete", {
        id: decodeURIComponent(delMatch[1]),
        revision: Number(body.get("revision")),
      });
      return null;
    }
    throw new Error("不支持的相册请求");
  },
  attachImage(img, id, signal, onReady, onError) {
    let disposed = false;
    let blobUrl = null;
    invoke("album_image", { id })
      .then((bytes) => {
        if (disposed || signal?.aborted) return;
        blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        img.src = blobUrl;
        onReady?.();
      })
      .catch(() => {
        if (!disposed && !signal?.aborted) onError?.();
      });
    return () => {
      disposed = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    };
  },
  downloadPrint: savePolaroidPrint,
});

const page = document.querySelector("#page"),
  notice = document.querySelector("#notice"),
  nav = document.querySelector("nav");

let tab = "bag",
  view,
  home,
  letters = [],
  more = null,
  opened = null,
  detail = null,
  scenes = [],
  busy = false,
  live = true,
  fetchId = 0,
  cloudForm = false,
  cloudProblem = false,
  poll,
  pending = null,
  albumLife = null,
  setAlbumName = null,
  drag = null,
  suppressedFood = null,
  lastDragSent = 0,
  seenCardSeq = 0;

const tabs = {
  bag: ["小篮子", "basket"],
  shop: ["小铺子", "store"],
  scenes: ["风景册", "snow"],
  mail: ["小信箱", "letter"],
  camera: ["相机", "camera"],
  album: ["相册", "album"],
  settings: ["设置", null],
};

const msg = (v) => (notice.textContent = v ? String(v) : "");
const nameButton = document.querySelector("#edit-name"),
  nameForm = document.querySelector("#rename-form"),
  nameInput = nameForm.elements.name;

function stopAlbum() {
  albumLife?.abort();
  albumLife = null;
  setAlbumName = null;
}

function closeName(focus = true) {
  nameForm.hidden = true;
  nameButton.closest("h1").hidden = false;
  if (focus) nameButton.focus();
}

function showName(name) {
  nameButton.textContent = name + "手账";
  nameButton.title = "给" + name + "改名";
  nameButton.disabled = false;
  document.title = "FUTARI · " + name;
  setAlbumName?.(name);
}

nameButton.onclick = () => {
  if (busy) return;
  nameButton.closest("h1").hidden = true;
  nameForm.hidden = false;
  nameInput.value = view.name;
  nameInput.focus();
  nameInput.select();
};
document.querySelector("#cancel-name").onclick = () => closeName();
nameForm.onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  ++fetchId;
  try {
    const name = await invoke("rename", { name: nameInput.value });
    view.name = name;
    showName(name);
    closeName();
    msg("");
  } catch (err) {
    msg(err);
  } finally {
    busy = false;
    if (live) refresh().catch(msg);
  }
};

const opt = (kind, value) =>
  invoke("set_option", {
    option: value === undefined ? { kind } : { kind, value },
  });

function row(actions, cls = "ops") {
  const line = el("div", undefined, cls);
  for (const [id, label, val, selected] of actions) {
    const b = button(id, label, val);
    if (selected !== undefined)
      b.setAttribute("aria-pressed", String(selected));
    line.append(b);
  }
  return line;
}

function wallpaperControls() {
  const s = view.settings;
  return [
    header("场景壁纸" + (view.shortcuts[1] ? "　" + view.shortcuts[1] : "")),
    row([["wall", s.wallpaper ? "关闭壁纸" : "开启壁纸", s.wallpaper ? "off" : "on", s.wallpaper]]),
    el("small", s.wallpaper && !view.wallActive ? "壁纸暂未显示，可重新开启。" :
      s.wallpaper_above_icons ? "壁纸开启后显示在桌面图标上方。" : "壁纸开启后显示在桌面图标下方。"),
  ];
}

function sizeControl(title, kind, saved) {
  const label = el("label", title + " ");
  const output = el("output", saved + "%");
  const slider = el("input");
  slider.type = "range";
  slider.id = kind;
  slider.min = 50;
  slider.max = 200;
  slider.step = 5;
  slider.value = saved;
  slider.setAttribute("aria-label", title);
  slider.oninput = () => { output.textContent = slider.value + "%"; };
  slider.onchange = () => opt(kind, slider.valueAsNumber).catch(error => {
    slider.value = saved;
    output.textContent = saved + "%";
    msg(error);
  });
  label.append(output, slider);
  return label;
}

function header(label) {
  return el("h3", label);
}

function updateView(v) {
  if (view && view.settings.cloud !== v.settings.cloud) {
    closeName(false);
    stopAlbum();
    home = null;
    letters = [];
    more = opened = detail = pending = null;
    cloudProblem = false;
  }
  view = v;
  showName(v.name);
}

let updateState=await invoke("update_status");
await listen("update-ready",async()=>{updateState=await invoke("update_status");paint();});
function paint() {
  nav.replaceChildren();
  for (const [key, [label, sprite]] of Object.entries(tabs)) {
    const b = button("tab", undefined, key);
    b.append(
      sprite ? icon(sprite) : el("i", "⚙", "gear"),
      el("span", label),
    );
    if (key === "mail") {
      const glow = icon("letter");
      glow.classList.add("mail-new");
      glow.hidden = !home?.unread;
      b.append(glow);
    }
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(key === tab));
    nav.append(b);
  }
  if (!view) return;
  const s = view.settings;
  if (tab !== "album") stopAlbum();
  if (["bag", "shop", "mail"].includes(tab)) {
    if (cloudProblem && !home) {
      page.replaceChildren(
        header("云端暂未连接"),
        el("p", "恢复网络后会自动重试。也可以在设置中切回本机自养。"),
      );
      return;
    }
    page.replaceChildren(
      sheetContents({
        tab,
        detail,
        opened,
        home,
        mail: letters,
        more,
        busy: busy || cloudProblem,
        scene: true,
        desktop: true,
      }),
    );
    if (cloudProblem)
      page.prepend(el("small", "上次同步的内容 · 恢复网络后会自动更新"));
    if (tab === "bag" && !detail) {
      const poses = [
        ["gesture", "摸头", "pet"],
        ["gesture", "站立张望", "stand"],
        ["gesture", "警觉竖耳", "alert"],
        ["gesture", "洗脸理毛", "groom"],
        ["gesture", "歪头", "tilt"],
        ["gesture", "嗅探", "sniff"],
        ["gesture", "侧耳听", "listen"],
        ["gesture", "回头偷看", "peek"],
        ["gesture", "背身", "back"],
        ["gesture", "揣手蹲", "loaf"],
        ["gesture", "趴卧", "sploot"],
        ["gesture", "翻肚皮", "flop"],
        ["gesture", "伸懒腰", "stretch"],
      ];
      if (s.mode !== "hidden") {
        if (view.placed.includes("tunnel")) poses.push(["gesture", "钻木桶", "tunnel"]);
        if ((view.placed || []).includes("ball"))
          poses.push(["gesture", "拱柳枝球", "ball"]);
        if (view.placed.some(id => ["bed","toastbed","knitbed"].includes(id)))
          poses.push(["gesture", "上小床", "bed"]);
        if (view.placed.includes("bowl")) poses.push(["gesture", "去食盆", "bowl"]);
      }
      page.append(header("小兔动作"), row(poses));
    }
    return;
  }
  if (tab === "album") {
    if (!albumLife) {
      albumLife = new AbortController();
      setAlbumName = mountAlbum(page, {
        signal: albumLife.signal,
        rabbitName: view.name,
        observe: (moment) => {
          if (moment === "nudge" && !(view?.placed || []).includes("ball")) {
            msg("先在小篮子里摆出柳枝球，再来拍它拱球。");
            return;
          }
          invoke("start_camera", { moment }).catch(msg);
        },
      });
    }
    return;
  }
  if (tab === "scenes") {
    page.replaceChildren(header("风景册"));
    for (const sc of [
      { id: "clear", title: "纯净无场景" },
      { id: "paper", title: "棉纸兔窝" },
      ...scenes,
    ]) {
      const b = button("scene", undefined, sc.id);
      b.className = "scene-row";
      b.append(
        sc.id === "clear" || sc.id === "paper"
          ? el("i", undefined, "paper")
          : icon("snow"),
        el("strong", sc.title),
      );
      b.setAttribute("aria-pressed", String((s.wallpaper ? s.scene : "clear") === sc.id));
      page.append(b);
    }
    page.append(
      row([
        ["folder", "打开场景文件夹"],
        ["refresh", "刷新场景"],
      ]),
      header("光影"),
      row(
        Object.entries(catalog.lights).map(([id, label]) => [
          "light",
          label,
          id,
          (view.atmosphere || "auto") === id,
        ]),
        "ops light-grid",
      ),
      ...wallpaperControls(),
    );
    return;
  }
  page.replaceChildren(
    header("小兔状态" + (view.shortcuts[0] ? "　" + view.shortcuts[0] + " 依次切换" : "")),
    row([
      ["layer", "隐身", "hidden", s.mode === "hidden"],
      ["layer", "仅在桌面", "desktop", s.mode === "desktop"],
      ["layer", "悬浮置顶", "overlay", s.mode === "overlay"],
    ]),
    el("small", "仅在桌面时，回到桌面就能找到兔子。悬浮置顶时，它也会出现在应用窗口上方。"),
    header("独立开关"),
    row([
      ["aboveIcons", "壁纸在图标上方", s.wallpaper_above_icons ? "off" : "on", s.wallpaper_above_icons],
      ["play", view.playMode ? "关闭点地移动" : "开启点地移动", view.playMode ? "off" : "on", view.playMode],
    ]),
    el(
      "small",
      `开启后，单击桌面空地就能叫兔子过去。也可以从${systemMenu}关闭。`,
    ),
    ...wallpaperControls(),
    header("桌面大小"),
    sizeControl("兔子", "rabbitScale", s.rabbit_scale),
    sizeControl("道具", "propScale", s.prop_scale),
    header("兔窝"),
    row([["autoRest", "偶尔回窝休息", s.auto_rest ? "off" : "on", s.auto_rest]]),
    header("陪工活动区"),
    row([
      ["patrol", isMac ? "程序坞上方" : "任务栏上方", "taskbar", s.patrol === "taskbar"],
      ["patrol", "角落小窝", "corner", s.patrol === "corner"],
      ["select", "划定活动区", null, s.patrol === "custom"],
      ["patrol", "全屏漫步", "full", s.patrol === "full"],
    ]),
    header("兔窝存档"),
  );
  if (s.fence && s.patrol !== "custom")
    page.append(row([["patrol", "使用上次框选", "custom"]]));
  if (view.cloudAvailable)
    page.append(
      row([
        ["local", "本机自养", null, !s.cloud],
        ["cloud", "连接云端兔窝", null, s.cloud],
      ]),
    );
  else page.append(el("p", "本机独立自养"));
  if (s.cloud)
    page.append(
      el(
        "small",
        cloudProblem
          ? "云端暂未连接，可切回本机自养。"
          : "已连接她的云端兔窝，与网页版共享。",
      ),
    );
  page.append(el("small","桌宠 "+updateState.app+" · 资源 "+(updateState.active || "内置")));
  if(s.cloud) page.append(button("check-update","检查更新"));
  if(updateState.pending) page.append(button("apply-update","发现新内容，刷新兔窝生效"));
  if (cloudForm) {
    const form = el("form");
    const pass = el("input");
    pass.type = "password";
    pass.name = "pass";
    pass.required = true;
    pass.minLength = 8;
    pass.maxLength = 512;
    pass.autocomplete = "off";
    const label = el("label", "她的专属暗号");
    label.append(pass);
    form.append(label);
    const submit = el("button", "连接");
    submit.type = "submit";
    submit.disabled = busy;
    form.append(submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      submit.disabled = true;
      const secret = pass.value;
      pass.value = "";
      try {
        await invoke("account_mode", { passcode: secret });
        cloudForm = false;
        await refresh();
        msg("已连接云端兔窝。");
      } catch (err) {
        msg(err);
      } finally {
        busy = false;
        paint();
      }
    };
    page.append(form);
  }
  page.append(
    el(
      "small",
      (view.shortcuts[0] || "使用" + systemMenu) +
        " 隐身/仅在桌面/悬浮置顶　·　" +
        (view.shortcuts[1] || "使用" + systemMenu) +
        " 开关壁纸",
    ),
  );
}

function scheduleCloudRefresh() {
  clearTimeout(poll);
  if (!live || !view?.settings.cloud) return;
  poll = setTimeout(() => {
    if (busy || cloudForm || drag?.active) scheduleCloudRefresh();
    else refresh().catch(msg);
  }, 4000);
}

async function refresh() {
  clearTimeout(poll);
  const seq = ++fetchId;
  const v = await invoke("desktop_view");
  if (seq !== fetchId) return;
  let initialNotice = null;
  if (v.cardSeq && v.cardSeq !== seenCardSeq) {
    seenCardSeq = v.cardSeq;
    if (v.cardOpen?.tab) {
      tab = v.cardOpen.tab;
      detail = opened = null;
      cloudForm = false;
    }
    if (v.cardOpen?.notice) initialNotice = v.cardOpen.notice;
  }
  updateView(v);
  const need = v.settings.cloud || ["shop", "bag", "mail"].includes(tab);
  try {
    const [h, m, sc] = await Promise.all([
      need ? invoke("home") : home,
      tab === "mail" ? invoke("mail", { before: null }) : null,
      tab === "scenes" ? invoke("scene_list") : scenes,
    ]);
    if (seq !== fetchId || !live) return;
    home = h;
    if (need && h) {
      view.name = h.name;
      if (h.atmosphere) view.atmosphere = h.atmosphere;
      showName(h.name);
    }
    if (need && cloudProblem) {
      cloudProblem = false;
      msg("");
    }
    scenes = sc;
    if (m) {
      letters = m.letters;
      more = m.nextBefore;
    }
  } catch (err) {
    if (seq === fetchId) {
      if (need) {
        if (view.settings.cloud) cloudProblem = true;
        else home = null;
      }
      msg(err);
    }
  }
  if (seq === fetchId && live) {
    if (tab !== "album" || !albumLife) paint();
    if (initialNotice) msg(initialNotice);
    scheduleCloudRefresh();
  }
}

async function command(e) {
  const b = e.target.closest("button[data-action]");
  if (!b || busy) return;
  if (e.detail && b.dataset.action === "detail" && b.dataset.item === suppressedFood) {
    e.preventDefault();
    return;
  }
  const a = b.dataset.action,
    it = b.dataset.item;
  msg("");
  if (a === "tab") {
    if (it === "camera") {
      await invoke("start_camera", { moment: null });
      return;
    }
    tab = it;
    detail = opened = null;
    pending = null;
    cloudForm = false;
    paint();
    await refresh();
    return;
  }
  if (a === "detail") {
    detail = it;
    pending = null;
    paint();
    return;
  }
  if (a === "back") {
    opened = detail = null;
    pending = null;
    paint();
    return;
  }
  if (a === "to-shop") {
    tab = "shop";
    paint();
    await refresh();
    return;
  }
  if (a === "cloud") {
    cloudForm = !cloudForm;
    paint();
    return;
  }
  if (a === "local" && !view.settings.cloud) {
    cloudForm = false;
    paint();
    return;
  }
  busy = true;
  b.disabled = true;
  try {
    if(a==="check-update"){await invoke("check_update");updateState=await invoke("update_status");paint();if(!updateState.pending)msg("已经是最新内容。");return;}
    if(a==="apply-update"){await invoke("apply_ui_update");return;}
    if (["buy", "feed", "place", "letter"].includes(a)) {
      const kind = a === "letter" ? "open-letter" : a;
      const key = kind + ":" + it;
      if (pending?.key !== key) pending = { key, id: crypto.randomUUID() };
      await invoke("tend", {
        action: {
          kind,
          item: a === "letter" ? null : it,
          letter: a === "letter" ? Number(it) : null,
          requestId: pending.id,
          ...(a === "place" ? { placed: !home.placed.includes(it) } : {}),
        },
      });
      pending = null;
      if (a === "letter") opened = letters.find((m) => m.id === Number(it));
      else {
        detail = null;
        if (a === "feed") await opt("close");
      }
    } else if (a === "more") {
      const data = await invoke("mail", { before: more });
      letters.push(...data.letters);
      more = data.nextBefore;
      return;
    } else if (a === "local") {
      await invoke("account_mode", { passcode: null });
      cloudForm = false;
    } else if (a === "light") {
      view.atmosphere = await invoke("set_atmosphere", { atmosphere: it });
    } else if (a === "play") {
      await opt("playMode", it === "on");
    } else if (a === "autoRest") await opt("autoRest", it === "on");
    else if (a === "wall") await opt("wallpaper", it === "on");
    else if (a === "aboveIcons") await opt("wallpaperAboveIcons", it === "on");
    else if (a === "layer") {
      await opt("mode", it);
    } else if (a === "select") await opt("selectFence");
    else if (a === "scene") {
      await opt("scene", it);
      await refresh();
      return;
    } else if (a === "gesture") {
      await opt("gesture", it);
      return;
    } else if (["mode", "patrol"].includes(a)) await opt(a, it);
    else if (["folder", "refresh", "close-sheet"].includes(a))
      await opt(a === "close-sheet" ? "close" : a);
    await refresh();
  } catch (err) {
    msg(err);
  } finally {
    busy = false;
    if (live && (tab !== "album" || !albumLife)) paint();
  }
}

// Cross-window food dragging from 小篮子 onto the desktop rabbit/bowl
page.addEventListener("pointerdown", (e) => {
  suppressedFood = null;
  const origin = e.target.closest("[data-food]");
  if (!origin || !e.isPrimary || e.button !== 0 || busy || !view?.visible) return;
  drag = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    item: origin.dataset.food,
    origin,
    active: false,
  };
});

window.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.active = true;
    suppressedFood = drag.item;
    drag.origin.setPointerCapture(e.pointerId);
    document.body.classList.add("dragging-food");
    lastDragSent = performance.now();
    invoke("food_drag", { phase: "start", item: drag.item }).catch(() => {});
    e.preventDefault();
    return;
  }
  const now = performance.now();
  if (now - lastDragSent >= 16) {
    lastDragSent = now;
    invoke("food_drag", { phase: "move", item: drag.item }).catch(() => {});
  }
  e.preventDefault();
});

function endFoodDrag(e, cancelled = false) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.active) return;
  document.body.classList.remove("dragging-food");
  invoke("food_drag", {
    phase: cancelled ? "cancel" : "end",
    item: d.item,
  }).catch(() => {});
  requestAnimationFrame(() => {
    suppressedFood = null;
  });
}
window.addEventListener("pointerup", (e) => endFoodDrag(e, false));
window.addEventListener("pointercancel", (e) => endFoodDrag(e, true));

document.onclick = (e) => command(e).catch(msg);
function closeBook() {
  return invoke("close_notebook").catch(msg);
}
document.querySelector("#close").onclick = closeBook;
document.onkeydown = (e) => {
  if (handleShortcut(e, invoke, view?.shortcuts)) return;
  if (e.key === "Escape") closeBook();
  else if (
    !e.defaultPrevented &&
    !e.isComposing &&
    !e.repeat &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === "c" &&
    !e.target.closest("input,textarea,select,[contenteditable=true]")
  ) {
    e.preventDefault();
    invoke("start_camera", { moment: null }).catch(msg);
  }
};
document.oncontextmenu = (e) => e.preventDefault();

await listen("card-closed", () => {
  live = false;
  if (drag?.active) {
    document.body.classList.remove("dragging-food");
    invoke("food_drag", { phase: "cancel", item: null }).catch(() => {});
  }
  drag = null;
  suppressedFood = null;
  stopAlbum();
  closeName(false);
  clearTimeout(poll);
  fetchId++;
  cloudForm = false;
  pending = null;
  opened = detail = null;
  page.replaceChildren();
});

await listen("card-open", (e) => {
  live = true;
  if (e.payload?.seq) seenCardSeq = e.payload.seq;
  if (e.payload?.tab) {
    tab = e.payload.tab;
    detail = opened = null;
    cloudForm = false;
  }
  msg(e.payload?.notice || "");
  refresh()
    .then(() => {
      if (e.payload?.notice) msg(e.payload.notice);
    })
    .catch(msg);
});

await listen("desktop-view", (e) => {
  updateView(e.payload);
  if (live && !cloudForm && (tab !== "album" || !albumLife)) {
    const slider = document.activeElement?.matches('input[type="range"]') ? document.activeElement.id : null;
    paint();
    if (slider) document.getElementById(slider)?.focus({preventScroll:true});
  }
});

await listen("wallet-update", () => {
  if (live && !busy && !cloudForm && !drag?.active && ["shop", "bag", "mail"].includes(tab))
    refresh().catch(msg);
});

await listen("scene-error", (e) => msg(e.payload));
refresh().catch(msg);
