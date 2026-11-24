import { GroomPaint, groomCels } from "./groom.client.js";
import { PeekTorso, RegisteredRise, standingEdges } from "./pose-paint.client.js";
export { groomDuration } from "./groom.client.js";

const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
function ease(a, b, t) {
  const f = clamp((t - a) / (b - a));
  return f * f * (3 - 2 * f);
}
const rad = Math.PI / 180;
const turnWidth = (air) => 1 - 0.035 * Math.sin(Math.PI * air) ** 2;
const turnBlend = (turn) => (turn.waking ? ease(0, 1, turn.progress) : ease(0.405, 0.575, turn.progress));
// Ground contact in the painted landing pose, in the same 220-unit space as the rig.
export const foreContact = () => (0.5 - 0.215) * 229;

const cycles = {
  hop: [
    [0, "hopGather"],
    [0.13, "hopLoad"],
    [0.22, "hopLoad"],
    [0.4, "hopAir"],
    [0.46, "hopAir"],
    [0.62, "hopLand"],
    [0.66, "hopLand"],
    [0.85, "hopGather"]
  ],
  flop: [
    [0, "halfRoll"],
    [0.105, "halfRoll"],
    [0.18, "onFlank"]
  ],
  stretch: [
    [0, "stretchLow"],
    [0.29, "stretchLow"],
    [0.44, "stretchYawn"],
    [0.64, "stretchYawn"],
    [0.78, "stretchLow"]
  ]
};
const stills = { sploot: "sploot", loaf: "loaf", nudge: "noseLow", sniff: "noseLow" };
const asleep = { flop: "onFlank", sploot: "sploot", loaf: "loaf" };

// The short intervals between held contact drawings drive anatomical registration.
export function poseCels(face, p) {
  if (p.turn?.waking) {
    const k = face.view === "front" ? "loaf" : "sploot";
    return [k, k, 0];
  }
  const key = p.action;
  const rest = face.view === "side" ? "hopGather" : null;
  if (face.view !== (["groom", "stand", "loaf"].includes(key) ? "front" : "side")) return [rest, rest, 0];
  if (key === "groom") return groomCels(p.phase);
  if (p.wakeProgress != null) {
    const u=p.wakeProgress;
    if (key === "flop") return u < .52 ? ["onFlank","halfRoll",ease(0,.48,u)] : ["halfRoll",rest,ease(.52,1,u)];
    return [key,rest,ease(0,1,u)];
  }
  if (key === "stand") {
    const rise=p.standRise ?? p.weight;
    if (rise<.50) return [null,"standHalf",2*rise];
    if (rise<1) return ["standHalf","stand",2*rise-1];
    return ["stand","stand",0];
  }
  if (key === "stretch" && p.fromRest === "flop" && p.carry > 0) {
    const u = 1 - p.carry;
    return u < 0.55 ? ["onFlank", "halfRoll", ease(0, 0.46, u)]
      : ["halfRoll", "stretchLow", ease(0.60, 1, u)];
  }
  const seq = cycles[key],
    still = stills[key];
  if (!seq && !still) return [rest, rest, 0];
  let a = still,
    b = still,
    mix = 0;
  if (seq) {
    const i = seq.findIndex(([t]) => t > p.phase);
    if (i < 1) a = b = seq[i < 0 ? seq.length - 1 : 0][1];
    else {
      const [start, prev] = seq[i - 1],
        [end, next] = seq[i];
      const center = (start + end) / 2;
      const half = key === "hop" ? (end - start) / 2 : Math.min((end - start) / 2, 0.018);
      a = prev;
      b = next;
      mix = a === b ? 0 : ease(center - half, center + half, p.phase);
    }
  }
  if (key !== "hop") {
    const envelope = ease(0.1, 0.86, p.weight);
    if (envelope < 1) return [p.carry > 0 ? asleep[p.fromRest] : rest, mix < 0.5 ? a : b, envelope];
  }
  return [a, b, mix];
}
function readMasks(encoded) {
  return Object.fromEntries(
    Object.entries(encoded).map(([k, [w, h, bits]]) => [
      k,
      [w, h, Uint8Array.from(atob(bits), (s) => s.charCodeAt(0))]
    ])
  );
}
function maskAt(mask, u, v) {
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const [w, h, bits] = mask,
    i = Math.floor(v * h) * w + Math.floor(u * w);
  return Boolean(bits[i >> 3] & (128 >> i % 8));
}

