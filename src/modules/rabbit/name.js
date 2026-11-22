import { InputError, readForm } from "../../shared/content.js";

export const rabbitNameQuery = (db) => db.prepare("SELECT name FROM rabbit_home WHERE owner='her'");

export async function renameRabbit({ db, request }) {
  let raw;
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() === "application/json") {
    try {
      raw = (await request.json())?.name;
    } catch {
      throw new InputError("没有读到名字，再写一次吧。");
    }
  } else {
    raw = (await readForm(request, 16384)).get("name");
  }
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || Array.from(name).length > 12) throw new InputError("名字可以写 1 到 12 个字。");
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(name)) throw new InputError("把名字写在一行里吧。");
  const saved = await db.prepare("UPDATE rabbit_home SET name=? WHERE owner='her' RETURNING name")
    .bind(name).first();
  return Response.json(saved);
}
