import { clamp, ease, groomDuration } from "./motion.js";

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const same = (a, b) => a.view === b.view && (a.view !== "side" || a.dir === b.dir);
const sleep = new Set(["loaf", "sploot", "flop"]);
const stretchChance = { loaf: .30, sploot: .65, flop: .80 };
const flank = new Set(["sniff", "sploot", "stretch", "flop", "nudge"]);
const durations = {
  peek: 2.46,
  pet: 2.25,
  eat: 2.8,
  nibble: 2.8,
  tunnel: 3.68,
  listen: 2.10,
  sniff: 2.3,
  stand: 3.50,
  groom: groomDuration,
  stretch: 3.6,
  nudge: 2.1,
  alert: 1.65,
  tilt: 2.4
};
const standDrop = .37;
function standLevel(age) {
  return ease(.17,.51,age)*(1-ease(3.05,3.42,age));
}
function pulse(start,end,time) {
  if (time<=start || time>=end) return 0;
  return Math.sin(Math.PI*(time-start)/(end-start))**2;
}
const tunnelTurn = [1.02, 1.60];

// Ground-space progress, airborne height and limb timing share this one clock.
export function hopBeat(t) {
  const air = clamp((t - 0.22) / 0.4);
  const brake = clamp((t - 0.62) / 0.23);
  const settle = clamp((t - 0.85) / 0.15);
  // Explosive launch, continuous residual speed at forepaw contact,
  // then deceleration to a planted stance. No advance while loading or settling.
  const contactSpeed = (0.2 / 0.23) * 0.4;
  const travel = air * (1.8 - contactSpeed - (0.9 - contactSpeed) * air) + 0.1 * (1 - (1 - brake) ** 2);
  const load = ease(0, 0.16, t) * (1 - ease(0.18, 0.3, t));
  return {
    travel,
    arc: 4 * air * (1 - air),
    load,
    reach: ease(0.22, 0.41, t) * (1 - ease(0.64, 0.85, t)),
    kick: ease(0.22, 0.39, t) * (1 - ease(0.56, 0.83, t)),
    rear: ease(0.25, 0.48, t) * (1 - ease(0.64, 0.85, t)),
    impact: ease(0.6, 0.71, t) * (1 - ease(0.73, 0.88, t)),
    rebound: Math.sin(settle * Math.PI * 2) * (1 - settle)
  };
}

