// Each document measures its own connection. The server merges overlapping intervals.
let stream = crypto.randomUUID();
let stopped = false;

async function pulse() {
  if (stopped || !stream || !navigator.onLine) return;
  try {
    const response = await fetch("/api/companion/pulse", {
      method: "POST", body: new URLSearchParams({ stream }), keepalive: true
    });
    if (response.status === 401 || response.status === 403) {
      stopped = true;
      clearInterval(timer);
    }
  } catch {
    // A later heartbeat starts a new interval if the connection was interrupted.
  }
}

const timer = setInterval(pulse, 30000);
pulse();
function pause() {
  pulse();
  stream = null;
}
function resume() {
  stream ??= crypto.randomUUID();
  pulse();
}
addEventListener("offline", () => { stream = null; });
addEventListener("online", resume);
addEventListener("pagehide", pause);
addEventListener("pageshow", event => { if (event.persisted) resume(); });
document.addEventListener("freeze", pause);
document.addEventListener("resume", resume);
document.addEventListener("visibilitychange", pulse);
