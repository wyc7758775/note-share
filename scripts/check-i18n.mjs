// i18n 门禁：保证中英文案同步、引用不悬空。零依赖，可本地与 CI 共用。
// 检查项（任一失败退出码 1，挡住流水线）：
//   1. zh / en 两侧 key 集合完全一致（漏译/多译都算错）
//   2. 代码里 t("key") / translate("key") 引用的 key 必须已定义
//   3. 同一 key 的 {占位符} 集合 zh / en 必须一致（缺占位符运行时会露出原样文本）
//   另输出「定义了但没人用」的 key 作警告（动态 key 场景易误报，不挡门禁）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const I18N_FILE = path.join(ROOT, "src", "i18n.tsx");
const SRC_DIR = path.join(ROOT, "src");

// ---- 从 i18n.tsx 源码提取 const zh = {...} / const en = {...} 的键值 ----
// 扫描器跳过字符串内容，大括号配对不受文案里的 {占位符} 干扰
function extractObject(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`i18n.tsx 中找不到 ${marker}`);
  let i = src.indexOf("{", start);
  let depth = 0;
  let quote = null;
  const bodyStart = i + 1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
  }
  throw new Error(`${marker} 大括号不配对`);
}

function parseEntries(body) {
  const map = new Map(); // key -> { placeholders:Set, line }
  body.split("\n").forEach((line, idx) => {
    const m = line.match(/^\s{2}(?:export const )?([A-Za-z_$][\w$]*)\s*:\s*["'`](.*?)["'`]\s*,?\s*$/);
    if (!m) return;
    const value = m[2];
    const placeholders = new Set([...value.matchAll(/\{(\w+)\}/g)].map((x) => x[1]));
    map.set(m[1], { placeholders, line: idx + 1 });
  });
  return map;
}

// ---- 收集 src 下代码里引用的 key ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const src = fs.readFileSync(I18N_FILE, "utf8");
const zh = parseEntries(extractObject(src, "const zh"));
const en = parseEntries(extractObject(src, "const en"));

const errors = [];
const enKeys = new Set(en.keys());
const zhKeys = new Set(zh.keys());

for (const k of zhKeys) if (!enKeys.has(k)) errors.push(`en 缺少 key「${k}」（zh 第 ${zh.get(k).line} 行）`);
for (const k of enKeys) if (!zhKeys.has(k)) errors.push(`zh 缺少 key「${k}」（en 第 ${en.get(k).line} 行）`);

for (const [k, v] of zh) {
  const e = en.get(k);
  if (!e) continue;
  const a = [...v.placeholders].sort().join(",");
  const b = [...e.placeholders].sort().join(",");
  if (a !== b) errors.push(`key「${k}」占位符不一致：zh={${a}} en={${b}}`);
}

const used = new Set();
const refRe = /\b(?:t|translate)\(\s*(["'])((?:[^\\]|\\.)*?)\1/g;
for (const file of walk(SRC_DIR)) {
  if (path.resolve(file) === path.resolve(I18N_FILE)) continue; // 定义文件自身跳过
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(refRe)) {
    used.add(m[2]);
    if (!zhKeys.has(m[2])) {
      const rel = path.relative(ROOT, file);
      errors.push(`${rel} 引用了未定义的 key「${m[2]}」`);
    }
  }
}

const unused = [...zhKeys].filter((k) => !used.has(k));

if (errors.length) {
  console.error(`✗ i18n 检查未通过（${errors.length} 处）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ i18n 检查通过：zh/en 各 ${zh.size} 个 key 对齐，引用无悬空`);
if (unused.length) {
  console.log(`  （提示：${unused.length} 个 key 当前未被静态引用，可能供动态拼接：${unused.slice(0, 10).join(", ")}${unused.length > 10 ? " …" : ""}）`);
}
