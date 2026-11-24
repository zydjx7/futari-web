const entry = document.querySelector("script[data-entry]").dataset.entry;
const invoke = window.__TAURI__.core.invoke;
async function load(base) {
  await Promise.all(
    ["vendor/room.css", "vendor/album.css", entry + ".css"].map(
      (path) =>
        new Promise((resolve, reject) => {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.onload = resolve;
          link.onerror = reject;
          link.href = new URL(path, base).href;
          document.head.append(link);
        }),
    ),
  );
  await import(new URL(entry + ".js", base).href);
}
const info = await invoke("ui_bundle_info");
try {
  await load(info.active ? info.origin + "/" : import.meta.url);
} catch (error) {
  if (!info.active) throw error;
  await invoke("ui_bundle_rollback", { version: info.active });
}
