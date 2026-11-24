import { uploadShot, make, control, downloadPrint, printPaper, titleInput } from "/app/album/paper.js";

const limit = (v, min, max) => Math.max(min, Math.min(max, v));
export function createCamera(body, signal, getScene, changed, openAlbum) {
  const panel = make("section", undefined, "instant-camera");
  panel.hidden = true;
  panel.id = "rabbit-camera";
  panel.setAttribute("aria-label", "小兔子的拍立得相机");
  body.append(panel);
  let rabbitName = "小兔子";
  let open = false,
    draft = null,
    saved = false,
    saving = false,
    zoom = 1,
    portrait = null,
    center = null,
    box = null,
    lens = null,
    frame = null;
  let drag = null,
    preview = null,
    note = null,
    status = null,
    slider = null,
    shutter = null,
    savedButton = null,
    lastGeometry = "";
  function setName(name) {
    if (rabbitName === name) return;
    rabbitName = name;
    panel.setAttribute("aria-label", name + "的拍立得相机");
    panel.querySelector(".finder-follow")?.setAttribute("aria-label", "镜头对准" + name);
    if (preview && draft) printPaper(preview, draft.photo, draft, name);
  }
  function update() {
    if (!open || !frame) return;
    const w = panel.clientWidth,
      h = panel.clientHeight;
    if (!w || !h) return;
    const desktop = getScene()?.desktopCamera;
    const baseSize = portrait?.side || Math.min(w, h) * 0.76;
    const side = Math.min(w, h, baseSize / zoom);
    const windowSize = desktop ? side : Math.min(w, h, baseSize);
    const pos = center || getScene()?.subject() || { x: 0.5, y: 0.55 };
    box = { x: limit(pos.x * w - side / 2, 0, w - side), y: limit(pos.y * h - side / 2, 0, h - side), side };
    lens.hidden = desktop || zoom === 1;
    const pixels = lens.hidden ? 1 : 720;
    if (lens.width !== pixels) lens.width = lens.height = pixels;
    if (!lens.hidden) getScene()?.copyFrame(lens, box);
    const dx = limit(box.x + (side - windowSize) / 2, 0, w - windowSize);
    const dy = limit(box.y + (side - windowSize) / 2, 0, h - windowSize);
    const geometry = [dx, dy, windowSize].map((n) => n.toFixed(2)).join(" ");
    if (geometry === lastGeometry) return;
    lastGeometry = geometry;
    frame.style.transform = "translate(" + dx + "px," + dy + "px)";
    frame.style.width = frame.style.height = windowSize + "px";
  }
  function move(x, y) {
    center = { x: limit(x, 0, 1), y: limit(y, 0, 1) };
    update();
  }
  function magnify(value) {
    zoom = limit(Math.round(value * 100) / 100, Number(slider.min), 2.8);
    slider.value = String(zoom);
    slider.setAttribute("aria-valuetext", zoom.toFixed(1) + " 倍");
    update();
  }
  function close() {
    if (!open) return;
    open = false;
    frame = lens = null;
    drag = null;
    box = null;
    if (saved) draft = null;
    preview = note = status = savedButton = slider = shutter = null;
    panel.hidden = true;
    panel.replaceChildren();
    body.classList.remove("with-camera");
    changed(false);
  }
  function closeButton() {
    const b = control(
      "‹",
      () => {
        close();
        body.querySelector('[data-item="camera"]')?.focus({ preventScroll: true });
      },
      "camera-close"
    );
    b.setAttribute("aria-label", "收起相机");
    b.title = "收起相机 · C";
    return b;
  }
  async function save() {
    if (saving || !draft || saved) return;
    saving = true;
    const shot = draft;
    savedButton.disabled = true;
    note.disabled = true;
    status.textContent = "正在收好相纸…";
    try {
      const stored = await uploadShot(shot, signal);
      if (signal.aborted || draft !== shot) return;
      shot.title = stored.title;
      saved = true;
      if (open) develop(false);
      else draft = null;
    } catch (e) {
      if (!signal.aborted && draft === shot && open) {
        status.textContent = e.message;
        note.disabled = false;
        savedButton.disabled = false;
      }
    } finally {
      saving = false;
      if (open && saved && draft === shot) note.disabled = true;
    }
  }
  function develop(animate) {
    frame = lens = null;
    drag = null;
    panel.dataset.mode = "print";
    const card = make("div", undefined, "develop-station");
    const heading = make("header", undefined, "journal-heading");
    heading.append(make("h3", "这一瞬间"), closeButton());
    preview = printPaper(make("canvas"), draft.photo, draft, rabbitName);
    const film = make("div", undefined, "film-sleeve" + (animate ? " emerging" : ""));
    film.append(preview);
    note = titleInput(draft.title);
    note.disabled = saved || saving;
    note.addEventListener("input", () => {
      draft.title = note.value;
      printPaper(preview, draft.photo, draft, rabbitName);
    });
    const actions = make("div", undefined, "photo-actions");
    savedButton = control(
      saved ? "翻开相册" : "收进相册",
      () => (saved ? openAlbum() : save()),
      "journal-primary"
    );
    savedButton.disabled = saving && !saved;
    const download = control("下载拍立得 PNG", () =>
      downloadPrint(preview, draft, rabbitName)
        .then((noteText) => {
          if (status && noteText) status.textContent = noteText;
        })
        .catch((e) => {
          if (status) status.textContent = e.message;
        })
    );
    const again = control(
      "再拍一张",
      () => {
        if (saving) return;
        draft = null;
        saved = false;
        view();
      },
      "photo-link"
    );
    actions.append(savedButton, download, again);
    status = make("p", saved ? "已收进你们的相册。" : "", "photo-status");
    status.setAttribute("role", "status");
    card.append(heading, film, note, actions, status);
    panel.replaceChildren(card);
    if (animate) {
      const flash = make("i", undefined, "shutter-flash");
      flash.setAttribute("aria-hidden", "true");
      panel.append(flash);
      flash.addEventListener("animationend", () => flash.remove(), { once: true });
      savedButton.focus({ preventScroll: true });
    }
  }
  let exposing = false;
  async function expose() {
    if (!open || !frame || saving || exposing) return;
    update();
    const finder = frame;
    exposing = true;
    try {
      const shot = await getScene()?.capture(box);
      if (!shot || !open || frame !== finder) return;
      draft = shot;
      saved = false;
      develop(true);
    } catch (error) {
      if (frame === finder) {
        const message = panel.querySelector(".finder-message") || make("span", "", "finder-message");
        message.setAttribute("role", "status");
        message.textContent = String(error?.message || error);
        panel.querySelector(".finder-tools").append(message);
      }
    } finally {
      exposing = false;
    }
  }
  function view() {
    preview = note = status = savedButton = null;
    panel.dataset.mode = "frame";
    lastGeometry = "";
    const area = make("div", undefined, "finder-floor");
    frame = make("div", undefined, "finder-frame");
    frame.tabIndex = 0;
    frame.setAttribute("role", "group");
    const desktop = getScene()?.desktopCamera;
    frame.setAttribute("aria-label", desktop ? "移动鼠标取景，左键拍照，Esc 收起" : "取景框。拖动或方向键移动，滚轮调焦，空格拍摄");
    for (let i = 0; i < 4; i++) frame.append(make("i"));
    lens = make("canvas", undefined, "finder-lens");
    lens.setAttribute("aria-hidden", "true");
    frame.append(lens);
    area.append(frame);
    const tools = make("div", undefined, "finder-tools"),
      focus = make("label", "焦距");
    slider = make("input");
    slider.type = "range";
    slider.min = desktop ? "0.35" : "1";
    slider.max = "2.8";
    slider.step = ".05";
    slider.value = String(zoom);
    slider.addEventListener("input", () => magnify(+slider.value));
    focus.append(slider);
    shutter = control("快门", expose, "shutter");
    shutter.setAttribute("aria-label", "按下快门");
    const follow = control("对准兔子", () => {
      center = null;
      update();
    }, "finder-follow");
    follow.setAttribute("aria-label", "镜头对准" + rabbitName);
    tools.append(focus, shutter, follow);
    if (draft && !saved) tools.append(control("上张相纸", () => develop(false)));
    panel.replaceChildren(area, closeButton(), tools);
    update();
    frame.focus({ preventScroll: true });
    if (desktop) {
      const aim = (e) => {
        const bounds = area.getBoundingClientRect();
        move((e.clientX - bounds.left) / bounds.width, (e.clientY - bounds.top) / bounds.height);
      };
      area.addEventListener("pointermove", aim);
      area.addEventListener("click", (e) => {
        if (e.button !== 0) return;
        aim(e);
        expose();
      });
    }
    area.addEventListener("pointerdown", (e) => {
      if (desktop || !e.isPrimary || e.button !== 0 || !box) return;
      const bounds = area.getBoundingClientRect(),
        x = e.clientX - bounds.left,
        y = e.clientY - bounds.top;
      if (!frame.contains(e.target)) move(x / bounds.width, y / bounds.height);
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        cx: box.x + box.side / 2,
        cy: box.y + box.side / 2
      };
      area.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    area.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      move(
        (drag.cx + e.clientX - drag.x) / area.clientWidth,
        (drag.cy + e.clientY - drag.y) / area.clientHeight
      );
    });
    area.addEventListener("lostpointercapture", () => {
      drag = null;
    });
    area.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        magnify(zoom - Math.sign(e.deltaY) * 0.1);
      },
      { passive: false }
    );
    frame.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) expose();
        return;
      }
      const d = {
        ArrowLeft: [-0.035, 0],
        ArrowRight: [0.035, 0],
        ArrowUp: [0, -0.035],
        ArrowDown: [0, 0.035]
      }[e.key];
      if (d && box) {
        e.preventDefault();
        move(
          (box.x + box.side / 2) / panel.clientWidth + d[0],
          (box.y + box.side / 2) / panel.clientHeight + d[1]
        );
      }
    });
  }
  function start(fresh = false) {
    if (!getScene() || (saving && fresh)) return;
    if (fresh || saved) {
      draft = null;
      saved = false;
      center = null;
    }
    if (fresh) zoom = 1;
    open = true;
    panel.hidden = false;
    portrait = getScene()?.portrait?.();
    if (portrait && panel.clientWidth && panel.clientHeight)
      center = { x: portrait.x / panel.clientWidth, y: portrait.y / panel.clientHeight };
    body.classList.add("with-camera");
    changed(true);
    if (saving && draft) develop(false);
    else view();
  }
  signal.addEventListener(
    "abort",
    () => {
      close();
      draft = null;
      preview = null;
      panel.remove();
    },
    { once: true }
  );
  return { start, close, update, setName, isOpen: () => open };
}
