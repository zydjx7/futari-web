import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  createHash,
} from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zipSync } from "fflate";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const { values: v } = parseArgs({
  options: Object.fromEntries(
    ["init-key", "local", "remote", "dry-run", "version", "notes"].map((k) => [
      k,
      { type: ["version", "notes"].includes(k) ? "string" : "boolean" },
    ]),
  ),
});
const keyFile = ".update-signing-key.pem",
  pubFile = "desktop-app/desktop/src-tauri/update-public-key.bin";
if (v["init-key"]) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(keyFile, privateKey.export({ format: "pem", type: "pkcs8" }), {
    flag: "wx",
    mode: 0o600,
  });
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  writeFileSync(pubFile, pub);
  console.log("Ed25519 public key:", pub.toString("base64"));
  process.exit(0);
}
if ([v.local, v.remote, v["dry-run"]].filter(Boolean).length !== 1)
  throw Error("请选择 --dry-run、--local 或 --remote");
const version = v.version || (v["dry-run"] ? "local-preview" : "");
if (!/^[0-9A-Za-z_-][0-9A-Za-z._-]{0,39}$/.test(version))
  throw Error("需要有效的 --version");
const key = createPrivateKey(readFileSync(keyFile));
if (
  !createPublicKey(key)
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .equals(readFileSync(pubFile))
)
  throw Error("签名密钥与客户端公钥不匹配");
execFileSync(process.execPath, ["desktop-app/desktop/scripts/prepare.mjs"], {
  stdio: "inherit",
});
const files = {};
function collect(dir, prefix = "") {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + f.name,
      name = prefix + f.name;
    if (f.isDirectory()) collect(path, name + "/");
    else if (f.isFile() && !name.endsWith(".html") && name !== "boot.js")
      files[name] = readFileSync(path);
  }
}
collect("desktop-app/desktop/build/ui");
files["catalog.json"] = readFileSync("desktop-app/desktop/src-tauri/catalog.json");
const bytes = zipSync(files),
  signature = sign(null, bytes, key);
if (
  bytes.length > 16 * 1024 * 1024 ||
  !verify(null, bytes, createPublicKey(key), signature)
)
  throw Error("资源包校验失败");
const ui = {
  version,
  minAppVersion: JSON.parse(readFileSync("desktop-app/desktop/src-tauri/tauri.conf.json"))
    .version,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length,
  signature: signature.toString("base64"),
  notes: v.notes || "兔窝内容更新",
};
mkdirSync("desktop/dist", { recursive: true });
const zip = "ui-" + version + ".zip";
writeFileSync("desktop/dist/" + zip, bytes);
writeFileSync(
  "desktop/dist/manifest.json",
  JSON.stringify({ ui, app: null }, null, 2),
);
if (!v["dry-run"])
  for (const f of [zip, "manifest.json"])
    execFileSync(
      process.execPath,
      [
        "node_modules/wrangler/bin/wrangler.js",
        "r2",
        "object",
        "put",
        "notes-files/desktop/updates/" + f,
        "--file",
        "desktop/dist/" + f,
        "--content-type",
        f === zip ? "application/zip" : "application/json",
        ...(v.remote ? ["--env", "production", "--remote"] : ["--local"]),
      ],
      { stdio: "inherit" },
    );
console.log(zip, ui.sha256);
