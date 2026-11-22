import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const path = new URL("../.dev.vars", import.meta.url);
const names = ["PASSCODE_HER", "PASSCODE_ADMIN", "SESSION_SECRET"];
const lines = names.map((name) => name + "=" + randomBytes(32).toString("base64url"));

try {
  await writeFile(path, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("已生成本机 .dev.vars，可在该文件查看两人的本地暗号。");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
