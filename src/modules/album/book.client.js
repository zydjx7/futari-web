import catalog from "./catalog.js";
import { api, attachImage, make, control, dayOf, photoNote, printPaper, downloadPrint, titleInput } from "./paper.js";

export function mountAlbum(root, { signal, close, observe, rabbitName = root.dataset.rabbitName || "" } = {}) {
  let page = "photos",
    filter = "",
    photos = [],
    covers = {},
    next = null,
    serial = 0,
    loading = false;
  const disposers = [];
  function clearImages() {
    while (disposers.length) {
      try {
        disposers.pop()();
      } catch {}
    }
  }
  const journal = make("div", undefined, "rabbit-journal"),
    head = make("header", undefined, "journal-heading");
  const title = make("h3");
  let redrawPrint;
  title.id = "sheet-title";
  head.append(title);
  if (close) {
    const cross = control("×", close, "journal-close");
    cross.setAttribute("aria-label", "合上相册");
    head.append(cross);
  }
  const tabs = make("nav", undefined, "journal-tabs");
  tabs.setAttribute("aria-label", "相册页");
  const gallery = control("拍立得", () => load("photos", "")),
    wall = control("瞬间收集墙", () => load("wall", ""));
  tabs.append(gallery, wall);
  const content = make("div", undefined, "journal-content"),
    status = make("p", undefined, "photo-status");
  content.tabIndex = -1;
  status.setAttribute("role", "status");
  journal.append(head, tabs, content, status);
  root.replaceChildren(journal);
  function current(v) {
    return v === serial && !signal.aborted;
  }
  function stamp() {
    return make("span", "已收录", "moment-stamp");
  }
  function updateHeading() {
    const owner = rabbitName ? rabbitName + "的" : "";
    title.textContent = owner + (page === "wall" ? "瞬间收集墙" : "手账相册");
    if (root.hasAttribute("data-album-page")) {
      root.setAttribute("aria-label", title.textContent);
      root.closest("main").querySelector("h1").textContent = title.textContent;
    }
  }
  function setName(name) {
    if (!name || name === rabbitName || signal.aborted) return;
    rabbitName = name;
    if (redrawPrint) {
      updateHeading();
      redrawPrint();
    } else draw();
  }
  function draw() {
    updateHeading();
    redrawPrint = null;
    clearImages();
    root.classList.remove("inspecting");
    content.replaceChildren();
    tabs.hidden = false;
    gallery.setAttribute("aria-pressed", String(page === "photos"));
    wall.setAttribute("aria-pressed", String(page === "wall"));
    if (page === "wall") {
      const grid = make("div", undefined, "moment-wall");
      for (const [id, name] of Object.entries(catalog.moments)) {
        const cell = make("article", undefined, "moment-cell");
        cell.append(make("h4", name));
        if (covers[id]) {
          const thumb = control("", () => load("photos", id), "wall-print");
          thumb.setAttribute("aria-label", "查看" + rabbitName + "「" + name + "」的照片");
          const img = make("img");
          img.alt = "";
          img.loading = "lazy";
          disposers.push(attachImage(img, covers[id], signal));
          thumb.append(img, stamp());
          cell.prepend(thumb);
        }
        if (observe) {
          const act = control(
            id === "nap" ? "去雪夜灯旁拍" : id === "stump" ? "去雪桩旁拍" : "去拍一张",
            () => observe(id),
            "wall-link"
          );
          act.dataset.moment = id;
          act.setAttribute("aria-label", "拍下" + rabbitName + "「" + name + "」的瞬间");
          cell.append(act);
        }
        grid.append(cell);
      }
      content.append(grid);
      return;
    }
    if (filter)
      content.append(
        control(catalog.moments[filter] + " · 看全部", () => load("photos", ""), "journal-filter")
      );
    if (photos.length) {
      const grid = make("div", undefined, "journal-grid");
      for (const shot of photos) {
        const b = control("", () => inspect(shot), "journal-thumb"),
          img = make("img");
        b.dataset.photo = shot.id;
        img.loading = "lazy";
        img.decoding = "async";
        img.width = img.height = 220;
        disposers.push(attachImage(img, shot.id, signal));
        const caption = shot.title || photoNote(shot, rabbitName);
        img.alt = caption;
        b.append(
          img,
          make("span", dayOf(shot) + " · " + (catalog.scenes[shot.scene] || "桌面风景"), "photo-date"),
          make("strong", caption)
        );
        grid.append(b);
      }
      content.append(grid);
    } else if (!loading) {
      content.append(
        make("p", filter ? "这一页还留着空位。" : "第一张拍立得，会贴在这里。", "journal-empty")
      );
    }
    if (next) {
      const more = control("再翻一页", () => load(page, filter, true), "journal-more");
      more.disabled = loading;
      content.append(more);
    }
  }
  async function load(which = page, match = filter, append = false) {
    if (append && (loading || !next)) return;
    const nameAtRequest = rabbitName,
      cursor = append ? next : null,
      v = ++serial;
    page = which;
    filter = match;
    loading = true;
    if (!append) {
      photos = [];
      next = null;
    }
    status.textContent = "正在翻页…";
    draw();
    try {
      const query = new URLSearchParams();
      if (match) query.set("moment", match);
      if (cursor) query.set("before", cursor);
      const data = await api(query.size ? "?" + query : "", signal);
      if (!current(v)) return;
      if (rabbitName === nameAtRequest) rabbitName = data.rabbitName;
      photos = append ? photos.concat(data.photos) : data.photos;
      covers = data.covers;
      next = data.next;
      loading = false;
      status.textContent = "";
      draw();
    } catch (e) {
      if (!current(v)) return;
      loading = false;
      status.replaceChildren(
        document.createTextNode(e.message + " "),
        control("再试一次", () => load(which, match, append))
      );
    }
  }
  async function inspect(shot) {
    const v = ++serial;
    loading = false;
    clearImages();
    tabs.hidden = true;
    status.textContent = "";
    root.classList.add("inspecting");
    const back = control("‹ 返回相册", () => load("photos", filter), "journal-back");
    const spread = make("div", undefined, "journal-spread"),
      film = make("div", undefined, "film-sleeve");
    const print = make("canvas"),
      fields = make("div", undefined, "journal-fields"),
      input = titleInput(shot.title);
    const actions = make("div", undefined, "photo-actions"),
      confirm = make("div", undefined, "photo-confirm");
    confirm.hidden = true;
    confirm.setAttribute("role", "group");
    confirm.setAttribute("aria-label", "确认取下照片");
    const img = new Image();
    let disposeImage = () => {};
    const imageReady = new Promise((resolve, reject) => {
      disposeImage = attachImage(
        img,
        shot.id,
        signal,
        () => img.decode().then(resolve, reject),
        () => reject(new Error("load"))
      );
    });
    disposers.push(disposeImage);
    const save = control(
      "保存标题",
      async () => {
        save.disabled = true;
        input.disabled = true;
        try {
          const updated = await api(
            "/" + shot.id + "/title",
            signal,
            new URLSearchParams({ title: input.value.trim(), revision: shot.revision })
          );
          if (!current(v)) return;
          Object.assign(shot, updated);
          input.value = shot.title;
          redraw();
          status.textContent = "标题写好了。";
        } catch (e) {
          await failure(e);
        } finally {
          input.disabled = false;
          save.disabled = input.value.trim() === shot.title;
        }
      },
      "journal-primary"
    );
    save.disabled = true;
    const download = control("下载拍立得 PNG", () =>
      downloadPrint(print, shot, rabbitName)
        .then((noteText) => {
          if (current(v) && noteText) status.textContent = noteText;
        })
        .catch((e) => {
          if (current(v)) status.textContent = e.message;
        })
    );
    const remove = control(
      "取下照片",
      () => {
        confirm.hidden = false;
        confirm.querySelector("button").focus();
      },
      "photo-link"
    );
    const cancel = control("留在相册", () => {
      confirm.hidden = true;
      remove.focus();
    });
    const erase = control("确认删除", async () => {
      erase.disabled = true;
      try {
        await api("/" + shot.id + "/delete", signal, new URLSearchParams({ revision: shot.revision }));
        if (current(v)) {
          await load("photos", filter);
          if (!signal.aborted) status.textContent = "这张相纸已经取下。";
        }
      } catch (e) {
        await failure(e);
        erase.disabled = false;
      }
    });
    confirm.append(make("span", "从两个人的相册取下这张照片？"), cancel, erase);
    function redraw() {
      printPaper(print, img, { ...shot, title: input.value }, rabbitName);
    }
    redrawPrint = () => { if (img.complete && img.naturalWidth) redraw(); };
    async function failure(e) {
      if (!current(v)) return;
      if (e.status === 409 || e.status === 404) await load("photos", filter);
      if (!signal.aborted) status.textContent = e.message;
    }
    download.disabled = true;
    input.disabled = true;
    input.addEventListener("input", () => {
      redraw();
      save.disabled = input.value.trim() === shot.title;
    });
    actions.append(save, download, remove);
    fields.append(input, actions, confirm);
    film.append(print);
    spread.append(film, fields);
    content.replaceChildren(back, spread);
    content.focus({ preventScroll: true });
    root.scrollTop = 0;
    try {
      await imageReady;
      if (!current(v)) return;
      redraw();
      input.disabled = false;
      download.disabled = false;
    } catch {
      if (current(v))
        status.replaceChildren(
          document.createTextNode("这张相纸还没展开。 "),
          control("再试一次", () => inspect(shot))
        );
    }
  }
  signal.addEventListener(
    "abort",
    () => {
      serial++;
      clearImages();
      root.classList.remove("inspecting");
    },
    { once: true }
  );
  load();
  return setName;
}
