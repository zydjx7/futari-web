// Coordinates are shared with the room canvas (1600 × 980).
function shape(c, outline, fill, stroke, width = 4) {
  const path = new Path2D(outline);
  if (fill) {
    c.fillStyle = fill;
    c.fill(path);
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke(path);
  }
}
function oval(c, x, y, rx, ry, fill, stroke, width = 4) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
  if (fill) {
    c.fillStyle = fill;
    c.fill();
  }
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke();
  }
}
function wash(c, x, y, x2, y2, light, dark) {
  const color = c.createLinearGradient(x, y, x2, y2);
  color.addColorStop(0, light);
  color.addColorStop(1, dark);
  return color;
}

export function bowl(c) {
  c.save();
  c.translate(245, 747);
  oval(c, 2, 66, 128, 18, "#95683924");
  shape(
    c,
    "M-119 -21 Q-118 22 -94 53 Q-73 79 1 79 Q81 79 98 51 Q115 18 120 -20 Z",
    wash(c, -40, -22, 30, 85, "#c1d5e0", "#7e9ab9"),
    "#687e91",
    5
  );
  oval(c, 0, -21, 120, 38, "#d9e7e8", "#6a8093", 5);
  oval(c, 0, -21, 105, 27, wash(c, 0, -48, 0, 12, "#738da6", "#b8cfdd"), "#92a9b9", 3);
  shape(c, "M-86 15 Q-82 37 -69 45", null, "#dfebed", 5);
  shape(
    c,
    "M-13 31 Q-26 6 -18 5 Q-12 5 -5 22 Q1 19 7 22 Q14 2 19 6 Q24 10 16 31 Q26 49 3 51 Q-20 50 -13 31Z",
    "#edece6",
    "#758998",
    2.5
  );
  oval(c, -5, 36, 1.6, 2, "#687889");
  oval(c, 9, 36, 1.6, 2, "#687889");
  shape(c, "M0 40 Q3 43 6 40", null, "#7c8790", 1.8);
  c.restore();
}

// Project a hop through the painted mouth. Let the paws clear its lower lip
// before putting the actor behind the rim; the exit traverses the same plane.
export function tunnelPlacement(log, x, ground, size, z, p) {
  const depth = p.inside;
  if (!log || !depth) return { x, ground, size, z };
  const peek = p.tunnelPeek;
  return {
    x: x + (log.x + log.w * (0.40 - 0.045 * peek) - x) * depth,
    ground: ground + (log.y + log.h * (0.78 + 0.095 * peek) - ground) * depth,
    size: size * (1 - depth * (0.38 - 0.06 * peek)),
    z: depth >= 0.5 ? log.z - 0.001 : z
  };
}

export function tunnelBack(c) {
  oval(c, 1329, 799, 211, 24, "#88643728");
  oval(c, 1266, 651, 145, 156, wash(c, 1200, 540, 1300, 815, "#635043", "#a17b5c"), "#806348", 7);
}
export function tunnelFront(c) {
  c.save();
  c.lineJoin = "round";
  c.lineCap = "round";
  shape(
    c,
    "M1249 473 Q1370 427 1445 452 Q1540 476 1553 604 Q1567 728 1492 763 L1316 811 Q1388 684 1312 558Z",
    wash(c, 1300, 473, 1510, 777, "#d1a77d", "#9d7557"),
    "#87684e",
    5
  );
  for (const s of [
    "M1333 487 Q1411 462 1455 470",
    "M1392 521 Q1450 498 1482 502",
    "M1427 561 Q1481 539 1505 548",
    "M1450 630 Q1505 599 1531 607",
    "M1455 687 Q1497 655 1538 655",
    "M1428 749 Q1468 717 1524 710"
  ])
    shape(c, s, null, "#977455", 4);
  const ring = new Path2D();
  ring.ellipse(1268, 646, 165, 174, -0.07, 0, Math.PI * 2);
  ring.ellipse(1268, 651, 119, 132, -0.07, 0, Math.PI * 2);
  c.save();
  c.globalCompositeOperation = "destination-out";
  c.beginPath();
  c.ellipse(1268, 651, 119, 132, -0.07, 0, Math.PI * 2);
  c.fill();
  c.restore();
  c.fillStyle = wash(c, 1166, 482, 1354, 810, "#e4c49d", "#c59b75");
  c.fill(ring, "evenodd");
  c.strokeStyle = "#89694f";
  c.lineWidth = 6;
  c.stroke(ring);
  for (const [rx, ry, from, to] of [
    [149, 158, 3.5, 6.3],
    [148, 158, 0.2, 2.85],
    [134, 145, 2.4, 5.5]
  ]) {
    c.beginPath();
    c.ellipse(1268, 648, rx, ry, -0.07, from, to);
    c.strokeStyle = "#b18c69";
    c.lineWidth = 3;
    c.stroke();
  }
  shape(c, "M1150 524 l18 22 m160 224 14 19 M1255 474 l4 23", null, "#997554", 4);
  c.restore();
}
export function nightLight(c) {
  shape(c, "M1035 446 v73 m-22 2 h44", null, "#a28262", 7);
  shape(c, "M1005 394 Q1035 377 1062 394 L1080 449 Q1034 462 986 449Z", "#f2d69d", "#b99560", 4);
}
