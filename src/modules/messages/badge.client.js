const link=document.querySelector("[data-message-link]");
const badge=link.querySelector("[data-unread]");
let controller;
const channel=typeof BroadcastChannel === "function" ? new BroadcastChannel("futari-messages") : null;
function display(n) {
  badge.textContent=n>99?"99+":String(n);
  badge.hidden=n===0;
  link.setAttribute("aria-label",n?"消息，"+n+" 条未读":"消息");
}
async function refresh() {
  if(document.hidden) return;
  controller?.abort(); controller=new AbortController();
  try {
    const r=await fetch("/api/messages/count",{signal:controller.signal});
    if(r.ok) display((await r.json()).unread);
  } catch { /* The server-rendered count remains available offline. */ }
}
document.addEventListener("futari:messages", e=>{
  controller?.abort();
  if(Number.isInteger(e.detail?.unread)) display(e.detail.unread); else refresh();
  channel?.postMessage("refresh");
});
channel?.addEventListener("message",refresh);
addEventListener("focus",refresh);
addEventListener("pageshow",e=>{if(e.persisted) refresh();});
document.addEventListener("visibilitychange",refresh);
setInterval(refresh,15000);
if(link.hasAttribute("data-refresh-count")) refresh();
