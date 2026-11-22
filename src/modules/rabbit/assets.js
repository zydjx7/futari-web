import launch from "./launch.client.js";
import room from "./room.client.js";
import nameEditor from "./name-editor.client.js";
import downloadCard from "./download-card.client.js";
import drawers from "./drawers.client.js";
import scene from "./scene.client.js";
import motion from "./motion.client.js";
import groom from "./groom.client.js";
import groomBridge from "./groom-bridge.client.js";
import posePaint from "./pose-paint.client.js";
import movement from "./movement.client.js";
import light from "./light.client.js";
import camera from "./camera.client.js";
import props from "./props.client.js";
import stationery from "./stationery.client.js";
import packs from "./packs.client.js";
import layout from "./art/layout.client.js";
import actionLayout from "./art/action-layout.client.js";
import paperPack from "./scenes/paper.client.js";
import snowPack from "./scenes/snow.client.js";
import css from "./room.css";
import { plain } from "../../shared/http.js";

const scripts = {
  "room.js": room,
  "name-editor.js": nameEditor,
  "drawers.js": drawers,
  "download-card.js": downloadCard,
  "scene.js": scene,
  "motion.js": motion,
  "groom.client.js": groom,
  "groom-bridge.client.js": groomBridge,
  "pose-paint.client.js": posePaint,
  "movement.js": movement,
  "light.js": light,
  "camera.js": camera,
  "props.js": props,
  "stationery.js": stationery,
  "packs.js": packs,
  "layout.js": layout,
  "action-layout.js": actionLayout,
  "scenes/paper.js": paperPack,
  "scenes/snow.js": snowPack
};
const images = {
  "art/caramel.webp": () => import("./art/caramel.webp"),
  "art/actions.webp": () => import("./art/actions.webp"),
  "art/stationery.webp": () => import("./art/stationery.webp"),
  "art/photography.webp": () => import("./art/photography.webp"),
  "art/paper.webp": () => import("./art/paper.webp"),
  "art/snow-field.webp": () => import("./art/snow-field.webp"),
  "art/snow-foreground.webp": () => import("./art/snow-foreground.webp")
};

export async function roomAsset(ctx, path) {
  if (ctx.role !== "her") return plain("没有权限", 403);
  if (!ctx.read) return plain("请使用 GET", 405, { Allow: "GET, HEAD" });
  const name = path.slice("/app/rabbit/".length);
  const send = (body, type) => new Response(body, { headers: { "Content-Type": type } });
  if (path === "/app/room-launch.js") return send(launch, "text/javascript; charset=utf-8");
  if (Object.hasOwn(scripts, name)) return send(scripts[name], "text/javascript; charset=utf-8");
  if (Object.hasOwn(images, name)) return send((await images[name]()).default, "image/webp");
  if (name === "room.css") return send(css, "text/css; charset=utf-8");
  return plain("找不到内容", 404);
}
