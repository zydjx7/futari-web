import menu from "../modules/menu/index.js";
import novels from "../modules/novels/index.js";
import puzzles from "../modules/puzzles/index.js";
import news from "../modules/news/index.js";
import admin from "../modules/admin/index.js";

export const navigation = [menu, novels, puzzles, news];
export const pages = new Map([...navigation, admin].map(page => [page.path, page]));
export const home = menu.path;

export function loginPath(next) {
  return next === home ? "/login" : "/login?next=" + encodeURIComponent(next);
}

export function returnPage(value) {
  if (!value || value.length > 1200 || !/^\/[a-z]/.test(value) || /[\\\r\n]/.test(value)) return home;
  const url = new URL(value, "https://notes.invalid");
  const section = "/" + url.pathname.split("/")[1];
  return (pages.has(section) || url.pathname==="/messages") ? url.pathname + url.search : home;
}
