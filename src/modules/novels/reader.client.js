import { initAnnotations } from "/app/annotations.js";

const article = document.querySelector("[data-book]");
if (article.hasAttribute("data-visible-seconds")) import("/app/chapter.js");
const lines = [...article.querySelectorAll("p")];
const notice = document.querySelector("[data-read-error]");
const url = "/novels/" + article.dataset.book + "/progress";
const toolbar = document.querySelector(".reader-toolbar");
const marker = () => {
  const mobile = matchMedia("(max-width: 640px)").matches;
  const top = mobile ? document.querySelector(".rail").getBoundingClientRect().bottom : 0;
  return Math.max(mobile ? top + 12 : Math.min(80, innerHeight * .12), top + toolbar.offsetHeight + 12);
};
let revision = Number(article.dataset.revision);
let last = null, dirty = false, pending = null, timer;
history.scrollRestoration = "manual";

function glyphTop(node, i) {
  const range = document.createRange();
  range.setStart(node, i);
  range.setEnd(node, i + 1);
  return range.getBoundingClientRect();
}

// A paragraph index and a UTF-16 character offset survive a change of line width.
function position() {
  const y = marker();
  let low = 0, high = Math.max(0, lines.length - 1);
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].getBoundingClientRect().bottom <= y) low = mid + 1;
    else high = mid;
  }
  const paragraph = low, node = lines[paragraph]?.firstChild;
  low = 0; high = Math.max(0, (node?.length || 1) - 1);
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (glyphTop(node, mid).bottom <= y) low = mid + 1;
    else high = mid;
  }
  return { chapter: article.dataset.chapter, paragraph, offset: low };
}

function lineAnchor() {
  const { paragraph, offset } = position();
  const node = lines[paragraph]?.firstChild;
  if (node?.length) return { node, paragraph, offset, gap: glyphTop(node, offset).top - marker() };
}

function alignAnchor({ node, offset, gap }) {
  scrollBy({ top: glyphTop(node, offset).top - marker() - gap, behavior: "instant" });
}

const reading = article.closest(".reading");
const prefs = reading.querySelector("[data-reader-prefs]");
const root = document.documentElement;
const sizes = ["xs", "small", "medium", "large", "xl"];
const labels = ["特小", "小号", "标准", "大号", "特大"];
const steps = [...prefs.querySelectorAll("[data-step]")];
const swatches = [...prefs.querySelectorAll("[data-tone]")];
function showPreferences() {
  const size = sizes.indexOf(root.dataset.size || "medium");
  prefs.querySelector("[data-size-label]").textContent = labels[size];
  for (const step of steps) step.disabled = !sizes[size + Number(step.dataset.step)];
  for (const button of swatches) {
    const selected = button.dataset.tone === (root.dataset.tone || "blush");
    button.setAttribute("aria-pressed", String(selected));
    if (selected) prefs.querySelector("[data-tone-label]").textContent = button.getAttribute("aria-label");
  }
}
function setPreference(key, value) {
  root.dataset[key] = value;
  showPreferences();
  try { localStorage.setItem("futari.reader." + key, value); } catch { /* Keep this page's choice. */ }
}
for (const step of steps) step.addEventListener("click", () => {
  const size = sizes[sizes.indexOf(root.dataset.size || "medium") + Number(step.dataset.step)];
  if (!size) return;
  const anchor = lines[0]?.getBoundingClientRect().top <= marker() && article.getBoundingClientRect().bottom > marker() && lineAnchor();
  setPreference("size", size);
  if (anchor) alignAnchor(anchor);
});
for (const button of swatches) button.addEventListener("click", () => setPreference("tone", button.dataset.tone));
showPreferences();
prefs.hidden = false;

