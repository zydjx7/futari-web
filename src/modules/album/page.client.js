const lifetime = new AbortController();
const page = document.querySelector("[data-album-page]");
const entry = document.querySelector("[data-rabbit-album-name]");
const setName = page
  ? (await import("./book.js")).mountAlbum(page, { signal: lifetime.signal })
  : (name) => { entry.textContent = name + "的手账相册"; };

let latestRead = 0;
async function refreshName() {
  const read = ++latestRead;
  try {
    const response = await fetch("/api/album", { signal: lifetime.signal });
    if (!response.ok) return;
    const { rabbitName } = await response.json();
    if (read === latestRead && !lifetime.signal.aborted) setName(rabbitName);
  } catch { /* Keep the current label and any unfinished caption while offline. */ }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshName();
}, { signal: lifetime.signal });
window.addEventListener("pageshow", (event) => {
  if (event.persisted) refreshName();
}, { signal: lifetime.signal });
window.addEventListener(
  "pagehide",
  (e) => {
    if (!e.persisted) lifetime.abort();
  },
  { signal: lifetime.signal }
);