// A common coordinate system puts the contact point of every rig at (0, 0).
// One neutral rabbit is approximately 220 units tall, including the ears.
class Puppet {
  constructor(atlas, art, extra = null) {
    this.atlas = atlas;
    this.art = art;
    this.extra = extra;
    this.parts = { ...art.parts, ...extra?.parts };
    if(extra?.groom?.bridges)this.parts.wash_earMid=this.parts[extra.groom.bridges.base];
    this.solo = null;
    this.mix = null;
    this.blendScale = 1.25;
    this.hits = readMasks({ ...art.hits, ...extra?.hits });
    if (extra?.layers) Object.assign(this.hits, readMasks({standHalf:extra.layers.standHit}));
    this.probe = null;
  }
  motionPiece(name) {
    this.pieces??=new Map();
    if(this.pieces.has(name))return this.pieces.get(name);
    const blocks=this.extra.layers.pieces[name];
    const x=Math.min(...blocks.map(b=>b[0])), y=Math.min(...blocks.map(b=>b[1]));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(...blocks.map(b=>b[0]+b[4]))-x;
    canvas.height=Math.max(...blocks.map(b=>b[1]+b[5]))-y;
    const ctx=canvas.getContext("2d");
    ctx.imageSmoothingEnabled=false;
    for(const [dx,dy,sx,sy,w,h] of blocks)
      ctx.drawImage(this.extra.layerImage||this.extra.image,sx,sy,w,h,dx-x,dy-y,w,h);
    const piece={canvas,x,y};
    this.pieces.set(name,piece);
    return piece;
  }
  coatTile(name) {
    const shift = this.extra?.baseCoat?.[name];
    if (!shift && name !== "bPeek") return null;
    this.coatTiles ??= new Map();
    if (!this.coatTiles.has(name)) {
      const [x, y, w, h] = this.parts[name], tile = document.createElement("canvas");
      tile.width = w;
      tile.height = h;
      const c = tile.getContext("2d");
      c.drawImage(this.atlas, x, y, w, h, 0, 0, w, h);
      // Only these three articulated pieces need a midtone adjustment. Keep the
      // approved reference file intact and prepare each tile once, on first use.
      try {
        const pixels = c.getImageData(0, 0, w, h), data = pixels.data;
        if (name === "bPeek") {
          // The chin painting ends at the pencil. Its source crop also contains
          // a few unconnected backing texels and a small wedge below that line.
          for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
            const i=4*(y*w+x), chin=109.8-.0058*(x-50)**2;
            data[i+3] = data[i+3]<9 ? 0 : data[i+3]*(1-ease(chin-.35,chin+.8,y));
          }
        } else for (let i = 0; i < data.length; i += 4) {
          if (data[i+3] <= 220) continue;
          const r = data[i], g = data[i+1], b = data[i+2], lum = .299*r + .587*g + .114*b;
          const weight = ease(124,155,lum) * (1-ease(200,228,lum)) * ease(58,95,r-b)
            * ease(12,31,g-b) * ease(220,250,data[i+3]);
          for (let k = 0; k < 3; k++) data[i+k] += weight*shift[k];
        }
        c.putImageData(pixels, 0, 0);
        this.coatTiles.set(name, tile);
      } catch (e) {
        if (e.name !== "SecurityError") throw e;
        this.coatTiles.set(name, null);
      }
    }
    return this.coatTiles.get(name);
  }
  part(c, name, x, y, w, h, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    if (this.probe) {
      if (this.probe.hit || c.globalAlpha < 0.15) return;
      const m = c.getTransform(),
        dx = this.probe.x - m.e,
        dy = this.probe.y - m.f;
      const det = m.a * m.d - m.b * m.c;
      if (det !== 0) {
        const u = ((m.d * dx - m.c * dy) / det - x) / w;
        const v = ((m.a * dy - m.b * dx) / det - y) / h;
        this.probe.hit = u >= u0 && u < u1 && v >= v0 && v < v1 && maskAt(this.hits[name], u, v);
      }
      return;
    }
    if(name==="standHalf") {
      const tile=this.motionPiece(name), size=this.parts.wash1_lift[2];
      return c.drawImage(tile.canvas,x+tile.x*w/size,y+tile.y*h/size,tile.canvas.width*w/size,tile.canvas.height*h/size);
    }
    if(name==="wash_earMid" && this.extra?.groom?.bridges)
      return c.drawImage(this.groomPaint.midCanvas(),x,y,w,h);
    const [u, v, sw, sh] = this.parts[name];
    const tile = this.coatTile(name);
    c.drawImage(
      tile || (this.extra?.parts[name] ? this.extra.image : this.atlas),
      (tile ? 0 : u) + sw * u0,
      (tile ? 0 : v) + sh * v0,
      sw * (u1 - u0),
      sh * (v1 - v0),
      x + w * u0,
      y + h * v0,
      w * (u1 - u0),
      h * (v1 - v0)
    );
  }
  stamp(c, name, x, y, width, ax = 0.5, ay = 1, angle = 0, sx = 1, sy = 1) {
    const rect = this.parts[name];
    const height = (width * rect[3]) / rect[2];
    c.save();
    c.translate(x, y);
    c.rotate(angle * rad);
    c.scale(sx, sy);
    this.part(c, name, -width * ax, -height * ay, width, height);
    c.restore();
  }
  front(c, p, body=true) {
    const draw = (name) => this.part(c, name, ...this.art.front[name]);
    const joint = (x, y, angle, sx, sy, fn) => {
      c.save();
      c.translate(x, y);
      c.rotate(angle * rad);
      c.scale(sx, sy);
      c.translate(-x, -y);
      fn();
      c.restore();
    };
    const alert = p.action === "alert" ? p.weight : 0;
    if(body)joint(0, -3, 0, 1 + 0.012 * p.press, 1 + 0.01 * p.breath - 0.03 * p.press, () => draw("fBody"));
    const liftHead = 5 * p.load + 4 * p.impact - 4 * p.rear + 4 * p.noseDown - 4 * alert;
    c.save();
    c.translate(-0.8 * p.press, liftHead + 2.9 * p.press - 1.35 * p.breath);
    joint(-17.5, -76.7, p.tilt - 0.6 * p.press, 1, 1, () => {
      const flat = p.press;
      joint(12, -164.7, 74 * flat + p.ear - 13 * alert + 7 * p.load, 1 - 0.27 * flat, 1 - 0.22 * flat, () =>
        draw("fRightEar")
      );
      joint(
        -44.9,
        -164.5,
        -78 * flat - p.ear * 0.42 + 14 * alert - 8 * p.load,
        1 - 0.21 * flat,
        1 - 0.2 * flat,
        () => draw("fLeftEar")
      );
      joint(-18, -100, 0, 1 + 0.038 * p.chew, 1 - 0.012 * p.chew, () => draw("fHead"));
      c.save();
      c.translate(0, p.sniff * 0.58 + p.chew * 1.8);
      draw("fNose");
      c.restore();
      const lid = p.blink * (1 - alert);
      const opacity = c.globalAlpha;
      for (const [name, x] of [
        ["Left", -58.5],
        ["Right", 20.8]
      ]) {
        c.globalAlpha = opacity * (1 - ease(0.5, 0.95, lid));
        if (c.globalAlpha > 0)
          joint(x, -131, 0, 1 + 0.15 * alert, 1 - 0.92 * lid, () => draw("f" + name + "Eye"));
        c.globalAlpha = opacity * ease(0.32, 0.84, lid);
        if (c.globalAlpha > 0) joint(x, -130, 0, 0.79, p.washLids ? -0.87 : 0.87, () => draw("f" + name + "Lid"));
      }
      c.globalAlpha = opacity;
    });
    c.restore();
  }
  back(c, p) {
    const look = p.peek,
      lift = 1.35 * p.breath,
      rear = this.art.rear;
    const patch = (name, x, y) => {
      const [dx, dy, w, h] = rear.boxes[name];
      this.part(c, name, x + dx, y + dy, w, h);
    };
    c.save();
    c.scale(1 - 0.04 * p.rear, 1 + 0.009 * p.breath + 0.045 * p.rear);
    if (p.rear > 0.02) {
      // Show the rounded toes already painted into the back drawing at liftoff.
      for (const sign of [-1, 1]) {
        c.save();
        c.translate(sign * 43, -5 + 10 * p.rear);
        c.scale(sign, 1);
        this.part(c, "bBody", -33, -139, 96, 139, 0.178, 0.895, 0.456, 1);
        c.restore();
      }
    }
    c.save();
    c.transform(1,0,-.27*look,1,-30.25*look,0);
    this.stamp(c, "bLeft", -29 + 5 * look, -148, 43, 0.5, 0.95, -7 - p.ear * 0.75 + look * 11 - p.stride * 4);
    this.stamp(c, "bRight", 27, -148, 43, 0.5, 0.94, 6 + p.ear + look * 16 + p.stride * 5);
    c.restore();
    if (look > 0.001 && this.peekTorso===undefined) {
      try { this.peekTorso=new PeekTorso(this); }
      catch (error) {
        if(error.name!=="SecurityError")throw error;
        this.peekTorso=null;
      }
    }
    if (look > 0.001 && this.peekTorso) {
      this.peekTorso.draw(c,look,this.probe);
    } else {
      patch("bNape", -92, -rear.height);
      patch("bBody", -92, -rear.height);
      if(look>.5)patch("bPeek",-44,-167.7);
    }
    this.stamp(
      c,
      "bTail",
      2 + 2.0 * look,
      -39 - lift - 16 * p.rear + 5 * p.impact,
      53,
      0.51,
      0.53,
      -6 + p.tail + look * 8,
      1 + 0.02 * p.breath,
      1 - 0.012 * p.breath
    );
    c.restore();
  }
  neutral(c, face, p) {
    if (face.view === "front") this.front(c, p);
    else if (face.view === "back") this.back(c, p);
  }
  geometry(key, face, p) {
    if(key==="standHalf")return this.geometry("wash1_lift",face,p);
    const spec = this.extra.frames[key],
      [, , sw, sh] = this.parts[key];
    const w = spec.width,
      h = spec.height ?? (w * sh) / sw;
    const mirror = face.view === "side" && face.dir === 1 ? -1 : 1;
    if (key.startsWith("wash"))
      return { w, h, left: -w * spec.pivot[0], top: -h * spec.pivot[1], mirror: 1, sx: 1, sy: 1, lean: 0, dx: 0 };
    // A small forward lean about the planted back foot brings the drawn nose to the ball.
    // Shearing the whole inked silhouette leaves its toes on the ground.
    const nose = key === "noseLow";
    const sx = nose ? 1 + 0.053 * p.push + 0.0022 * p.sniff : 1;
    const sy = 1 + (key === "onFlank" || key === "sploot" ? 0.009 : 0.006) * p.breath;
    const pin = key === "hopLand" ? (p.brace || 0) * p.planted : 0;
    const earSway = !nose && !key.startsWith("hop") ? p.ear * 0.0015 : 0;
    const lean = earSway + (key === "stand" ? p.tilt * 0.004 : 0) + pin / h;
    const dx = pin + (1 - sx) * w * 0.33;
    return { w, h, left: -w * spec.pivot[0], top: -h * spec.pivot[1], mirror, sx, sy, lean, dx };
  }
  cel(c, key, face, p, detail = 1) {
    if (!key) return this.neutral(c, face, p);
    if(key==="wash_earMid" && !this.groomPaint)this.groomPaint=new GroomPaint(this,face,p);
    const g = this.geometry(key, face, p);
    c.save();
    c.transform(g.mirror * g.sx, 0, g.mirror * g.lean, g.sy, g.mirror * g.dx, 0);
    if (key === "hopGather") this.gather(c, g, p, detail);
    else this.part(c, key, g.left, g.top, g.w, g.h);
    c.restore();
  }
  gather(c, g, p, detail) {
    const key = "hopGather";
    const ear = p.ear * 0.0045 * detail;
    if (Math.abs(ear) > 0.0002) {
      // Deform the top of the intact painting about a line above the crown. Ears and
      // face meet at the exact same coordinates, including when looking right.
      const split = 0.205;
      const hinge = g.top + g.h * split;
      c.save();
      c.transform(1, 0, ear, 1, -ear * hinge, 0);
      this.part(c, key, g.left, g.top, g.w, g.h, 0, 0, 1, split);
      c.restore();
      this.part(c, key, g.left, g.top, g.w, g.h, 0, split, 1, 1);
    } else this.part(c, key, g.left, g.top, g.w, g.h);
    const blink = p.blink * detail;
    if (blink > 0.001 && !this.probe && this.extra.blink) this.sideBlink(c, g, blink);
  }
  sideBlink(c, g, amount) {
    const { skin, offset, eye } = this.extra.blink;
    const [ax, ay, sw, sh] = this.parts.hopGather,
      [px, py] = offset,
      [, , pw, ph] = skin;
    const [ex, ey, ew, eh] = eye,
      t = ease(0, 1, amount),
      sy = 1 - 0.91 * t;
    const crease = ey + eh * 0.7;
    c.save();
    c.translate(g.left, g.top);
    c.scale(g.w / sw, g.h / sh);
    c.save();
    c.beginPath();
    c.ellipse(ex + ew / 2, ey + eh / 2, ew / 2 + 2, eh / 2 + 2, 0, 0, 2 * Math.PI);
    c.clip();
    c.drawImage(this.extra.image, ...skin, px, py, pw, ph);
    c.restore();
    const alpha = c.globalAlpha;
    const lid = ease(0.55, 0.93, t);
    if (lid < 1) {
      c.globalAlpha = alpha * (1 - lid);
      c.drawImage(this.extra.image, ax + px, ay + py, pw, ph, px, crease + (py - crease) * sy, pw, ph * sy);
    }
    if (lid > 0) {
      c.globalAlpha = alpha * lid;
      const width = ew * 1.2,
        height = (width * this.parts.fLeftLid[3]) / this.parts.fLeftLid[2];
      c.drawImage(
        this.atlas,
        ...this.parts.fLeftLid,
        ex + (ew - width) / 2,
        crease - height * 0.6,
        width,
        height
      );
    }
    c.restore();
  }
  marker(key, face, p, name) {
    const g = this.geometry(key, face, p);
    const half={nose:[.40,.45],head:[.415,.376],body:[.51,.72]};
    const [u, v] = (key==="standHalf"?half:this.extra.frames[key])[name];
    const x = g.left + g.w * u,
      y = g.top + g.h * v;
    return { x: g.mirror * (g.sx * x + g.lean * y + g.dx), y: g.sy * y };
  }
  register(a, before, b, after, mix, p) {
    const bothEyes = before.dir === after.dir && this.extra.frames[a]?.eye && this.extra.frames[b]?.eye;
    const head = (key, face) => {
      if (key) return this.marker(key, face, p, bothEyes ? "eye" : "head");
      return face.view === "back" ? { x: 0, y: -137 } : { x: -18, y: -117 };
    };
    const from = head(a, before),
      to = head(b, after);
    const width = (key) => (key ? this.extra.frames[key==="standHalf"?"wash1_lift":key].width : 208);
    const useNext = mix >= 0.5;
    const key = useNext ? b : a,
      at = useNext ? to : from;
    const widthAt = width(a) + (width(b) - width(a)) * mix;
    const hx = from.x + (to.x - from.x) * mix;
    const hy = from.y + (to.y - from.y) * mix;
    const sx = clamp(widthAt / width(key), 0.9, 1.1);
    // A single exposure passes through the moving head landmark. The ground pivot
    // stays planted. Even at half-roll there is only one pair of inked ears.
    return {
      key,
      face: useNext ? after : before,
      sx,
      sy: bothEyes ? clamp(hy / at.y, 0.87, 1.16) : clamp(hy / at.y, 0.9, 1.12),
      lean: clamp((hx - sx * at.x) / at.y, -0.2, 0.2)
    };
  }
  registered(c, a, before, b, after, mix, p) {
    const r = this.register(a, before, b, after, mix, p);
    c.save();
    c.transform(r.sx, 0, r.lean, r.sy, 0, 0);
    const detail = a === b ? 1 : ease(0.5, 1, Math.max(mix, 1 - mix));
    this.cel(c, r.key, r.face, p, detail);
    c.restore();
  }
  landmark(name, face, p, forceKey) {
    if (forceKey) return this.marker(forceKey, face, p, name);
    if (!this.extra?.frames) return null;
    const [a, b, mix] = poseCels(face, p);
    if (((p.action === "groom" || p.action === "stand") && face.view === "front") || p.wakeProgress!=null) {
      const rest = { nose: { x: -18, y: -102 }, head: { x: -18, y: -126 }, body: { x: 12, y: -56 } }[name];
      const start = a ? this.marker(a, face, p, name) : rest, end = b ? this.marker(b, face, p, name) : rest;
      const release = p.groomRelease || 0;
      return { x: (start.x + (end.x - start.x) * mix) * (1 - release) + rest.x * release,
        y: (start.y + (end.y - start.y) * mix) * (1 - release) + rest.y * release };
    }
    const key = mix < 0.5 ? a : b;
    if (!key) return null;
    const at = this.marker(key, face, p, name);
    if (a === b || mix === 0 || mix === 1) return at;
    const r = this.register(a, face, b, face, mix, p);
    return { x: at.x * r.sx + at.y * r.lean, y: at.y * r.sy };
  }
  rising(c,face,p,from,to,mix) {
    if(p.action==="stand"){
      const cache=this.standPaints??=new Map();
      if(!cache.has(from)){
        try{cache.set(from,new RegisteredRise(this,face,p,from,to));}
        catch(e){if(e.name!=="SecurityError")throw e;cache.set(from,null);}
      }
      const paint=cache.get(from);
      if(!paint)return this.registered(c,from,face,to,face,mix,p);
      c.save();
      if(to==="stand"){
        const g=this.geometry("stand",face,p),extension=g.h/this.extra.standRegistrationHeight;
        c.transform(1,0,mix*g.lean,1+mix*(extension*g.sy-1),0,0);
      }
      paint.draw(c,mix,this.probe);
      c.restore();
      return;
    }
    if(this.risePaint!==null && this.risePaint?.from!==from){
      try { this.risePaint=new RegisteredRise(this,face,p,from,to); }
      catch(error){
        if(error.name!=="SecurityError")throw error;
        this.risePaint=null;
      }
    }
    if(!this.risePaint)return this.registered(c,from,face,to,face,mix,p);
    c.save();
    if(face.view==="side" && face.dir===1)c.scale(-1,1);
    this.risePaint.draw(c,mix,this.probe);
    c.restore();
  }
  paint(c, face, p) {
    if (!this.extra?.frames) return this.neutral(c, face, p);
    if(p.action!=="groom" && this.groomPaint)this.groomPaint=null;
    if(p.action==="stand" && !this.probe && p.phase<.045 && this.extra.layers){
      // Spread one-off preparation across the planted anticipation. The first
      // travelling frame no longer pays for decoding both registrations.
      if(!this.pieces?.has("standHalf"))this.motionPiece("standHalf");
      else if(!this.standBoundaries)this.standBoundaries=standingEdges(this.parts.wash1_lift[2]);
      else {
        this.standPaints??=new Map();
        for(const [from,to] of [[null,"standHalf"],["standHalf","stand"]]){
          if(this.standPaints.has(from))continue;
          try{this.standPaints.set(from,new RegisteredRise(this,face,p,from,to));}
          catch(e){if(e.name!=="SecurityError")throw e;this.standPaints.set(from,null);}
          break;
        }
      }
    } else if(p.action!=="stand" && this.standPaints) {
      this.standPaints=null;
      this.standBoundaries=null;
    }
    const [a, b, mix] = poseCels(face, p);
    if (p.action === "stand" && face.view === "front" && this.extra.groom && a!==b && mix>0 && mix<1) {
      return this.rising(c,face,p,a,b,mix);
    }
    if (p.wakeProgress != null && a!==b && mix>0 && mix<1) return this.rising(c,face,p,a,b,mix);
    if (p.action === "groom" && face.view === "front" && this.extra.groom) {
      this.groomPaint ??= new GroomPaint(this, face, p);
      return this.groomPaint.play(c,p.phase,p.groomRelease || 0);
    }
    if (a === b || mix === 0 || mix === 1) return this.cel(c, mix === 1 ? b : a, face, p);
    this.registered(c, a, face, b, face, mix, p);
  }
  setCompact(compact) {
    this.blendScale = compact ? 0.5 : 1.25;
    if (!this.mix) return;
    for (const c of [this.solo, this.mix]) {
      c.canvas.width = Math.ceil(320 * this.blendScale);
      c.canvas.height = Math.ceil(300 * this.blendScale);
    }
  }
  buffers() {
    if (this.mix) return;
    for (const name of ["solo", "mix"]) this[name] = document.createElement("canvas").getContext("2d");
    this.setCompact(this.blendScale === 0.5);
  }
  blend(c, mix, left, right) {
    if (this.probe) {
      if (mix < 0.85) left(c);
      if (mix > 0.15) right(c);
      return;
    }
    this.buffers();
    const solo = this.solo,
      sum = this.mix,
      k = this.blendScale,
      { width: w, height: h } = sum.canvas,
      ground = 276 * k;
    sum.clearRect(0, 0, w, h);
    sum.globalCompositeOperation = "lighter";
    for (const [paint, alpha] of [
      [left, 1 - mix],
      [right, mix]
    ]) {
      solo.clearRect(0, 0, w, h);
      solo.save();
      solo.translate(w / 2, ground);
      solo.scale(k, k);
      paint(solo);
      solo.restore();
      sum.globalAlpha = alpha;
      sum.drawImage(solo.canvas, 0, 0);
    }
    sum.globalAlpha = 1;
    c.drawImage(sum.canvas, -w / (2 * k), -ground / k, w / k, h / k);
  }
  paintTurn(c, turn, p) {
    const t = turnBlend(turn);
    if (turn.waking && this.extra?.frames) {
      this.registered(c, "loaf", turn.from, "sploot", turn.to, t, p);
      return;
    }
    if (this.extra?.frames && turn.from.view === "side" && turn.to.view === "side" && turn.from.dir !== turn.to.dir) {
      // A half-turn passes through the actual front drawing at the apex. Both
      // profiles stay rounded and use the same articulated path for hit testing.
      const u = turn.progress, front = { view: "front", dir: turn.to.dir };
      c.save();
      c.scale(1 - .075 * Math.sin(Math.PI * turn.air) ** 2, 1);
      if (u < .5) this.registered(c, "hopGather", turn.from, null, front, ease(.18, .49, u), p);
      else this.registered(c, null, front, "hopGather", turn.to, ease(.51, .82, u), p);
      c.restore();
      return;
    }
    const throughSide = this.extra?.frames && turn.from.view !== "side" && turn.to.view !== "side" && turn.from.view !== turn.to.view;
    c.save();
    // The back drawing is already narrower than the face. As the shoulder
    // turns into view, allow a little of its width at this intermediate angle.
    c.scale(throughSide ? 1 + .018 * Math.sin(Math.PI * turn.air) ** 2 : turnWidth(turn.air), 1);
    if (throughSide) {
      const side = { view: "side", dir: turn.to.dir };
      if (turn.progress < .5) this.registered(c,null,turn.from,"hopGather",side,ease(.18,.49,turn.progress),p);
      else this.registered(c,"hopGather",side,null,turn.to,ease(.51,.82,turn.progress),p);
    } else if (!t || t === 1) this.paint(c, t === 1 ? turn.to : turn.from, p);
    else if (turn.from.view === "side" || turn.to.view === "side") {
      // At maximum foreshortening, pass a single inked face through the turning head
      // landmark. Mixing both exposures here would briefly show two pairs of ears.
      const from = turn.from.view === "side" ? "hopGather" : null;
      const to = turn.to.view === "side" ? "hopGather" : null;
      this.registered(c, from, turn.from, to, turn.to, t, p);
    } else
      this.blend(
        c,
        t,
        (ctx) => this.paint(ctx, turn.from, p),
        (ctx) => this.paint(ctx, turn.to, p)
      );
    c.restore();
  }
  place(c, x, ground, size, p) {
    c.translate(x, ground - p.height * size);
    c.scale((size / 220) * (1 + p.squash * 0.55), (size / 220) * (1 - p.squash));
    c.rotate(p.pitch * rad);
  }
  contains(x, y, figure) {
    // Reuse the live joint transforms and small one-bit masks. This also works on file://
    // where the browser may forbid reading pixels from a canvas with local image textures.
    if (!this.hitContext) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      this.hitContext = canvas.getContext("2d");
    }
    const c = this.hitContext,
      { cx, ground, size, face, p } = figure,
      turn = p.turn;
    this.probe = { x, y, hit: false };
    c.save();
    this.place(c, cx, ground, size, p);
    if (turn) this.paintTurn(c, turn, p);
    else this.paint(c, face, p);
    const hit = this.probe.hit;
    this.probe = null;
    c.restore();
    return hit;
  }
  draw(c, x, ground, size, face, p, turn) {
    c.save();
    this.place(c, x, ground, size, p);
    if (turn) this.paintTurn(c, turn, p);
    else this.paint(c, face, p);
    c.restore();
  }
}
export { Puppet, clamp, ease, readMasks, maskAt };
