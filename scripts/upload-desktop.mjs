import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { archives } from "../src/modules/rabbit/downloads.js";

const { values } = parseArgs({ options: { local: { type: "boolean" }, remote: { type: "boolean" } } });
if (values.local && values.remote) throw new Error("请选择一个目标。");
const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = path.join(root, "wrangler.jsonc");
const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const target = values.remote ? ["--env", "production", "--remote"] : ["--local"];
const bucket = "notes-files";
async function remoteHead(key) {
  const config = unstable_readConfig({ config: configPath, env: "production" });
  const url = new URL(`/client/v4/accounts/${config.account_id}/r2/buckets/${bucket}/objects`, "https://api.cloudflare.com");
  url.searchParams.set("prefix", key);
  url.searchParams.set("per_page", "1");
  const auth = JSON.parse(execFileSync(process.execPath, [cli, "auth", "token", "--json"], { cwd: root, encoding: "utf8" }));
  const headers = auth.token ? { Authorization: "Bearer " + auth.token } : { "X-Auth-Key": auth.key, "X-Auth-Email": auth.email };
  const result = await fetch(url, { headers, redirect: "error" });
  if (!result.ok) throw new Error("R2 校验失败 " + result.status);
  const metadata = (await result.json()).result?.find(object => object.key === key);
  return metadata && { size: metadata.size, httpMetadata: metadata.http_metadata };
}
let local;
try {
  let found = 0;
  for (const key of Object.values(archives)) {
    const filename = path.join(root, "desktop/dist", path.basename(key));
    const info = await stat(filename).catch(e => { if (e.code !== "ENOENT") throw e; });
    if (!info) continue;
    execFileSync(process.execPath, [cli, "r2", "object", "put", bucket + "/" + key, "--file", filename,
      "--content-type", "application/zip", ...target], { cwd: root, stdio: "inherit" });
    if (!values.remote) local ??= await getPlatformProxy({ configPath });
    const object = values.remote ? await remoteHead(key) : await local.env.FILES.head(key);
    if (object?.httpMetadata?.contentType !== "application/zip" || object.size !== info.size)
      throw new Error("对象类型或长度不一致：" + key);
    console.log(key, info.size, "bytes · application/zip");
    found++;
  }
  if (!found) throw new Error("desktop/dist 下没有已构建的桌宠 ZIP。");
} finally { await local?.dispose(); }