export class RabbitLife {
  constructor(pack, onStep) {
    this.onStep = onStep;
    this.pack = pack;
    this.held = false;
    this.x = 0.49;
    this.y = 0.76;
    this.face = { view: "front", dir: -1 };
    this.clock = 0;
    this.calm = .45;
    this.calmTarget = .45;
    this.sampleAt = 0;
    this.waryUntil = 0;
    this.petTimes = [];
    this.breathPhase = 0;
    this.breathPeriod = 2.9;
    this.auto = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.habitat = null;
    this.tread = 0;
    this.activeLeft = Math.floor(rand(2, 5));
    this.restBias = null;
    this.autoIndex = 0;
    this.blinkAt = 2.9;
    this.earAt = 1.6;
    this.stay();
    this.wait = 6;
  }
  setPack(pack) {
    this.pack = pack;
    this.y = clamp(this.y, pack.floor(this.x), 0.94);
    this.activeLeft = Math.floor(rand(2, 5));
    this.restBias = null;
    this.autoIndex = 0;
    this.stay();
  }
  stay(afterArrival = false) {
    this.state = { kind: "idle", age: 0 };
    this.follow = null;
    this.trip = this.pending = null;
    this.arrival = afterArrival;
    this.wait = afterArrival ? rand(0.3, 0.65) : rand(2.1, 4.8);
  }
  get petStreak() {
    return this.petTimes.filter(at => this.clock - at <= 12).length;
  }
  dropped() {
    this.held = false;
    this.stay();
    this.calm = clamp(this.calm - .25);
    this.waryUntil = Math.max(this.waryUntil, this.clock + 15);
    this.state = { kind: "landed", age: 0, duration: 1 };
  }
  issue(task) {
    if (task.key === "pet") {
      this.calm = clamp(this.calm + .22);
      this.petTimes = this.petTimes.filter(at => this.clock - at <= 12);
      this.petTimes.push(this.clock);
    }
    const s = this.state;
    this.trip = null;
    this.arrival = false;
    if (["idle", "savor", "landed"].includes(s.kind)) this.begin(task);
    else {
      this.pending = task;
      // Finish the current contact/turn and let persistent poses release their joints.
      if (!["turn", "hop", "eat", "tunnel"].includes(s.kind) && s.release == null) {
        s.release = s.age;
        if (s.kind === "stand") s.releaseTime = Math.max(.12,standDrop*standLevel(s.age));
        if (s.kind === "groom") s.releaseTime = .32;
      }
    }
  }
  go(x, y, after = null, gait = "auto") {
    this.issue({ key: "go", x, y, gait, after, arrival: !after });
  }
  begin(task) {
    this.pending = null;
    this.autoRest = task.autoRest;
    this.follow = task.follow;
    if (task.x != null) {
      const x = clamp(task.x, 0.07, 0.93),
        y = clamp(task.y, this.pack.floor(x), 0.952);
      const dx = x - this.x,
        dy = y - this.y;
      this.trip = { ...task, x, y, hops: 0, pauseAt: Math.floor(rand(3, 6)) };
      const depth = Math.abs(dy) > 0.028 && Math.abs(dy) > 0.55 * Math.abs(dx);
      this.aim({ view: depth ? (dy < 0 ? "back" : "front") : "side", dir: Math.sign(dx) || -1 }, "travel");
    } else {
      const key = task.key === "rest" ? "loaf" : task.key;
      const view = ["peek", "back", "tunnel"].includes(key) ? "back" : flank.has(key) ? "side" : "front";
      this.aim({ view, dir: task.dir || this.face.dir }, key);
    }
  }
  aim(face, next) {
    if (same(this.face, face)) this.finishTurn(next);
    else this.state = { kind: "turn", from: this.face, to: face, next, age: 0, duration: 0.59 };
  }
  finishTurn(next) {
    if (next === "travel" && this.trip) this.nextStep();
    else if (sleep.has(next)) {
      if (this.autoRest && ((next === "flop" && (this.calm < .72 || this.clock < this.waryUntil))
        || (next === "sploot" && this.calm < .45))) return this.begin({ key: "loaf" });
      const duration = next === "loaf" ? rand(20, 40) : next === "sploot" ? rand(35, 75)
        : this.habitat?.(false)?.desktop ? rand(90, 180) : rand(60, 150);
      this.state = { kind: next, age: 0, duration };
      this.restBias = null;
    } else if (Object.hasOwn(durations, next)) {
      if (next === "alert") {
        this.calm = clamp(this.calm - .35);
        this.waryUntil = this.clock + 25;
      }
      if (next === "eat") this.calm = clamp(this.calm + .18);
      if (["groom", "eat", "nudge", "tunnel"].includes(next)) this.restBias = next;
      this.state = { kind: next, age: 0, duration: next === "sniff" && this.follow === "eat" ? .8 : durations[next] };
    }
    else this.stay();
  }
  nextStep() {
    const trip = this.trip;
    if (!trip) return this.stay();
    const dx = trip.x - this.x,
      dy = trip.y - this.y;
    const depth = 0.7 + 0.6 * this.pack.depth(this.x, this.y);
    const distance = Math.hypot(dx, dy * 1.2) / depth;
    if (distance < 0.001) {
      this.trip = null;
      if (trip.after) this.begin(typeof trip.after === "string" ? { key: trip.after } : trip.after);
      else this.stay(Boolean(trip.arrival));
      return;
    }
    if (trip.hops === trip.pauseAt && distance > 0.11) {
      trip.pauseAt += Math.floor(rand(3, 6));
      this.state = { kind: "sniff", age: 0, duration: 1.1, trailPause: true };
      // Keep the travel facing; a fore/aft hop can pause with its nose out of view.
      return;
    }
    const short = distance < 0.093 || (["short", "walk"].includes(trip.gait) && distance < 0.2);
    const span = short ? rand(0.042, 0.059) : rand(0.117, 0.145);
    const fraction = Math.min(1, span / distance);
    const power = clamp(distance / span, 0.38, 1) * (short ? 0.48 : 1);
    this.tread++;
    trip.hops++;
    this.state = {
      kind: "hop",
      gait: short ? "short" : "bound",
      continues: this.face.view === "side" && fraction < 1,
      age: 0,
      duration: short ? rand(0.41, 0.52) : rand(0.59, 0.72),
      power,
      height: (short ? 0.084 : 0.177) * (0.65 + 0.35 * power),
      x0: this.x,
      y0: this.y,
      x1: this.x + dx * fraction,
      y1: this.y + dy * fraction
    };
  }
  wander() {
    const env = this.habitat?.() || {};
    const hungry = (env.satiety ?? 70) < 30;
    if (this.activeLeft === 0) {
      this.activeLeft = Math.floor(rand(2, 5));
      const rests = ["loaf"];
      if (env.night || env.bed || env.quietSpot || this.restBias === "groom") rests.push("loaf", "loaf");
      if (this.calm >= .45) {
        rests.push("sploot");
        if (env.mat || (env.satiety ?? 70) >= 70 || ["nudge", "tunnel", "eat"].includes(this.restBias))
          rests.push("sploot", "sploot");
      }
      if (this.calm >= .72 && this.clock >= this.waryUntil) rests.push("flop");
      if (hungry && env.bowl) rests.push("loaf", "loaf", "loaf");
      const rest = pick(rests);
      const spot = rest === "sploot" ? env.mat || env.bed : rest === "loaf" ? env.quietSpot || env.bed : env.bed;
      const nap = { key: rest, autoRest: true };
      this.begin(spot ? { ...spot, after: nap } : nap);
      return;
    }
    this.activeLeft--;
    if (hungry && env.bowl && Math.random() < .25) {
      this.begin({ ...env.bowl, after: { key: "sniff", follow: "tilt" } });
      return;
    }
    let route = this.pack.wander(this.autoIndex++, this.x);
    if (sleep.has(route.key)) route = { key: "sniff" };
    if (sleep.has(route.after) || route.after === "rest") route = { ...route, after: "sniff" };
    this.begin(pick([route, { key: "groom" }, { key: "stand" }, { key: "tilt" },
      env.ball, env.tunnel, env.applewood, env.bowl].filter(Boolean)));
  }
  update(dt) {
    this.clock += dt;
    if (this.clock >= this.sampleAt) {
      const env = this.habitat?.(false) || {};
      const satiety = env.satiety ?? 70;
      this.calmTarget = .45 + (env.ownsBed || env.bed || env.mat ? .15 : 0) + (env.night ? .10 : 0)
        + (satiety >= 70 ? .15 : satiety < 30 ? -.15 : 0);
      this.sampleAt = this.clock + 1;
    }
    this.calm = lerp(this.calmTarget, this.calm, Math.exp(-dt / 90));
    const period = { loaf: 3.8, sploot: 4.4, flop: 5 }[this.state.kind] ?? 2.9;
    this.breathPeriod = lerp(period, this.breathPeriod, Math.exp(-dt / 2));
    this.breathPhase += dt * 2 * Math.PI / this.breathPeriod;
    if (this.clock - this.blinkAt > 0.23) this.blinkAt = this.clock + rand(2.8, 5.2);
    if (this.clock - this.earAt > 0.68) this.earAt = this.clock + (sleep.has(this.state.kind) ? rand(10, 20) : rand(2.5, 6.5));
    this.advance(dt);
  }
  wakeFromRest(stretch) {
    const s = this.state;
    const melt = stretch == null && s.kind === "loaf" && this.calm >= .62 && Math.random() < .35;
    stretch ??= !melt && Math.random() < stretchChance[s.kind];
    if (!stretch && !melt) {
      // Retrace the painted exit. The side sleeper passes through halfRoll in pose().
      s.release = s.age;
      s.naturalRise = true;
      s.releaseTime = s.kind === "flop" ? 0.64 : 0.52;
    } else if (s.kind === "loaf") {
      this.state = {kind:"turn", from:this.face, to:{view:"side",dir:-1}, waking:true, melt, age:0, duration:0.48};
    } else {
      this.state = {kind:"stretch", fromRest:s.kind, age:0, duration:durations.stretch};
      if (s.kind === "flop" && Math.random() < .75) this.follow = "groom";
    }
  }
  advance(dt) {
    const s = this.state;
    s.age += dt;
    if (s.kind === "idle") {
      this.wait -= dt;
      if (this.held || this.wait > 0) return;
      if (this.arrival) {
        this.arrival = false;
        this.begin({ key: pick(["sniff", "stand", "sniff", "peek", "back"]) });
      } else if (this.auto) this.wander();
      return;
    }
    const t = clamp(s.age / s.duration);
    if (s.kind === "tunnel")
      this.face = { view: s.age < (tunnelTurn[0]+tunnelTurn[1])/2 ? "back" : "front", dir:this.face.dir };
    if (s.kind === "hop") {
      const { travel } = hopBeat(t);
      const dx = s.x1 - s.x0,
        dy = s.y1 - s.y0;
      this.x = s.x0 + dx * travel;
      this.y = s.y0 + dy * travel;
      for (const [threshold, foot, at] of [
        [0.62, "fore", 0.9],
        [0.85, "hind", 1]
      ]) {
        if (t >= threshold && !s[foot]) {
          s[foot] = true;
          this.onStep?.(s.x0 + dx * at, s.y0 + dy * at, dx, dy, this.tread, foot);
        }
      }
    }
    // Once both feet have gathered, fold the end of a travelling bound straight
    // into the next load. Only the final bound uses its full settling time.
    const nextBeat = s.continues && this.trip && !this.pending ? 0.9 : 1;
    if (s.release != null ? s.age - s.release < (s.releaseTime ?? 0.23) : t < nextBeat) return;
    if (s.kind === "turn") this.face = s.to;
    if (s.waking) {
      if (s.melt) {
        this.finishTurn("sploot");
        this.state.settled = true;
      } else this.state = { kind: "stretch", fromRest: "sploot", age: 0, duration: durations.stretch };
      if (this.pending) this.state.release = 0;
      return;
    }
    if (this.pending) return this.begin(this.pending);
    if (s.kind === "turn") this.finishTurn(s.next);
    else if (s.kind === "hop" || (s.trailPause && this.trip)) {
      this.nextStep();
      const carry = s.age - nextBeat * s.duration;
      if (carry > 0 && this.state.kind === "hop") this.advance(carry);
    } else if (sleep.has(s.kind) && s.release == null) {
      this.wakeFromRest(this.held ? false : undefined);
    }
    else if (s.kind === "pet") {
      this.state = { kind: "savor", age: 0, duration: rand(4, 7), strokes: this.petStreak };
    } else if (s.kind === "savor" && s.strokes >= 3 && this.calm >= .78 && this.clock >= this.waryUntil)
      this.begin({ key: "flop", autoRest: true });
    else if (s.kind === "savor" && s.strokes >= 2 && this.calm >= .65 && Math.random() < .80)
      this.begin({ key: "loaf" });
    else if (s.kind === "landed" && Math.random() < .50) this.begin({ key: "groom" });
    else if (this.follow === "apple-heart") {this.earAt=this.appleHeartAt=this.clock;this.stay();}
    else if (this.follow) this.begin({key:this.follow});
    else if (s.kind === "nudge") this.begin({ key: "tilt" });
    else this.stay();
  }
  pose() {
    const s = this.state,
      time = this.clock,
      t = clamp(s.age / (s.duration || 1));
    const blinkAge = time - this.blinkAt,
      earAge = time - this.earAt;
    const release = s.release == null ? 1 : 1 - ease(0, s.releaseTime || 0.23, s.age - s.release);
    const entryT = Math.min(1, s.age / 5.4);
    const enter = s.settled ? 1 : ease(0, 0.16, sleep.has(s.kind) ? entryT : t);
    const weight = enter * (sleep.has(s.kind) ? 1 : 1 - ease(0.79, 1, t)) * release;
    const p = {
      action: s.kind,
      wakeProgress: s.naturalRise ? clamp((s.age-s.release)/s.releaseTime) : undefined,
      phase: t,
      weight,
      fromRest: s.fromRest,
      carry: s.fromRest ? (1 - enter) * release : 0,
      breath: Math.sin(this.breathPhase),
      sniff: Math.sin(time * Math.PI * 4.9),
      blink: blinkAge >= 0 && blinkAge < 0.22 ? Math.sin((Math.PI * blinkAge) / 0.22) : 0,
      ear: earAge > 0 && earAge < 0.65 ? 6 * Math.sin(earAge * 18) * Math.sin((Math.PI * earAge) / 0.65) : 0,
      tilt: s.kind === "idle" ? 2 * Math.sin(time * 0.9) : 0,
      tail: 1.9 * Math.sin(time * 3.8),
      press: 0,
      peek: 0,
      stride: 0,
      height: 0,
      squash: 0,
      pitch: 0,
      turn: null,
      heart: Math.max(0,1-(time-(this.appleHeartAt??-10))),
      heartY: 0,
      chew: 0,
      inside: 0,
      load: 0,
      kick: 0,
      reach: 0,
      rear: 0,
      impact: 0,
      foreSlip: 0,
      planted: 0,
      power: 0,
      backLift: 0,
      noseDown: 0,
      push: 0,
      yawn: 0
    };
    if (s.kind === "hop") {
      const b = hopBeat(t);
      for (const k of ["load", "kick", "reach", "rear", "impact"]) p[k] = b[k] * s.power;
      p.height = b.arc * s.height;
      p.stride = b.arc * s.power;
      // The four painted side keys already compress and extend anatomically.
      const elasticity = this.face.view === "side" ? 0.32 : 1;
      const settle = s.continues ? 1 - ease(0.85, 0.9, t) : 1;
      p.squash = elasticity * (0.095 * p.load + 0.05 * p.impact + 0.045 * b.rebound * settle * s.power);
      p.backLift = 9 * p.rear;
      p.power = s.power;
      if (t >= 0.62) {
        p.planted = 1 - ease(0.83, 0.97, t);
        p.foreSlip = (s.x1 - s.x0) * (b.travel - 0.9);
      }
    } else if (s.waking) {
      p.turn = { from: s.from, to: s.to, progress: t, air: 0, waking: true };
    } else if (s.kind === "turn") {
      const air = clamp((t - 0.18) / 0.6);
      p.height = 0.14 * 4 * air * (1 - air);
      p.squash =
        0.07 * Math.sin(Math.PI * clamp(t / 0.18)) + 0.06 * Math.sin(Math.PI * clamp((t - 0.78) / 0.22));
      p.turn = { from: s.from, to: s.to, progress: t, air };
    } else if (s.kind === "pet") {
      p.press = weight;
      p.tilt = -2 * weight;
      p.heart = ease(0.12, 0.28, t) * (1 - ease(0.61, 0.8, t)) * release;
      p.heartY = clamp((t - 0.12) / 0.68);
    } else if (s.kind === "eat" || s.kind === "nibble") {
      p.chew = weight * Math.sin(s.age * 17);
      p.tilt = -3 * weight;
      p.sniff *= 1.6;
    } else if (s.kind === "tunnel") {
      const age = s.age;
      const entry = clamp((age - 0.24) / 0.68), exit = clamp((age - 2.87) / 0.62);
      const arc = u => 4*u*(1-u);
      p.inside = ease(0,1,entry) * (1-ease(0,1,exit));
      p.tunnelPeek = ease(1.60,1.86,age) * (1-ease(2.87,3.27,age));
      p.height = 0.12*arc(entry) + 0.135*arc(exit);
      p.load = Math.sin(Math.PI*clamp(age/.24)) + Math.sin(Math.PI*clamp((age-2.65)/.22));
      p.impact = Math.sin(Math.PI*clamp((age-.92)/.15)) + Math.sin(Math.PI*clamp((age-3.49)/.19));
      p.squash = 0.068*p.load + 0.052*p.impact;
      p.rear = 0.92*arc(entry);
      p.tilt = p.tunnelPeek * (3.5 + 2.5*Math.sin((age-1.85)*4));
      p.blink = Math.max(p.blink,Math.sin(Math.PI*clamp((age-2.39)/.19)));
      if (age > tunnelTurn[0] && age < tunnelTurn[1]) {
        const progress = (age-tunnelTurn[0])/(tunnelTurn[1]-tunnelTurn[0]);
        p.turn = { from: { view: "back", dir: this.face.dir }, to: { view: "front", dir: this.face.dir },
          progress, air: progress };
      }
    }
    else if (s.kind === "peek") {
      p.peek = weight;
      p.tail += 10 * weight * Math.sin(s.age * 14);
    } else if (s.kind === "sniff" || s.kind === "nudge") {
      p.push = s.kind === "nudge" ? ease(0.22, 0.44, t) * (1 - ease(0.5, 0.68, t)) * weight : 0;
      p.noseDown = weight;
      p.sniff = 2.1 * Math.sin(s.age * 30) * weight;
    } else if (s.kind === "listen") {
      const age=s.age;
      const listen=ease(0,.28,age)*(1-.07*ease(1.43,1.60,age))*(1-ease(1.60,2.10,age))*release;
      p.weight=listen;
      p.tilt=12.5*listen;
      p.ear=(-4.8+2.8*pulse(.88,1.15,age))*listen;
    } else if (s.kind === "tilt") p.tilt = 13 * weight;
    else if (s.kind === "stand") {
      const age=s.release ?? s.age;
      const rise=standLevel(age)*release;
      p.standRise = rise;
      p.weight = ease(0,1,rise);
      p.squash=(.033*pulse(0,.235,age)-.022*pulse(.39,.66,age)+.008*pulse(.60,.80,age)
        +.024*pulse(3.30,3.50,age))*release;
      p.tilt=3.8*Math.sin(s.age*2.6)*ease(.55,1,rise);
    }
    else if (s.kind === "groom") {
      // Eyelids and the moving ear are painted into the keys. On interruption release
      // the exact stroke that was on screen without advancing to another expression.
      if (s.release != null) p.phase = clamp(s.release / s.duration);
      p.groomRelease = 1 - release;
      const age=s.release ?? s.age;
      p.squash=(.024*pulse(0,.23,age)-.011*pulse(.27,.48,age)
        +.017*pulse(5.64,5.89,age))*release;
    } else if (s.kind === "flop") {
      p.phase = entryT;
      if (s.release != null) {
        p.phase = Math.min(s.release / 5.4, 0.19) * release;
        p.weight = ease(0, 0.16, p.phase);
      }
      const tip = ease(0, 0.063, entryT) * (1 - ease(0.063, 0.145, entryT));
      p.pitch = this.face.dir * 6 * tip * release;
      p.squash = 0.055 * ease(0.12, 0.16, entryT) * (1 - ease(0.16, 0.28, entryT)) * release;
    } else if (s.kind === "stretch") p.yawn = ease(0.29, 0.46, t) * (1 - ease(0.61, 0.78, t)) * release;
    return p;
  }
}
