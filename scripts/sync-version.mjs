// CI 用：把 tag 版本（如 v0.2.0）同步进 package.json / src-tauri/tauri.conf.json / Cargo.toml，
// 使打标签即发布，无需手动改三处版本号。用法：node scripts/sync-version.mjs v0.2.0
import fs from "node:fs";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error("用法: node scripts/sync-version.mjs v0.2.0");
  process.exit(1);
}
const version = tag.replace(/^v/, "");

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const confPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = version;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

const cargoPath = new URL("../src-tauri/Cargo.toml", import.meta.url);
const cargo = fs.readFileSync(cargoPath, "utf8");
fs.writeFileSync(
  cargoPath,
  cargo.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`)
);

console.log(`版本已同步为 ${version}`);