const contents = reading.querySelector(".contents");
const tocForm=contents.querySelector("form"), tocItems=contents.querySelector(".toc-items"), paging=contents.querySelector(".toc-pages");
let tocRequest, tocPage=1, loaded=false;
async function loadPage(params) {
  tocRequest?.abort();
  const request=tocRequest=new AbortController();
  const query=new URLSearchParams(params);
  const q=tocForm.elements.q.value.trim();
  if(q) query.set("q",q);
  const endpoint="/novels/"+article.dataset.book+"/toc";
  tocItems.setAttribute("aria-busy","true");
  try {
    const res=await fetch(endpoint+"?"+query,{signal:request.signal});
    if(!res.ok) throw new Error();
    const data=await res.json();
    if(request.signal.aborted) return;
    const links=data.items.map(c=>{
      const a=document.createElement("a"); a.href="?chapter="+c.number; a.textContent=c.number+" · "+c.title;
      if(c.number===Number(article.dataset.chapter)) a.setAttribute("aria-current","page");
      return a;
    });
    tocItems.replaceChildren(...(links.length?links:["没有匹配的章节"]));
    tocPage=data.page; loaded=true; paging.hidden=false;
    paging.querySelector("output").textContent=data.page+" / "+data.pages;
    for(const b of paging.querySelectorAll("button")) b.disabled=b.dataset.pageStep==="-1"?data.page<=1:data.page>=data.pages;
    const selected=tocItems.querySelector("[aria-current]");
    tocItems.scrollTop=selected?selected.offsetTop-tocItems.offsetTop-(tocItems.clientHeight-selected.offsetHeight)/2:0;
  } catch {
    if(!request.signal.aborted) {
      loaded=false;const a=document.createElement("a");query.set("view","html");a.href=endpoint+"?"+query;a.textContent="打开分页目录";tocItems.replaceChildren(a);
    }
  } finally { if(!request.signal.aborted) tocItems.removeAttribute("aria-busy"); }
}
contents.addEventListener("toggle", () => {
  if (contents.open && !loaded) loadPage({around:article.dataset.chapter});
});
tocForm.addEventListener("submit", e=>{e.preventDefault();loadPage({page:1});});
for(const b of paging.querySelectorAll("button")) b.addEventListener("click",()=>loadPage({page:tocPage+Number(b.dataset.pageStep)}));
for (const panel of [contents, prefs]) {
  document.addEventListener("click", event => {
    if (panel.open && !panel.contains(event.target)) panel.open = false;
  });
  panel.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !panel.open) return;
    panel.open = false;
    panel.querySelector("summary").focus();
  });
}

// A rotated phone may wrap the paragraph differently while the room is open.
let coveredLine;
document.addEventListener("notes:overlaychange", () => {
  if (document.documentElement.hasAttribute("data-room-open")) {
    const anchor = lineAnchor();
    if (anchor) coveredLine = { ...anchor, width: article.clientWidth, marker: marker() };
    return;
  }
  if (coveredLine && (article.clientWidth !== coveredLine.width || marker() !== coveredLine.marker)) {
    alignAnchor(coveredLine);
  }
  coveredLine = null;
});

async function flush(leaving = false) {
  clearTimeout(timer);
  if (pending) {
    await pending;
    if (dirty) return flush(leaving);
    return;
  }
  if (!dirty) return;
  dirty = false;
  const point = coveredLine
    ? { chapter: article.dataset.chapter, paragraph: coveredLine.paragraph, offset: coveredLine.offset }
    : position();
  const key = JSON.stringify(point);
  if (key === last) return;
  pending = (async () => {
    try {
      const response = await fetch(url, { method: "POST", keepalive: true,
        body: new URLSearchParams({ ...point, revision }) });
      if (response.status === 409) {
        revision = (await response.json()).revision;
        // A closing or dormant tab cannot roll back a newer device's bookmark.
        if (!leaving && !document.hidden && document.hasFocus()) schedule();
        return;
      }
      if (!response.ok) throw new Error();
      revision = (await response.json()).revision;
      last = key; notice.hidden = true;
    } catch {
      dirty = true;
      notice.textContent = "阅读位置暂未保存";
      notice.hidden = false;
    }
  })();
  try { await pending; } finally { pending = null; }
}
function schedule() {
  if (document.documentElement.hasAttribute("data-room-open")) return;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 350);
}

function restore() {
  const i = Math.min(Number(article.dataset.paragraph), lines.length - 1);
  const node = lines[i]?.firstChild;
  const offset = Math.min(Number(article.dataset.offset), (node?.length || 1) - 1);
  if (node && (i > 0 || offset > 0)) {
    scrollBy(0, glyphTop(node, offset).top - marker());
  } else if (!/^#note-p-\d+$/.test(location.hash)) scrollTo(0, 0);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (article.dataset.recordOpen === "1" && !document.hidden) schedule();
    else last = JSON.stringify(position());
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("online", () => flush());
    addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
  }));
}
restore();
initAnnotations(article,lines);

// Finish the last scroll before the next chapter/page reads its bookmark.
document.addEventListener("click", async event => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey ||
      event.altKey || link.target || link.hash || (!dirty && !pending)) return;
  event.preventDefault();
  await flush(true);
  location.assign(link.href);
});
document.addEventListener("submit", async event => {
  if (event.defaultPrevented || (!dirty && !pending)) return;
  event.preventDefault();
  await flush(true);
  event.target.submit();
});
