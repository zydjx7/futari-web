import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [target, ...extra] = process.argv.slice(2);
if (extra.length || !["--local", "--remote"].includes(target)) {
  console.error("用法：node scripts/remove-breakfast.mjs --local 或 --remote");
  process.exit(2);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const args = ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", target];
if (target === "--remote") args.push("--env", "production");
const result = spawnSync(process.execPath, [...args, "--command",
  "DELETE FROM menu_dishes WHERE meal='早餐'; SELECT changes() AS deleted_breakfast_rows;"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
