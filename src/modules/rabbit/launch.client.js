const primary = document.querySelector("[data-room-shortcut]");
const account = document.querySelector("details.account");
let current, previousFocus;
primary.addEventListener("pointerdown", () => {
  previousFocus = document.activeElement;
});
function openRoom(returnTo) {
  if (current) return;
  const scroll = [scrollX, scrollY],
    reopenAccount = account.open && account.contains(returnTo),
    lifetime = new AbortController(),
    { signal } = lifetime;
  const dialog = document.createElement("dialog");
  current = dialog;
  dialog.className = "pet-room";
  dialog.setAttribute("aria-labelledby", "room-title");
  dialog.innerHTML = `<header class="room-heading"><div>
    <h2 aria-labelledby="room-title"><button type="button" class="rabbit-name-trigger" title="给小兔子改名" disabled>
      <span id="room-title">兔窝</span><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m3.4 16.7 1.1-4.6L13.7 3a1.3 1.3 0 0 1 1.9.1l1.3 1.4a1.3 1.3 0 0 1 0 1.8l-9.3 9.1zM12.1 4.7l3.1 3.2M4.5 12.1l3.1 3.3"/></svg>
    </button></h2>
    <form class="rabbit-name-form" hidden novalidate>
      <input name="name" type="text" aria-label="小兔子的名字" aria-describedby="rabbit-name-message" required autocomplete="off" enterkeyhint="done">
      <button type="submit" aria-label="保存兔名" title="保存名字"><svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10 3.8 4.2L16 5.8"/></svg></button>
    </form>
    <div class="rabbit-name-help" hidden><p id="rabbit-name-message" role="status"></p><button type="button" class="rabbit-name-cancel">取消</button></div>
    </div><button type="button" class="room-close" aria-label="收起兔窝" title="收起 · Esc" autofocus>×</button></header><div class="room-body" aria-busy="true"></div>`;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/app/rabbit/room.css";
  dialog.prepend(css);
  const paperCss = document.createElement("link");
  paperCss.rel = "stylesheet";
  paperCss.href = "/app/album/album.css";
  dialog.prepend(paperCss);
  account.open = false;
  document.documentElement.dataset.roomOpen = "";
  document.dispatchEvent(new Event("notes:overlaychange"));
  document.body.append(dialog);
  dialog.showModal();
  function close() {
    if (signal.aborted) return;
    lifetime.abort();
    if (dialog.open) dialog.close();
    dialog.remove();
    current = null;
    delete document.documentElement.dataset.roomOpen;
    if (reopenAccount) account.open = true;
    if (returnTo === document.body) document.activeElement?.blur();
    else if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    window.scrollTo({ left: scroll[0], top: scroll[1], behavior: "instant" });
    document.dispatchEvent(new Event("notes:overlaychange"));
    previousFocus = null;
  }
  dialog.querySelector(".room-close").addEventListener("click", close, { signal });
  dialog.addEventListener("close", close, { signal });
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat && dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) close();
      }
    },
    { capture: true, signal }
  );
  window.addEventListener("pagehide", close, { signal });
  import("/app/rabbit/room.js")
    .then(({ mountRoom }) => {
      if (!signal.aborted) return mountRoom(dialog, signal, (name) => {
        primary.setAttribute("aria-label", "打开兔窝，去看" + name);
        primary.title = "打开" + name + "的窝 · Alt+B";
      });
    })
    .catch(() => {
      if (!signal.aborted) {
        const body = dialog.querySelector(".room-body");
        body.removeAttribute("aria-busy");
        body.textContent = "兔窝暂时打不开，收起后再试一次。";
      }
    });
}
primary.addEventListener("click", (e) => {
  openRoom(e.detail && previousFocus?.isConnected ? previousFocus : primary);
});
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.shiftKey || !e.altKey)
    return;
  if (e.code !== "KeyB" && e.key.toLowerCase() !== "b") return;
  e.preventDefault();
  openRoom(document.activeElement instanceof HTMLElement ? document.activeElement : primary);
});
