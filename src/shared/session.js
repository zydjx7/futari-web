const encoder = new TextEncoder();
const cookieName = "__Host-notes";
export const sessionLifetime = 180 * 24 * 60 * 60;
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function configured(env) {
  const { PASSCODE_HER: her, PASSCODE_ADMIN: admin, SESSION_SECRET: secret } = env;
  const validPasscode = value => {
    const length = typeof value === "string" ? [...value].length : 0;
    return length >= 8 && length <= 256;
  };
  return validPasscode(her) && validPasscode(admin) && typeof secret==="string" && [...secret].length >= 32
    && new Set([her, admin, secret]).size === 3;
}

export function signingKey(env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function sign(key, message) {
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function matchRole(key, value, env) {
  const signature = await sign(key, "passcode:" + value);
  const matches = await Promise.all([env.PASSCODE_HER, env.PASSCODE_ADMIN].map(passcode =>
    crypto.subtle.verify("HMAC", key, signature, encoder.encode("passcode:" + passcode))));
  if (matches[0]) return "her";
  if (matches[1]) return "admin";
  return null;
}

export async function clientKey(key, request) {
  // The edge supplies this header. Without it, local requests share one bucket.
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return hex(await sign(key, "login-ip:" + ip));
}

function cookie(value, maxAge) {
  return cookieName + "=" + value + "; Path=/; Max-Age=" + maxAge
    + "; HttpOnly; Secure; SameSite=Lax";
}

export const clearCookie = () => cookie("", 0);

export async function issueCookie(key, id, expires, scope = "web") {
  const payload = id + "." + expires;
  const desktop = scope === "desktop";
  const signature = hex(await sign(key, (desktop ? "desktop-session:" : "web-session:") + payload));
  return cookie((desktop ? "d1." : "") + payload + "." + signature, sessionLifetime);
}

export function cookieToken(request) {
  const cookies = (request.headers.get("Cookie") || "").split(/;\s*/);
  const entry = cookies.find(item => item.startsWith(cookieName + "="));
  return entry?.slice(cookieName.length + 1) || "";
}

export function usesDesktopCredential(request) {
  return cookieToken(request).startsWith("d1.") || /^Bearer\s/i.test(request.headers.get("Authorization") || "");
}

export async function readSession(request, env, expectedScope = "web") {
  let token = cookieToken(request);
  const desktop = expectedScope === "desktop";
  if (token.startsWith("d1.") !== desktop) return null;
  if (desktop) token = token.slice(3);
  const match = /^([0-9a-f-]{36})\.(\d{10,11})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return null;
  const [, id, expires, signature] = match;
  const now = nowSeconds();
  if (Number(expires) <= now) return null;
  const bytes = Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", await signingKey(env), bytes,
    encoder.encode((desktop ? "desktop-session:" : "web-session:") + id + "." + expires));
  if (!valid) return null;
  return env.DB.prepare("SELECT id, role FROM sessions WHERE id = ? AND expires_at = ? AND expires_at > ? AND scope = ?")
    .bind(id, Number(expires), now, expectedScope).first();
}
