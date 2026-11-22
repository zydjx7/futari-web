import { icon, stories } from "./stationery.js";
import { packs } from "./packs.js";
import catalog from "/app/album/catalog.js";

export const tabs = {
  bag: ["小篮子", "basket"],
  shop: ["小铺子", "store"],
  scenes: ["风景册", "snow"],
  mail: ["小信箱", "letter"],
  camera: ["相机", "camera"],
  album: ["相册", "album"]
};
export function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
export function button(action, label, item) {
  const b = el("button", label);
  b.type = "button";
  b.dataset.action = action;
  if (item != null) b.dataset.item = item;
  return b;
}
function total(balance) {
  const t = el("span", undefined, "acorn-total");
  t.append(icon("acorn"), el("span", balance + " 颗小橡果"));
  return t;
}

export function sheetContents({ tab, detail, opened, home, mail, more, busy, scene }) {
  const header = el("header", undefined, "sheet-head"),
    title = el("h3", tabs[tab][0]);
  title.id = "sheet-title";
  const isDetail = detail || opened;
  if (isDetail) {
    const back = button("back", "‹");
    back.setAttribute("aria-label", "返回" + tabs[tab][0]);
    header.append(back);
  }
  header.append(title);
  const close = button("close-sheet", "×");
  close.setAttribute("aria-label", "合上" + tabs[tab][0]);
  header.append(close);
  const nodes = document.createDocumentFragment();
  nodes.append(header);
  if (!home) nodes.append(el("p", "正在翻开手账…"));
  else if (detail) {
    const prod = home.shop[detail],
      owned = home.inventory[detail] || 0,
      placed = home.placed.includes(detail);
    const card = el("article", undefined, "item-postcard");
    card.append(icon(detail), el("h4", prod.name), el("p", stories[detail]));
    const cost = tab === "shop" ? prod.price + " 颗小橡果" : owned + " 份";
    card.append(el("small", cost, "book-tag"));
    const label =
      tab === "shop"
        ? !prod.nourishment && owned
          ? "已经带回家"
          : home.balance < prod.price
            ? "小橡果还不够"
            : "带回家"
        : prod.nourishment
          ? "喂给它"
          : placed
            ? "已经摆好"
            : "摆进窝里";
    const action = tab === "shop" ? "buy" : prod.nourishment ? "feed" : "place";
    const submit = button(action, label, detail);
    submit.className = "book-primary";
    submit.disabled =
      busy ||
      (tab === "shop"
        ? home.balance < prod.price || (!prod.nourishment && owned > 0)
        : !owned || (!prod.nourishment && placed) || (!scene && !!prod.nourishment));
    card.append(submit);
    nodes.append(card);
  } else if (tab === "bag" || tab === "shop") {
    if (tab === "shop") nodes.append(total(home.balance));
    const grid = el("div", undefined, "item-grid");
    for (const [id, p] of Object.entries(home.shop)) {
      const qty = home.inventory[id] || 0;
      if (tab === "bag" && !qty) continue;
      const tile = button("detail", undefined, id);
      tile.className = "item-tile";
      const pic = icon(id);
      if (tab === "bag" && p.nourishment) {
        pic.dataset.food = id;
        pic.title = "拖到兔子嘴边";
      }
      tile.append(
        pic,
        el("strong", p.name),
        el("small", tab === "shop" ? p.price + " 颗小橡果" : qty + " 份", "book-tag")
      );
      grid.append(tile);
    }
    if (!grid.children.length) {
      const empty = el("div", undefined, "book-empty");
      empty.append(icon("basket"), el("p", "小篮子还空着。"), button("to-shop", "去小铺子"));
      nodes.append(empty);
    } else nodes.append(grid);
  } else if (tab === "scenes") {
    const grid = el("div", undefined, "scenery-cards");
    for (const [id, { title: label }] of Object.entries(packs)) {
      const b = button("switch-scene", undefined, id);
      b.setAttribute("aria-pressed", String(id === home.scene));
      b.disabled = busy;
      if (id === "snow") b.append(icon("snow"));
      else {
        const swatch = el("i", undefined, "paper-swatch");
        swatch.setAttribute("aria-hidden", "true");
        b.append(swatch);
      }
      b.append(el("strong", label));
      grid.append(b);
    }
    const lights = el("fieldset", undefined, "light-options");
    lights.append(el("legend", "光影"));
    for (const [id, label] of Object.entries(catalog.lights)) {
      const option = button("light", label, id);
      option.setAttribute("aria-pressed", String(id === (home.atmosphere || "auto")));
      option.disabled = busy;
      lights.append(option);
    }
    nodes.append(grid, lights);
  } else if (opened) {
    const card = el("article", undefined, "letter-postcard");
    card.append(icon("letter"), el("h4", "给你"));
    card.append(el("p", opened.note || "今天也给你留了一点小惊喜。"));
    if (opened.delta > 0) card.append(el("small", "随信捎来 " + opened.delta + " 颗小橡果。"));
    card.append(el("span", "写给你的悄悄话", "letter-sign"));
    nodes.append(card);
  } else {
    nodes.append(total(home.balance));
    const list = el("div", undefined, "letter-list");
    for (const m of mail) {
      const b = button("letter", undefined, m.id);
      b.className = "mail-letter";
      b.dataset.opened = String(!!m.opened);
      b.append(
        icon("letter"),
        el("span", m.note || "给你的小惊喜"),
        el("small", m.opened ? "再读一遍" : "拆信")
      );
      list.append(b);
    }
    if (!mail.length) list.append(el("p", "下一封悄悄话会寄到这里。", "book-empty"));
    if (more) list.append(button("more", "再翻一页"));
    nodes.append(list);
  }
  return nodes;
}
