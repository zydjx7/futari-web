import { clientKey, issueCookie, matchRole, nowSeconds, sessionLifetime, signingKey } from "./session.js";
import { lockScreen } from "../app/views.js";
import { redirect } from "./http.js";

const cooldown = 15 * 60;
const maxFormBytes = 4096;

async function passcodeFrom(request) {
  if (Number(request.headers.get("Content-Length")) > maxFormBytes) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  for await (const chunk of request.body ?? []) {
    length += chunk.byteLength;
    if (length > maxFormBytes) return null;
    text += decoder.decode(chunk, { stream: true });
  }
  return new URLSearchParams(text + decoder.decode()).get("passcode") ?? "";
}

function locked(next, until, now) {
  const seconds = Math.max(1, until - now);
  return lockScreen(next, "请在 " + Math.ceil(seconds / 60) + " 分钟后再试", 429,
    { "Retry-After": String(seconds) });
}

export async function login(request, env, next, scope = "web") {
  const key = await signingKey(env);
  const ipKey = await clientKey(key, request);
  const now = nowSeconds();
  const currentLock = await env.DB.prepare(
    "SELECT expires_at FROM login_attempts WHERE ip_key = ? AND failures = 5 AND expires_at > ?"
  ).bind(ipKey, now).first();
  if (currentLock) return locked(next, currentLock.expires_at, now);

  const type = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return new Response(null, { status: 415 });
  const passcode = await passcodeFrom(request);
  if (passcode === null) return new Response(null, { status: 413 });
  const role = await matchRole(key, passcode, env);
  if (!role) {
    // Increment in SQL so simultaneous misses cannot overwrite each other.
    const attempt = await env.DB.prepare(
      `INSERT INTO login_attempts (ip_key, failures, expires_at) VALUES (?1, 1, 0)
       ON CONFLICT(ip_key) DO UPDATE SET
         failures = CASE WHEN failures = 5 AND expires_at <= ?3 THEN 1 ELSE min(failures + 1, 5) END,
         expires_at = CASE WHEN failures = 5 AND expires_at > ?3 THEN expires_at
                           WHEN failures = 4 THEN ?2 ELSE 0 END
       RETURNING failures, expires_at`
    ).bind(ipKey, now + cooldown, now).first();
    if (attempt.failures === 5) return locked(next, attempt.expires_at, now);
    return lockScreen(next, "暗号不正确", 401);
  }

  if (scope === "desktop" && role !== "her") return new Response(null, { status: 403 });
  const id = crypto.randomUUID();
  const expires = now + sessionLifetime;
  // Recheck inside the write transaction in case a fifth miss just committed.
  const [, gate] = await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE (failures = 5 AND expires_at <= ?) OR (ip_key = ? AND failures < 5)")
      .bind(now, ipKey),
    env.DB.prepare("SELECT expires_at FROM login_attempts WHERE ip_key = ?").bind(ipKey),
    env.DB.prepare(`INSERT INTO sessions (id, role, expires_at, scope)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM login_attempts WHERE ip_key = ?)`)
      .bind(id, role, expires, scope, ipKey),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now)
  ]);
  if (gate.results.length) return locked(next, gate.results[0].expires_at, now);
  return redirect(next, 303, { "Set-Cookie": await issueCookie(key, id, expires, scope) });
}
