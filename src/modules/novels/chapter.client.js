const article = document.querySelector(".reader-text");
const lastLine = article.querySelector("p:last-of-type");
const dwell = Number(article.dataset.visibleSeconds) * 1000;
const endpoint = "/novels/" + article.dataset.book + "/read";
const covered = () => document.hidden || document.documentElement.hasAttribute("data-room-open") || document.documentElement.hasAttribute("data-notes-open");
let visibleSince = covered() ? null : performance.now();
let visibleMs = 0, started = false, finished = false, busy = false, timer;

function schedule(delay = 0) {
  clearTimeout(timer);
  if (!finished && !covered()) timer = setTimeout(check, delay);
}

async function check() {
  if (busy || finished || visibleSince === null || !lastLine) return;
  if (started) {
    const remaining = dwell - (visibleMs + performance.now() - visibleSince);
    if (remaining > 0) { schedule(Math.ceil(remaining)); return; }
    if (lastLine.getBoundingClientRect().bottom > innerHeight + 1) return;
  }
  busy = true;
  let delay = 0;
  try {
    const response = await fetch(endpoint, { method: "POST", keepalive: true,
      body: new URLSearchParams({ chapter: article.dataset.chapter, phase: started ? "finish" : "start" }) });
    if (response.ok) {
      if (started) finished = true;
      else started = true;
    } else if ([401, 403, 404].includes(response.status)) finished = true;
    else delay = response.status === 409 ? 1000 : 10000;
  } catch { delay = 10000; }
  busy = false;
  schedule(delay);
}

function visibility() {
  if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
  visibleSince = covered() ? null : performance.now();
  schedule();
}
document.addEventListener("visibilitychange", visibility);
document.addEventListener("notes:overlaychange", visibility);
addEventListener("scroll", () => schedule(), { passive: true });
addEventListener("resize", () => schedule());
addEventListener("online", () => schedule());
document.addEventListener("click", event => { if (event.target.closest("a[href]")) check(); }, { capture: true });
schedule();
