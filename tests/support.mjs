import { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createTestHarness, unstable_splitSqlQuery as splitSQL } from "wrangler";

export const secrets = Object.fromEntries(["PASSCODE_HER", "PASSCODE_ADMIN", "SESSION_SECRET"].map(
  name => [name, randomBytes(name==="SESSION_SECRET"?32:6).toString("base64url")]
));
const app = createTestHarness({ workers: [{ configPath: "./wrangler.jsonc", secrets }] });
export const origin = "https://notes.test";
export let db, files;

export async function setup({ beforeMigration } = {}) {
  const { url } = await app.listen();
  const env = await app.getWorker().getEnv();
  db = env.DB;
  files = env.FILES;
  for (const file of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
    if (beforeMigration) await beforeMigration(file, db);
    const sql = await readFile("migrations/" + file, "utf8");
    await db.batch(splitSQL(sql).map(statement => db.prepare(statement)));
  }
  return url;
}
after(() => app.close());

export function request(path, options = {}) {
  return app.fetch(origin + path, { redirect: "manual", ...options });
}

export function submit(passcode, ip = "192.0.2.1", next = "") {
  return request("/login" + next, {
    method: "POST", headers: { Origin: origin, "CF-Connecting-IP": ip },
    body: new URLSearchParams({ passcode })
  });
}

export async function signIn(passcode, ip, next) {
  const response = await submit(passcode, ip, next);
  assert.equal(response.status, 303);
  const cookie = response.headers.get("Set-Cookie");
  for (const part of ["__Host-notes=", "Max-Age=15552000", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) {
    assert.ok(cookie.includes(part), "missing cookie attribute " + part);
  }
  return { Cookie: cookie.split(";")[0] };
}
