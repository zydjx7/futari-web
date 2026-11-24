import { mkdir, readFile, writeFile, copyFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const desktop = fileURLToPath(new URL("../", import.meta.url));
const rabbit = path.resolve(desktop, "../src/modules/rabbit");
const album = path.resolve(desktop, "../src/modules/album");
const ui = path.join(desktop, "build/ui");
for (const dir of ["vendor/scenes", "art"])
  await mkdir(path.join(ui, dir), { recursive: true });
await cp(path.join(desktop, "ui"), ui, { recursive: true });
for (const [source, target] of [
  ["motion", "motion"],
  ["groom", "groom.client"],
  ["groom-bridge", "groom-bridge.client"],
  ["pose-paint", "pose-paint.client"],
  ["movement", "movement"],
  ["art/layout", "layout"],
  ["art/action-layout", "action-layout"],
  ["stationery", "stationery"],
  ["props", "props"],
  ["packs", "packs"],
  ["scenes/paper", "scenes/paper"],
  ["scenes/snow", "scenes/snow"],
  ["light", "light"],
])
  await copyFile(
    path.join(rabbit, source + ".client.js"),
    path.join(ui, "vendor", target + ".js"),
  );
const stationery = path.join(ui, "vendor/stationery.js");
await writeFile(stationery, (await readFile(stationery,"utf8")).replace("./art/goods.webp","../art/goods.webp"));
const camera = (
  await readFile(path.join(rabbit, "camera.client.js"), "utf8")
).replace('"/app/album/paper.js"', '"./paper.js"');
await writeFile(path.join(ui, "vendor/camera.js"), camera);
for (const [source, target] of [
  ["paper.client.js", "paper.js"],
  ["book.client.js", "book.js"],
])
  await copyFile(path.join(album, source), path.join(ui, "vendor", target));
const drawers = (
  await readFile(path.join(rabbit, "drawers.client.js"), "utf8")
).replace('"/app/album/catalog.js"', '"./catalog.js"');
await writeFile(path.join(ui, "vendor/drawers.js"), drawers);
const catalog = JSON.parse(await readFile(path.join(album, "catalog.json"), "utf8"));
catalog.scenes.desktop = "桌面风景";
await writeFile(
  path.join(ui, "vendor/catalog.js"),
  "export default " + JSON.stringify(catalog),
);
const css = (await readFile(path.join(rabbit, "room.css"), "utf8"))
  .replaceAll("/app/rabbit/art/", "../art/")
  .replaceAll("/app/album/paper.webp", "../art/paper.webp");
await writeFile(path.join(ui, "vendor/room.css"), css);
const albumCss = (
  await readFile(path.join(album, "album.css"), "utf8")
).replaceAll("/app/album/paper.webp", "../art/paper.webp");
await writeFile(path.join(ui, "vendor/album.css"), albumCss);
for (const name of ["caramel", "actions", "goods", "stationery", "paper", "photography"])
  await copyFile(
    path.join(rabbit, "art", name + ".webp"),
    path.join(ui, "art", name + ".webp"),
  );
const { shop } = await import("../../src/modules/wallet/config.js");
await writeFile(
  path.join(desktop, "src-tauri/catalog.json"),
  JSON.stringify(shop, null, 2) + "\n",
);
