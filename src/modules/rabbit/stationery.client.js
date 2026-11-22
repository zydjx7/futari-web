export const icons = {
  hay: 0,
  carrot: 1,
  ball: 2,
  bed: 3,
  acorn: 4,
  letter: 5,
  snow: 6,
  basket: 7,
  store: 8
};
export const stories = {
  hay: "草尖还藏着午后的太阳味。最嫩的那一根，它总要留到最后。",
  carrot: "脆生生的一小口，两边的腮帮就轮流鼓起来了。",
  ball: "柳条绕了一圈又一圈。轻轻推给它，圆球便从爪尖滚走。",
  bed: "亚麻边边刚好托住下巴。它有时把脸埋进去，只肯留个圆屁股给你。"
};
export function icon(name) {
  const i = document.createElement("i");
  i.className = "book-icon";
  i.setAttribute("aria-hidden", "true");
  if (name === "camera" || name === "album") {
    i.classList.add("photo-icon");
    i.style.backgroundPosition = name === "album" ? "100% 0" : "0 0";
    return i;
  }
  const cell = icons[name];
  i.style.backgroundPosition = (cell % 3) * 50 + "% " + Math.floor(cell / 3) * 50 + "%";
  return i;
}
export function paintIcon(c, sheet, name, x, y, size) {
  const n = icons[name],
    cell = sheet.naturalWidth / 3;
  c.drawImage(
    sheet,
    (n % 3) * cell,
    Math.floor(n / 3) * cell,
    cell,
    cell,
    x - size / 2,
    y - size / 2,
    size,
    size
  );
}

// Convex outline of the opaque wicker illustration in its 144-pixel stationery cell.
// The body rotates around the woven sphere, including its small protruding willow tip.
const wickerHull = [
  [128, 26],
  [139, 50],
  [139, 51],
  [120, 104],
  [112, 117],
  [102, 129],
  [79, 140],
  [74, 141],
  [59, 141],
  [49, 139],
  [29, 130],
  [20, 123],
  [14, 114],
  [4, 94],
  [4, 72],
  [10, 54],
  [14, 47],
  [37, 24],
  [46, 19],
  [49, 18],
  [106, 2],
  [109, 2]
];
export const willowRestAngle = -0.64;
export function willowShape(x, floor, size, angle) {
  const scale = size / 144,
    cs = Math.cos(angle) * scale,
    sn = Math.sin(angle) * scale;
  const vertices = wickerHull.map(([u, v]) => [cs * (u - 64) - sn * (v - 79), sn * (u - 64) + cs * (v - 79)]);
  const y = floor - Math.max(...vertices.map((v) => v[1]));
  const edge = (dir) => {
    // Average the ends of a flat side to touch the ink rather than the corner of its box.
    const near = Math.min(...vertices.map((v) => dir * v[0]));
    const points = vertices.filter((v) => dir * v[0] <= near + size * 0.008);
    return { x: x + dir * near, y: y + points.reduce((sum, v) => sum + v[1], 0) / points.length };
  };
  return { x, y, size, angle, edge };
}
export function paintWillow(c, sheet, ball) {
  c.save();
  c.translate(ball.x, ball.y);
  c.rotate(ball.angle);
  paintIcon(c, sheet, "ball", ball.size * (0.5 - 64 / 144), ball.size * (0.5 - 79 / 144), ball.size);
  c.restore();
}
