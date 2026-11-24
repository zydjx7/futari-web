export function daylight(mode, hour = new Date().getHours()) {
  if (mode && mode !== "auto") return mode;
  if (hour < 6 || hour >= 19) return "night";
  return hour >= 16 ? "dusk" : "day";
}

const nightPrints = new WeakMap();

// Tint scenery once in its own alpha, so a foreground tree still occludes the rabbit
// with exactly the painted snow silhouette on browsers without Canvas filter support.
export function nightPrint(image) {
  if (!nightPrints.has(image)) {
    const copy = document.createElement("canvas");
    copy.width = image.width;
    copy.height = image.height;
    const c = copy.getContext("2d");
    c.drawImage(image, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = "rgba(29,44,76,.43)";
    c.fillRect(0, 0, copy.width, copy.height);
    nightPrints.set(image, copy);
  }
  return nightPrints.get(image);
}

export function lightWash(ctx, w, h, light, lamp, snow = false) {
  const night = light === "night";
  const sky = ctx.createLinearGradient(0, 0, w * 0.3, h);
  const colors = {
    day: ["rgba(255,222,151,.13)", "rgba(255,249,233,0)", "rgba(255,224,165,.04)"],
    dusk: ["rgba(140,103,163,.38)", "rgba(255,162,123,.35)", "rgba(195,119,115,.21)"],
    night: ["rgba(49,63,114,.91)", "rgba(65,85,132,.81)", "rgba(90,112,149,.69)"]
  }[light];
  colors.forEach((color, i) => sky.addColorStop(i * 0.5, color));
  const x = (night || lamp?.name === "lantern") && lamp ? lamp.x + lamp.w * .5 : w * .74;
  const y = (night || lamp?.name === "lantern") && lamp ? lamp.y + lamp.h * .48 : h * .32;
  const radius = Math.max(1, Math.min(w,h) * (night ? .32 : .67));
  const glow = ctx.createRadialGradient(x,y,0,x,y,radius);
  glow.addColorStop(0, night ? "rgba(255,199,118,.34)" : light === "dusk" ? "rgba(255,211,152,.28)" : "rgba(255,249,199,.10)");
  glow.addColorStop(.45, night ? "rgba(247,174,99,.15)" : "rgba(255,221,167,.07)");
  glow.addColorStop(1, "rgba(255,212,149,0)");
  const pool = night && snow && lamp ? ctx.createRadialGradient(0,0,0,0,0,1) : null;
  if (pool) {
    pool.addColorStop(0, "rgba(255,205,122,.33)");
    pool.addColorStop(.36, "rgba(251,187,103,.22)");
    pool.addColorStop(.73, "rgba(244,168,85,.075)");
    pool.addColorStop(1, "rgba(244,168,85,0)");
  }
  return {
    night, lamp: {x, y, radius},
    paint() {
      ctx.save();
      if (night) ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = sky;
      ctx.fillRect(0,0,w,h);
      if (night) ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = glow;
      ctx.fillRect(0,0,w,h);
      if (pool) {
        // The inked foot is at y=521 on the 250..580 lamp plate.
        ctx.translate(lamp.x+lamp.w*.5,lamp.y+lamp.h*(521-250)/330);
        ctx.scale(lamp.w*.62,lamp.w*.12);
        ctx.fillStyle=pool;
        ctx.fillRect(-1,-1,2,2);
      }
      ctx.restore();
    }
  };
}

// Small reusable actor surfaces. Shade the complete silhouette once, including
// mixed washing frames. source-atop keeps the original antialias coverage.
export function nightFigure() {
  const layer = document.createElement("canvas").getContext("2d");
  const edge = document.createElement("canvas").getContext("2d");
  function reserve(c,w,h) {
    if (c.canvas.width < w) c.canvas.width = Math.ceil(w/32)*32;
    if (c.canvas.height < h) c.canvas.height = Math.ceil(h/32)*32;
    c.setTransform(1,0,0,1,0,0);
    c.clearRect(0,0,w,h);
  }
  return (ctx, lamp, puppet, x, ground, size, face, pose) => {
    const { a: px, d: py } = ctx.getTransform();
    const left = Math.floor((x - size*.99)*px), top = Math.floor((ground - size*1.58)*py);
    const w = Math.ceil(size*2*px)+3, h = Math.ceil(size*1.82*py)+3;
    reserve(layer,w,h);
    layer.save();
    layer.setTransform(px,0,0,py,-left,-top);
    puppet.draw(layer,x,ground,size,face,pose,pose.turn);
    layer.restore();
    layer.save();
    layer.globalCompositeOperation = "source-atop";
    layer.fillStyle = "rgba(22,28,48,.13)";
    layer.fillRect(0,0,w,h);
    const dx = lamp.x-x, dy = lamp.y-(ground-size*.5);
    const distance = Math.hypot(dx,dy);
    if (distance < lamp.radius) {
      reserve(edge,w,h);
      edge.save();
      edge.drawImage(layer.canvas,0,0,w,h,0,0,w,h);
      edge.globalCompositeOperation = "source-in";
      edge.fillStyle = "#ffd19a";
      edge.fillRect(0,0,w,h);
      edge.globalCompositeOperation = "destination-out";
      const offset = Math.max(.8/px,size*.009)/Math.max(1,distance);
      edge.drawImage(layer.canvas,0,0,w,h,-dx*offset*px,-dy*offset*py,w,h);
      edge.restore();
      layer.globalAlpha = .18*(1-distance/lamp.radius);
      layer.drawImage(edge.canvas,0,0,w,h,0,0,w,h);
    }
    layer.restore();
    ctx.drawImage(layer.canvas,0,0,w,h,left/px,top/py,w/px,h/py);
  };
}
