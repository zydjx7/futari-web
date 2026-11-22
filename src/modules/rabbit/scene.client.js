import art from "./layout.js";
import actionArt from "./action-layout.js";
import { Puppet, clamp, foreContact, poseCels } from "./motion.js";
import { RabbitLife } from "./movement.js";
import { createPaper, packs } from "./packs.js";
import { bowl, tunnelBack, tunnelFront, tunnelPlacement, nightLight } from "./props.js";
import { paintIcon, paintWillow, willowShape, willowRestAngle } from "./stationery.js";
import { daylight, lightWash, nightFigure, nightPrint } from "./light.js";

async function texture(name, signal) {
  signal.throwIfAborted();
  const img = new Image(),
    cancel = () => img.removeAttribute("src");
  signal.addEventListener("abort", cancel, { once: true });
  try {
    img.src = "/app/rabbit/art/" + name + ".webp";
    await img.decode();
    signal.throwIfAborted();
    return img;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
// The log rim needs its own alpha surface. Only paint these small props once per visit.
function propSprite(fn, x, y, w, h, grain) {
  const tile = document.createElement("canvas"),
    scale = 0.65;
  tile.width = Math.ceil(w * scale);
  tile.height = Math.ceil(h * scale);
  const ctx = tile.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  fn(ctx);
  if (grain) {
    const pixels = ctx.getImageData(0, 0, tile.width, tile.height);
    for (let row = 0; row < tile.height; row++)
      for (let col = 0; col < tile.width; col++) {
        const i = (row * tile.width + col) * 4;
        if (!pixels.data[i + 3]) continue;
        const fleck =
          (grain.data[((row % grain.height) * grain.width + (col % grain.width)) * 4 + 1] - 243) * 1.6;
        for (let k = 0; k < 3; k++) pixels.data[i + k] += fleck;
      }
    ctx.putImageData(pixels, 0, 0);
  }
  return tile;
}
export function shadow(c, x, y, size, p) {
  const lift = clamp(p.height / 0.177);
  const low = ["sploot", "flop", "stretch"].includes(p.action) ? p.weight + p.carry : 0;
  const stand = p.action === "stand" ? p.weight : 0;
  c.save();
  c.translate(x, y);
  c.scale(
    size * (0.44 + 0.19 * p.reach + 0.18 * low - 0.09 * stand - 0.05 * lift),
    size * (0.063 - 0.022 * lift + 0.009 * low)
  );
  const shade = c.createRadialGradient(0, 0, 0, 0, 0, 1);
  shade.addColorStop(0, "rgba(78,65,63," + (0.29 - 0.17 * lift) + ")");
  shade.addColorStop(1, "rgba(78,65,63,0)");
  c.fillStyle = shade;
  c.fillRect(-1, -1, 2, 2);
  c.restore();
}
function heart(c, x, y, s, p) {
  if (p.heart < 0.01) return;
  c.save();
  c.translate(x + s * 0.24, y - s * (0.91 + 0.17 * p.heartY));
  c.scale(s * 0.043, s * 0.043);
  c.globalAlpha = p.heart * 0.84;
  c.fillStyle = "#ce837d";
  c.beginPath();
  c.moveTo(0, 0.9);
  c.bezierCurveTo(-1.9, -0.15, -0.6, -1.4, 0, -0.49);
  c.bezierCurveTo(0.65, -1.42, 1.82, -0.14, 0, 0.9);
  c.fill();
  c.restore();
}
export async function createScene(canvas, signal, onPick, onFrame) {
  const [atlas, icons, paper, actions] = await Promise.all(
    ["caramel", "stationery", "paper", "actions"].map((name) => texture(name, signal))
  );
  signal.throwIfAborted();
  const puppet = new Puppet(atlas, art, { ...actionArt, image: actions }),
    ctx = canvas.getContext("2d");
  const swatch = document.createElement("canvas");
  swatch.width = paper.width;
  swatch.height = paper.height;
  const ink = swatch.getContext("2d");
  ink.drawImage(paper, 0, 0);
  const grain = ink.getImageData(0, 0, paper.width, paper.height);
  const sprites = {
    bowl: propSprite(bowl, 110, 680, 270, 158, grain),
    back: propSprite(tunnelBack, 1095, 425, 474, 412, grain),
    tunnel: propSprite(tunnelFront, 1095, 425, 474, 412, grain),
    lamp: propSprite(nightLight, 875, 250, 320, 330)
  };
  const rim = sprites.tunnel;
  const rimPixels = rim.getContext("2d").getImageData(0, 0, rim.width, rim.height).data;
  swatch.width = swatch.height = 1;
  let pack = createPaper(),
    loading,
    figure,
    things = [],
    layers = [],
    w = 0,
    h = 0,
    frame = 0,
    last = null;
  const paperPattern = ctx.createPattern(paper, "repeat");
  let wash, paperGlow, paintNightFigure;
  let decoration = { placed: [], light: daylight("auto") },
    meal = "hay",
    dragging = false,
    ballX = null,
    ballAngle = willowRestAngle,
    rolling = null,
    lastPush = null,
    bedVisits = 0,
    hoverAt = -9,
    lastPointer = null,
    above = false,
    aboveAt = 0,
    carry = null,
    suppressClick = false;
  const life = new RabbitLife(pack, (x, y, dx, dy, n, foot) => {
    if (!pack.step || !w || !h) return;
    const size = pack.size(w, h, x, y),
      fore = foot === "fore";
    if (life.face.view === "side") {
      const offset = fore ? foreContact(life.state.power) / 220 : -0.18;
      x += (life.face.dir * offset * size) / w;
    } else {
      y += ((life.face.view === "front" ? 1 : -1) * (fore ? 0.034 : -0.022) * size) / h;
    }
    pack.step(x, y, dx, dy, n, life.clock, foot);
  });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function ballRange(width, y) {
    // Leave room on both sides for the rabbit to turn and bring its muzzle to the ball.
    const clearance = Math.min(
      0.39,
      (0.59 * pack.size(w, h, 0.5, Math.min(0.95, y + 0.09)) + width * 0.45) / w
    );
    return [0.07 + clearance, 0.93 - clearance];
  }
  function layout() {
    things = [];
    const unit = Math.min(w, h * 1.45) * pack.propScale;
    for (const [name, [x, z]] of Object.entries(pack.props)) {
      if ((name === "ball" || name === "bed") && !decoration.placed.includes(name)) continue;
      if (name === "lamp" && decoration.light !== "night") continue;
      // The inked opening is 258 units high on the original 474-unit-wide drawing.
      const approachY = z + 0.04;
      let width, left;
      if (name === "tunnel") {
        let entryX = x;
        for (let i = 0; i < 3; i++) {
          width = pack.size(w, h, entryX, approachY) * 1.085 * 474 / 258;
          left = Math.max(0, Math.min(w * x - width / 2, w * 0.986 - width));
          entryX = (left + 0.348 * width) / w;
        }
      } else width = unit * { bowl: 0.143, bed: 0.255, ball: 0.084, lamp: 0.19 }[name];
      const tile = sprites[name],
        height = tile ? (width * tile.height) / tile.width : width;
      const base = z * h,
        bottom = base + (name === "bed" ? height * 0.17 : 0);
      if (name === "ball" && w) ballX = clamp(ballX ?? x, ...ballRange(width, z));
      things.push({
        name,
        z: name === "bed" ? z - 0.155 : z,
        x: left ?? (name === "ball" ? (ballX ?? x) : x) * w - width / 2,
        y: bottom - height,
        w: width,
        h: height,
        base
      });
    }
    layers = [...things, ...(pack.landmarks?.() || [])].sort((a, b) => a.z - b.z);
    pack.setLight?.(decoration.light);
    if (w && h) {
      wash = lightWash(
        ctx,
        w,
        h,
        decoration.light,
        things.find((o) => o.name === "lamp"),
        pack.id === "snow"
      );
      paperGlow = ctx.createRadialGradient(w * 0.51, h * 0.72, 0, w * 0.51, h * 0.72, Math.max(w, h) * 0.58);
      paperGlow.addColorStop(0, "rgba(226,185,121,.17)");
      paperGlow.addColorStop(1, "rgba(255,248,231,0)");
    }
  }
  function ballTrip() {
    const ball = things.find((o) => o.name === "ball");
    if (!ball || !w || !h) return null;
    const bx = rolling?.to ?? (ball.x + ball.w / 2) / w;
    const [left, right] = ballRange(ball.w, ball.base / h);
    const margin = Math.min((right - left) * 0.35, ball.w / w);
    const dir = bx >= right - margin ? -1 : bx <= left + margin ? 1 : life.x < bx ? 1 : -1;
    const face = { view: "side", dir },
      still = { ...life.pose(), pitch: 0, height: 0, squash: 0, push: 0, sniff: 0, breath: 0 };
    const arrivalAngle = rolling ? rolling.angle + ((bx - rolling.from) * w) / (0.42 * ball.w) : ballAngle;
    const edge = willowShape(bx * w, ball.base, ball.w, arrivalAngle).edge(dir);
    const nose = puppet.landmark("nose", face, still, "noseLow");
    let x = bx,
      y = ball.base / h;
    // Solve for the ground pivot, including the pack's depth-dependent camera scale.
    for (let i = 0; i < 5; i++) {
      const scale = pack.size(w, h, x, y) / 220;
      x = clamp((edge.x - (nose.x + dir * 3) * scale) / w, 0.07, 0.93);
      y = clamp((edge.y - nose.y * scale) / h, pack.floor(x), 0.952);
    }
    return { key: "go", x, y, after: { key: "nudge", dir } };
  }
  life.habitat = () => {
    const bed = things.find((o) => o.name === "bed");
    const [bx, by] = pack.props.bowl;
    return {
      ball: ballTrip(),
      bed: bed && { key: "go", x: pack.props.bed[0], y: bed.base / h - 0.008 },
      bowl: { key: "go", x: bx + 0.065, y: by - 0.012, after: { key: "sniff", dir: -1 } },
      ownsBed: decoration.ownsBed,
      night: decoration.light === "night"
    };
  };
  function advanceBall(p) {
    const o = things.find((thing) => thing.name === "ball");
    if (!o) return;
    const x = (o.x + o.w / 2) / w;
    if (p.action === "nudge" && p.push > 0.06 && lastPush !== life.state) {
      const size = pack.size(w, h, life.x, life.y),
        dir = life.face.dir;
      const ball = o.shape || willowShape(x * w, o.base, o.w, ballAngle),
        edge = ball.edge(dir);
      const tip = puppet.landmark("nose", life.face, p, "noseLow");
      const nx = life.x * w + (tip.x * size) / 220,
        ny = life.y * h + (tip.y * size) / 220;
      if (dir * (nx - edge.x) >= -0.75 && Math.abs(ny - edge.y) <= Math.max(2.5, o.h * 0.12)) {
        lastPush = life.state;
        rolling = {
          from: x,
          to: clamp(x + (dir * o.w * 1.15) / w, ...ballRange(o.w, o.base / h)),
          angle: ballAngle,
          at: life.clock
        };
      }
    }
    if (rolling) {
      const t = clamp((life.clock - rolling.at) / 0.77);
      ballX = rolling.from + (rolling.to - rolling.from) * (1 - (1 - t) ** 3);
      ballAngle = rolling.angle + ((ballX - rolling.from) * w) / (0.42 * o.w);
      o.x = ballX * w - o.w / 2;
      if (t === 1) rolling = null;
    }
    const cx = o.x + o.w / 2;
    if (!o.shape || o.shape.x !== cx || o.shape.angle !== ballAngle)
      o.shape = willowShape(cx, o.base, o.w, ballAngle);
  }
  function groundThing(c, o) {
    if (!pack.props[o.name]) {
      pack.paintLandmark(c, o);
      return;
    }
    if (o.name === "ball") return paintWillow(c, wash.night ? nightPrint(icons) : icons, o.shape);
    if (o.name === "bed") {
      c.save();
      c.translate(o.x + o.w / 2, o.y + o.h / 2);
      paintIcon(c, wash.night ? nightPrint(icons) : icons, o.name, 0, 0, o.w);
      c.restore();
      return;
    }
    if (o.name === "tunnel" && figure?.p.inside) {
      c.save();
      c.fillStyle = "rgba(60,42,35," + 0.21 * figure.p.inside + ")";
      c.beginPath();
      c.ellipse(o.x + o.w * (173/474), o.y + o.h * (226/412), o.w * (120/474), o.h * (133/412), -0.07, 0, 2*Math.PI);
      c.fill();
      c.restore();
    }
    const tile = sprites[o.name];
    c.drawImage(wash.night && o.name !== "lamp" ? nightPrint(tile) : tile, o.x, o.y, o.w, o.h);
    if (o.name === "bowl" && life.state.kind === "eat" && life.state.age < 1.2)
      paintIcon(c, icons, meal, o.x + o.w * 0.5, o.y + o.h * 0.28, o.w * 0.4);
  }
  function draw() {
    if (!w || !h || signal.aborted) return;
    ctx.clearRect(0, 0, w, h);
    const p = life.pose(), log = things.find((o) => o.name === "tunnel");
    const { x, ground, size, z } = tunnelPlacement(
      log, life.x * w, life.y * h, pack.size(w, h, life.x, life.y), life.y, p
    );
    p.brace = (Math.abs(p.foreSlip) * w * 220) / size;
    advanceBall(p);
    const base = ground - size * p.height;
    const side = life.face.view === "side";
    const tip = puppet.landmark("nose", life.face, p);
    const mx = tip ? x + (tip.x * size) / 220 : x + size * (side ? life.face.dir * 0.48 : -0.082);
    const my = tip ? base + (tip.y * size) / 220 : base - size * (side ? 0.49 : 0.455);
    figure = {
      cx: x,
      ground,
      base,
      size,
      face: life.face,
      p,
      z,
      mx,
      my,
      action: life.state.kind,
      ballInPlay: lastPush === life.state,
      age: life.state.age,
      scene: pack.id,
      light: decoration.light
    };
    canvas.dataset.action = life.state.kind;
    canvas.dataset.facing = life.face.view;
    canvas.dataset.light = decoration.light;
    if (pack.background) pack.background(ctx, w, h, life.clock);
    else {
      ctx.fillStyle = paperPattern;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = paperGlow;
      ctx.fillRect(0, 0, w, h);
    }
    if (wash.night) wash.paint();
    if (log) ctx.drawImage(wash.night ? nightPrint(sprites.back) : sprites.back, log.x, log.y, log.w, log.h);
    for (const o of layers) if (o.z <= z) groundThing(ctx, o);
    shadow(ctx, x, ground - 1, size, p);
    if (wash.night) {
      paintNightFigure ??= nightFigure();
      paintNightFigure(ctx, wash.lamp, puppet, x, ground, size, life.face, p);
    } else puppet.draw(ctx, x, ground, size, life.face, p, p.turn);
    if (life.state.kind === "eat" || life.state.kind === "nibble")
      paintIcon(
        ctx,
        icons,
        life.state.kind === "nibble" ? "hay" : meal,
        mx,
        my + size * 0.022,
        size * 0.17 * Math.max(0.12, 1 - life.state.age / 2.8)
      );
    heart(ctx, x, base, size, p);
    for (const o of layers) if (o.z > z) groundThing(ctx, o);
    pack.after?.(ctx, w, h, life.clock);
    if (!wash.night) wash.paint();
    if (dragging && life.face.view !== "back") {
      ctx.save();
      ctx.strokeStyle = "#ad7853";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(14, size * 0.12), 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    onFrame?.();
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    if (!w || !h) return;
    const scale = Math.min(devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    puppet.setCompact(Math.min(w, h) < 320);
    pack.resize?.(w, h);
    layout();
    draw();
  }
  function tick(now) {
    frame = 0;
    if (signal.aborted || document.hidden) return;
    last ??= now;
    if (now - last >= (life.state.kind === "idle" ? 32 : 15)) {
      if (
        above &&
        life.clock - aboveAt >= 0.22 &&
        ["idle", "listen", "tilt", "sniff", "groom", "loaf"].includes(life.state.kind) &&
        !life.pending &&
        !occupied()
      ) {
        above = false;
        hoverAt = life.clock;
        act("stand");
      }
      life.update(Math.min((now - last) / 1000, 0.07));
      last = now;
      draw();
    }
    if (!reduced.matches || life.state.kind !== "idle" || life.pending || dragging || above)
      frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (!frame && !document.hidden && !signal.aborted) {
      last = null;
      frame = requestAnimationFrame(tick);
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  document.addEventListener(
    "visibilitychange",
    () => {
      cancelAnimationFrame(frame);
      frame = 0;
      wake();
    },
    { signal }
  );
  function point(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }
  function propAt(x, y, o) {
    if (!o || o.name === "lamp") return false;
    if (o.name === "ball" && o.shape) return Math.hypot(x - o.shape.x, y - o.shape.y) <= o.w * 0.48;
    const u = (x - o.x) / o.w,
      v = (y - o.y) / o.h;
    return u >= 0.03 && u <= 0.97 && v >= (o.name === "bed" ? 0.28 : 0.12) && v <= 0.98;
  }
  function hitsRabbit(x, y) {
    const f = figure;
    return (
      f &&
      Math.abs(x - f.cx) < f.size * 0.9 &&
      y > f.base - 1.25 * f.size &&
      y < f.base + 0.07 * f.size &&
      !pack.occludes?.(x, y, f.z) &&
      !things.some((o) => o.z > f.z && hidesPixel(x, y, o)) &&
      puppet.contains(x, y, f)
    );
  }
  function hidesPixel(x, y, o) {
    if (o.name !== "tunnel") return propAt(x, y, o);
    const u = Math.floor((x - o.x) / o.w * rim.width), v = Math.floor((y - o.y) / o.h * rim.height);
    return u >= 0 && v >= 0 && u < rim.width && v < rim.height && rimPixels[4 * (v * rim.width + u) + 3] > 96;
  }
  function target(x, y) {
    if (hitsRabbit(x, y)) {
      const tail =
        figure.face.view === "back" &&
        Math.abs(x - figure.cx) < figure.size * 0.13 &&
        Math.abs(y - (figure.base - 0.18 * figure.size)) < figure.size * 0.13;
      return tail ? "peek" : "pet";
    }
    return [...things].reverse().find((o) => propAt(x, y, o))?.name;
  }
  function occupied() {
    const next = life.pending;
    return [life.state.kind, life.state.next, life.trip?.after, next?.key, next?.after].some(
      (k) => k === "eat" || k === "tunnel"
    );
  }
  function inviteIntoFrame(key) {
    // A standing head can clear a log even when the same rabbit's relaxed face is
    // hidden by it. Choose ground for the upcoming silhouette, not the old pose.
    let best,
      bestScore = -1;
    for (const [x, y] of [
      [life.x, life.y],
      [0.51, 0.81],
      [0.47, 0.89],
      [0.54, 0.72],
      [0.43, 0.78]
    ]) {
      const size = pack.size(w, h, x, y),
        dir = x > 0.52 ? -1 : 1;
      const lamp = pack.props.lamp;
      if (
        key === "loaf" &&
        pack.id === "snow" &&
        decoration.light === "night" &&
        Math.hypot(x - lamp[0], y - lamp[1]) < 0.24
      )
        continue;
      let score = 0;
      for (const dx of [-0.48, -0.19, 0.15, 0.42])
        for (const dy of [0.1, 0.27, 0.51, 0.77]) {
          const px = x * w + dx * size,
            py = y * h - dy * size;
          if (
            px > 1 &&
            px < w - 1 &&
            py > 1 &&
            py < h - 1 &&
            !pack.occludes?.(px, py, y) &&
            !things.some((o) => o.z > y && propAt(px, py, o))
          )
            score++;
        }
      if (score > bestScore) {
        best = { x, y, dir };
        bestScore = score;
      }
      if (score === 16) break;
    }
    const action = { key, dir: best.dir };
    if (Math.hypot(life.x - best.x, life.y - best.y) < 0.001) life.issue(action);
    else life.go(best.x, best.y, action);
  }
  function poseIn(box) {
    const { cx, base, size, z, p, age, action, face } = figure;
    const inFrame = (x, y) => x >= box.x && x <= box.x + box.side && y >= box.y && y <= box.y + box.side;
    const visible = (dx, dy) => {
      const x = cx + size * dx,
        y = base - size * dy;
      return inFrame(x, y) && hitsRabbit(x, y);
    };
    if (![-0.42, -0.23, 0, 0.23, 0.42].some((x) => [0.08, 0.2, 0.43, 0.66, 0.83].some((y) => visible(x, y))))
      return "scenery";
    const probe = (name) => {
      const at = puppet.landmark(name, face, p);
      return at && visible(at.x / 220, -at.y / 220);
    };
    const head = probe("head") || [-0.22, 0, 0.22].some((x) => [0.46, 0.61, 0.72].some((y) => visible(x, y)));
    if (action === "tunnel" && face.view === "front" && !p.turn && p.inside > 0.55 && head) return "tunnel";
    if (action === "peek" && p.peek > 0.42 && head) {
      const behind = [0, 0.12, -0.12].some((x) =>
        [0.06, 0.18, 0.31].some((y) => {
          const a = cx + x * size,
            b = base - size * y;
          return inFrame(a, b) && pack.occludes?.(a, b, z, "stump");
        })
      );
      return behind ? "stump" : "peek";
    }
    if (action === "pet" && p.press > 0.32 && head) return "pet";
    if ((action === "eat" || action === "nibble") && age > 0.16 && age < 2.55 && head) return "chew";
    if (action === "loaf" && p.weight > 0.55 && head) {
      const lamp = pack.props.lamp;
      return pack.id === "snow" &&
        figure.light === "night" &&
        Math.hypot(cx / w - lamp[0], figure.ground / h - lamp[1]) < 0.23
        ? "nap"
        : "loaf";
    }
    if (p.weight > 0.6) {
      const [a, b, mix] = poseCels(face, p),
        cel = mix < 0.5 ? a : b;
      const dir = face.dir,
        sideHead = puppet.landmark("head", face, p)
          ? probe("head")
          : visible(0.38 * dir, 0.25) || visible(0.32 * dir, 0.44);
      if (["groom", "stand", "alert", "tilt"].includes(action) && head) return action;
      if (action === "sniff" && (sideHead || (face.view === "front" && head))) return "sniff";
      if (
        ["flop", "sploot", "stretch"].includes(action) &&
        sideHead &&
        probe("body") &&
        (action !== "stretch" || (cel === "stretchYawn" && p.yawn > 0.48)) &&
        (action !== "flop" || cel === "onFlank")
      )
        return action;
      if (action === "nudge" && sideHead && figure.ballInPlay) {
        const ball = things.find((o) => o.name === "ball");
        if (ball) {
          const { x, y } = ball.shape;
          if (
            inFrame(x, y) &&
            !pack.occludes?.(x, y, ball.z) &&
            !things.some((o) => o.z > ball.z && propAt(x, y, o))
          )
            return "nudge";
        }
      }
    }
    if (action === "hop" && p.height > 0.043) return face.view === "side" ? "leap" : "hop";
    if (!p.turn && face.view === "back" && visible(0.01, 0.2)) return "back";
    return action === "listen" && head ? "listen" : "quiet";
  }
  function act(key, item, atBowl = false) {
    if (signal.aborted || !figure) return false;
    if (occupied()) return false;
    if (key === "pet" && (life.state.kind === "pet" || life.pending?.key === "pet")) return false;
    if (key === "tunnel" || key === "bed") {
      if (key === "bed" && !decoration.placed.includes("bed")) return false;
      const [x, y] = pack.props[key];
      const log = things.find((o) => o.name === "tunnel");
      life.go(
        key === "tunnel" ? (log.x + log.w * 0.348) / w : x,
        key === "tunnel" ? y + 0.04 : y - 0.008,
        key === "tunnel" ? "tunnel" : ["sploot", "flop", "loaf"][bedVisits++ % 3]
      );
    } else if (key === "ball" || key === "nudge") {
      const trip = ballTrip();
      if (!trip) return false;
      life.issue(trip);
    } else if (key === "eat" && atBowl) {
      meal = item;
      const [x, y] = pack.props.bowl;
      life.go(x + 0.052, y - 0.026, "eat");
    } else {
      if (key === "eat") meal = item || "hay";
      life.issue({ key });
    }
    wake();
    return true;
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.isPrimary || e.button !== 0 || dragging || !figure || occupied() || !w || !h) return;
      const [x, y] = point(e.clientX, e.clientY);
      if (!hitsRabbit(x, y)) return;
      carry = {
        id: e.pointerId,
        startX: x,
        startY: y,
        dx: life.x * w - x,
        dy: life.y * h - y,
        active: false
      };
    },
    { signal }
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!carry || e.pointerId !== carry.id || !w || !h) return;
      const [x, y] = point(e.clientX, e.clientY);
      if (!carry.active) {
        if (Math.hypot(x - carry.startX, y - carry.startY) <= 6) return;
        carry.active = true;
        suppressClick = true;
        above = false;
        life.stay();
        life.held = true;
        canvas.style.cursor = "grabbing";
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {}
      }
      const nx = clamp((x + carry.dx) / w, 0.07, 0.93);
      life.x = nx;
      life.y = clamp((y + carry.dy) / h, pack.floor(nx), 0.952);
      draw();
      wake();
      e.preventDefault();
    },
    { signal, passive: false }
  );
  function endCarry(e) {
    if (!carry || e.pointerId !== carry.id) return;
    const active = carry.active;
    carry = null;
    if (!active) return;
    life.held = false;
    life.wait = 3;
    canvas.style.cursor = "pointer";
    wake();
    try {
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {}
    requestAnimationFrame(() => {
      suppressClick = false;
    });
  }
  window.addEventListener("pointerup", endCarry, { signal });
  window.addEventListener("pointercancel", endCarry, { signal });
  canvas.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (e.detail > 1 || dragging || carry?.active) return;
      const [x, y] = point(e.clientX, e.clientY),
        pick = target(x, y);
      if (pick) onPick(pick);
      else if (y / h >= pack.floor(x / w) && !occupied()) {
        life.go(x / w, y / h);
        wake();
      }
    },
    { signal }
  );
  function watchAbove(x, y) {
    if (!figure) return;
    const near =
      Math.abs(x - figure.cx) < figure.size * 0.44 &&
      y < figure.base - 0.77 * figure.size &&
      y > figure.base - 1.59 * figure.size;
    if (near && !above && life.clock - hoverAt > 2) {
      above = true;
      aboveAt = life.clock;
      wake();
    }
    if (!near) above = false;
  }
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse" || dragging || carry?.active || !figure) return;
      const [x, y] = point(e.clientX, e.clientY);
      canvas.style.cursor = target(x, y) ? "pointer" : "default";
      if (!reduced.matches && !e.buttons && !occupied()) {
        const prev = lastPointer,
          now = e.timeStamp;
        const speed = prev ? Math.hypot(x - prev.x, y - prev.y) / Math.max(8, now - prev.now) : 0;
        if (
          prev &&
          now - prev.now < 150 &&
          speed > 0.9 &&
          Math.hypot(x - figure.cx, y - (figure.base - figure.size * 0.63)) < figure.size * 0.77 &&
          life.state.kind === "idle" &&
          life.clock - hoverAt > 2
        ) {
          hoverAt = life.clock;
          above = false;
          act("alert");
        } else watchAbove(x, y);
        lastPointer = { x, y, now };
      }
    },
    { signal }
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      above = false;
      lastPointer = null;
    },
    { signal }
  );
  canvas.addEventListener(
    "keydown",
    (e) => {
      const offsets = {
        ArrowLeft: [-0.15, 0],
        ArrowRight: [0.15, 0],
        ArrowUp: [0, -0.14],
        ArrowDown: [0, 0.14]
      };
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onPick("pet");
      }
      if (offsets[e.key] && !occupied()) {
        e.preventDefault();
        const [dx, dy] = offsets[e.key];
        life.go(life.x + dx, life.y + dy);
        wake();
      }
    },
    { signal }
  );
  signal.addEventListener(
    "abort",
    () => {
      loading?.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      pack.dispose?.();
      atlas.removeAttribute("src");
      actions.removeAttribute("src");
      icons.removeAttribute("src");
      canvas.width = canvas.height = 1;
    },
    { once: true }
  );
  canvas.dataset.scene = pack.id;
  resize();
  wake();
  function copyFrame(target, box) {
    const sx = canvas.width / w,
      sy = canvas.height / h;
    target
      .getContext("2d", { alpha: false })
      .drawImage(
        canvas,
        box.x * sx,
        box.y * sy,
        box.side * sx,
        box.side * sy,
        0,
        0,
        target.width,
        target.height
      );
  }
  return {
    act,
    occupied,
    copyFrame,
    subject() {
      if (!figure) return { x: 0.5, y: 0.55 };
      const { p, face, cx, base, size } = figure;
      const head = puppet.landmark("head", face, p),
        torso = puppet.landmark("body", face, p);
      if (head && torso)
        return {
          x: (cx + ((head.x + torso.x) * size) / 440) / w,
          y: (base + ((head.y + torso.y) * size) / 440) / h
        };
      const low = ["sploot", "flop", "stretch"].includes(p.action) ? p.weight : 0;
      const high = p.action === "stand" ? p.weight : 0;
      return {
        x: (cx + face.dir * size * (0.11 * p.noseDown + 0.05 * low)) / w,
        y: (base - size * (0.47 + 0.11 * high - 0.23 * low - 0.08 * p.noseDown)) / h
      };
    },
    capture(box) {
      if (!figure || dragging || !w || !h || !box?.side) return null;
      const photo = document.createElement("canvas");
      photo.width = photo.height = 720;
      copyFrame(photo, box);
      const now = new Date();
      return {
        photo,
        id: crypto.randomUUID(),
        captured: +now,
        offset: -now.getTimezoneOffset(),
        scene: figure.scene,
        light: figure.light,
        pose: poseIn(box),
        title: ""
      };
    },
    observe(moment) {
      if (!figure || occupied()) return false;
      if (moment === "tunnel") return act("tunnel");
      if (moment === "stump") life.go(0.293, 0.823, "peek", "hop");
      else if (moment === "nap") life.go(0.66, 0.775, "loaf");
      else if (moment === "nudge") return act("ball");
      else if (moment === "leap") life.go(life.x > 0.5 ? 0.28 : 0.73, life.y);
      else {
        const key = {
          back: "back",
          pet: "pet",
          chew: "nibble",
          sniff: "sniff",
          stand: "stand",
          groom: "groom",
          loaf: "loaf",
          sploot: "sploot",
          stretch: "stretch",
          flop: "flop",
          alert: "alert",
          tilt: "tilt"
        }[moment];
        if (!key) return false;
        inviteIntoFrame(key);
      }
      wake();
      return true;
    },
    async setPack(id) {
      loading?.abort();
      loading = null;
      if (id === pack.id) return;
      const job = new AbortController();
      loading = job;
      try {
        const next = await packs[id].create(texture, job.signal);
        if (job.signal.aborted || signal.aborted) {
          next.dispose?.();
          return;
        }
        pack.dispose?.();
        pack = next;
        ballX = rolling = lastPush = null;
        ballAngle = willowRestAngle;
        carry = null;
        suppressClick = false;
        life.setPack(next);
        canvas.dataset.scene = id;
        resize();
        wake();
      } catch (e) {
        if (!job.signal.aborted && !signal.aborted) throw e;
      } finally {
        if (loading === job) loading = null;
      }
    },
    decorate(placed, mode, ownsBed = placed.includes("bed")) {
      decoration = { placed, light: daylight(mode), ownsBed };
      layout();
      draw();
    },
    drag(on) {
      dragging = on;
      carry = null;
      suppressClick = false;
      above = false;
      life.held = on;
      if (on) life.issue({ key: "front" });
      draw();
      wake();
    },
    hoverFood(clientX, clientY) {
      if (dragging) watchAbove(...point(clientX, clientY));
    },
    canFeed(clientX, clientY) {
      if (!figure) return false;
      const [x, y] = point(clientX, clientY);
      return (
        propAt(
          x,
          y,
          things.find((o) => o.name === "bowl")
        ) ||
        (life.face.view !== "back" &&
          !pack.occludes?.(x, y, figure.z) &&
          Math.hypot(x - figure.mx, y - figure.my) < Math.max(24, figure.size * 0.21))
      );
    }
  };
}
