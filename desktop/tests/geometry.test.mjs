import { test } from "node:test";
import assert from "node:assert/strict";
import { alphaRuns, alphaRunsBox, desktopSize, nestDestination, field, location, rabbitPortrait } from "../ui/geometry.js";
test("portrait fits visible fur and leaves room ahead of the nose", () => {
  const pixels = new Uint8ClampedArray(20 * 20 * 4);
  assert.equal(rabbitPortrait(pixels, 20, 20, 0, 0, 100, 1), null);
  for (let y = 4; y < 16; y++) {
    for (let x = 6; x < 14; x++) pixels[(y * 20 + x) * 4 + 3] = 255;
  }
  const { x, y, side } = rabbitPortrait(pixels, 20, 20, 0, 0, 100, 1);
  assert.ok(Math.abs(60 / side - 0.76) < 0.01);
  assert.ok(x > 50 && y < 50);
  assert.ok(x - side / 2 < 30 && x + side / 2 > 70 && y - side / 2 < 20 && y + side / 2 > 80);
});
test("transparent gap between ears stays clickable underneath", () => {
  const rgba = new Uint8ClampedArray(4 * 5 * 5);
  for (const i of [6, 8, 11, 12, 13]) rgba[i * 4 + 3] = 255;
  const { rows } = alphaRuns(rgba, 5, 5, 5, 1);
  const isHit = (x, y) =>
    rows.some(([l, t, r, b]) => l <= x && x < r && t <= y && y < b);
  assert.equal(isHit(2, 1), false);
  assert.equal(isHit(2, 2), true);
  assert.equal(isHit(1, 1), true);
  assert.equal(isHit(0, 0), false);
});
test("physical taskbar edge with 150% DPI and negative monitor origin", () => {
  const v = {
    display: {
      screen: { x: -1920, y: 0, w: 1920, h: 1080 },
      work: { x: -1920, y: 0, w: 1920, h: 1020 },
    },
    settings: { mode: "overlay", patrol: "taskbar" },
  };
  const f = field(v, 1280, 720, 1.5);
  assert.equal(location(f, 0.5, 0.78).ground, 680);
});
test("rectangular alphaRunsBox supports desktop multi-prop hit masks", () => {
  const rgba = new Uint8ClampedArray(4 * 4 * 3);
  rgba[(0 * 4 + 0) * 4 + 3] = 255;
  rgba[(2 * 4 + 3) * 4 + 3] = 255;
  const { w, h, rows } = alphaRunsBox(rgba, 4, 3, 40, 30, 1);
  assert.deepEqual([w, h], [40, 30]);
  assert.deepEqual(rows, [
    [0, 0, 10, 10],
    [30, 20, 40, 30],
  ]);
});

test("desktop-only uses the full-roam rabbit size and walking bounds at each DPI", () => {
  const display = { screen: { x: 0, y: 0 }, work: { x: 0, y: 0, w: 1920, h: 1024 } };
  for (const dpi of [1, 1.5, 2]) {
    const box = (mode, patrol) => field({display, settings: {mode, patrol}},1920/dpi,1080/dpi,dpi);
    const full = box("overlay","full");
    assert.deepEqual(box("desktop","taskbar"), full);
    const clickToWalk = {display, settings: {mode:"overlay", patrol:"taskbar"}, playMode:true};
    assert.deepEqual(field(clickToWalk,1920/dpi,1080/dpi,dpi), full);
    assert.equal(box("overlay","taskbar").strip, true);
  }
});

test("desktop scale and nest contact use CSS pixels at every size", () => {
  assert.equal(desktopSize(2560, 1440), 82);
  const display = {screen:{x:0,y:0},work:{x:0,y:0,w:1920,h:1080}};
  for (const mode of ["desktop","overlay"]) {
    const view = {display,settings:{mode,patrol:"full",prop_scale:200,rabbit_scale:75}};
    assert.equal(field(view,1920,1080,1).size, 82 * .75);
  }
  for (const size of [50,100,200]) {
    const bed = {x:400-size/2,y:300-size,w:size,h:size};
    const dest = nestDestination(bed, 1000, 600);
    assert.equal(dest.x, .4);
    assert.equal(dest.y * 600, 300 - size * .28);
  }
});
