// 主题门禁：保证亮 / 暗两套 CSS 变量对齐、引用不悬空。零依赖，可本地与 CI 共用。
// 检查项（任一失败退出码 1）：
//   1. html[data-theme="dark"] 块必须存在
//   2. 暗色块里的每个变量必须在亮色（:root 并集）中存在
//   3. 主题色板（第一个 :root 块）的每个变量必须有暗色覆盖
//      —— 否则切暗色时残留亮色值（第二个及以后的 :root 块多为布局常量，豁免）
//   4. styles.css 与 src 代码里 var(--x) 引用的变量必须有定义（防拼写错误）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS_FILE = path.join(ROOT, "src", "styles.css");
const SRC_DIR = path.join(ROOT, "src");
const DARK_SEL = 'html[data-theme="dark"]';

// ---- 解析 CSS 顶层块：选择器 -> 变量集（单遍状态机：跳过注释与字符串，配对大括号） ----
function parseBlocks(css) {
  const blocks = [];
  let i = 0;
  let buf = ""; // 自上一块结束以来的选择器缓冲
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      buf += c;
      i++;
      while (i < css.length && css[i] !== q) {
        if (css[i] === "\\" && i + 1 < css.length) {
          buf += css[i] + css[i + 1];
          i += 2;
          continue;
        }
        buf += css[i];
        i++;
      }
      buf += q;
      i++;
      continue;
    }
    if (c === "{") {
      let depth = 1;
      let j = i + 1;
      let quote = null;
      while (j < css.length && depth > 0) {
        const d = css[j];
        if (quote) {
          if (d === "\\") j++;
          else if (d === quote) quote = null;
        } else if (d === '"' || d === "'") quote = d;
        else if (d === "{") depth++;
        else if (d === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      // 变量分两档：实值定义（算主题色，要求暗色覆盖）与 var() 引用别名
      // （如 --wf-bg: var(--paper)，暗色由被引用变量自带覆盖，无需重复定义，
      //   但仍算"已定义"，供 var() 引用悬空检查使用）
      const defs = [...body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)];
      const vars = new Set(
        defs.filter((m) => !/^\s*var\(/.test(m[2])).map((m) => m[1])
      );
      const aliases = new Set(
        defs.filter((m) => /^\s*var\(/.test(m[2])).map((m) => m[1])
      );
      blocks.push({ selector: buf.replace(/\s+/g, " ").trim(), vars, aliases });
      buf = "";
      i = j;
      continue;
    }
    if (c === "}" || c === ";") {
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return blocks;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

const css = fs.readFileSync(CSS_FILE, "utf8");
const blocks = parseBlocks(css);
const rootBlocks = blocks.filter((b) => b.selector === ":root");
const darkBlocks = blocks.filter((b) => b.selector === DARK_SEL);
const lightAll = new Set(rootBlocks.flatMap((b) => [...b.vars]));
const palette = rootBlocks[0]?.vars ?? new Set();
const dark = new Set(darkBlocks.flatMap((b) => [...b.vars]));

const errors = [];
if (rootBlocks.length === 0) errors.push("styles.css 中没有 :root 块");
if (darkBlocks.length === 0) errors.push(`styles.css 中没有 ${DARK_SEL} 暗色块`);

for (const v of dark) {
  if (!lightAll.has(v)) errors.push(`暗色定义了亮色没有的变量 ${v}`);
}
// 暗色侧的 var() 引用别名也算"已有覆盖"（如 --code-block-border: var(--line)）
const darkAliases = new Set(darkBlocks.flatMap((b) => [...b.aliases]));
for (const v of palette) {
  if (!dark.has(v) && !darkAliases.has(v))
    errors.push(`主题色 ${v} 缺少暗色覆盖（切换暗色时会残留亮色值）`);
}

// var(--x) 引用检查：CSS 自身 + 前端代码（含 tailwind 任意值 bg-[var(--x)] 等）；
// 引用别名（值为 var() 的定义）也算已定义
const defined = new Set([
  ...rootBlocks.flatMap((b) => [...b.vars, ...b.aliases]),
  ...darkBlocks.flatMap((b) => [...b.vars, ...b.aliases]),
]);
const checkRefs = (text, where) => {
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!defined.has(m[1])) errors.push(`${where} 引用了未定义的变量 ${m[1]}`);
  }
};
checkRefs(css, "styles.css");
for (const file of walk(SRC_DIR)) {
  checkRefs(fs.readFileSync(file, "utf8"), path.relative(ROOT, file));
}

// ---- 5. 预设方案校验（src/domain/theme-tokens.ts）----
// 预设是代码里的静态事实，不经过偏好归一化，所以拼写错误不会被人拦住：
//   a. 每个 preset 的 token key 必须落在「对应 base 的内置表 ∪ 非主题常量白名单」
//      —— 否则注入一个不存在的 --xxx，切到该方案时静默无效
//   b. token 值不能为空
//   c. id 必须符合 Preferences.sanitizeThemeId 的字符集，且不重复（否则归一化会被静默剔掉）
//   d. 白名单里的每个 token 必须在 styles.css 有定义（防"白名单里写了拼错的变量名"）
const TOKENS_TS = path.join(ROOT, "src", "domain", "theme-tokens.ts");
const tokensSrc = fs.readFileSync(TOKENS_TS, "utf8");

const tableBody = (name) =>
  tokensSrc.match(new RegExp(`export const ${name}: ThemeTokens = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
const keysOf = (body) => new Set([...body.matchAll(/^\s*"(--[\w-]+)"/gm)].map((m) => m[1]));
const entriesOf = (body) => {
  const out = new Map();
  for (const m of body.matchAll(/^\s*"(--[\w-]+)"\s*:\s*((?:"(?:[^"\\]|\\.)*")|[^,\n]+)/gm))
    out.set(m[1], m[2].trim());
  return out;
};

const lightBody = tableBody("BUILTIN_LIGHT");
const darkBody = tableBody("BUILTIN_DARK");
if (!lightBody || !darkBody) errors.push("theme-tokens.ts 里找不到 BUILTIN_LIGHT / BUILTIN_DARK 表");
// 派生 token（--wf-text 等）整体展开进两张表，校验时也算合法 key
const wfBody = tableBody("WF_REF");
const lightKeys = new Set([...keysOf(lightBody), ...keysOf(wfBody)]);
const darkKeys = new Set([...keysOf(darkBody), ...keysOf(wfBody)]);

const extraBody = tokensSrc.match(/export const SCHEME_EXTRA_TOKENS = \[([\s\S]*?)\] as const;/)?.[1];
if (extraBody == null) errors.push("theme-tokens.ts 里找不到 SCHEME_EXTRA_TOKENS");
const extras = new Set([...(extraBody ?? "").matchAll(/"(--[\w-]+)"/g)].map((m) => m[1]));
for (const v of extras) {
  if (!defined.has(v)) errors.push(`SCHEME_EXTRA_TOKENS 里的 ${v} 在 styles.css 里没有定义`);
}

const presetsBody = tokensSrc.match(
  /export const PRESETS: readonly ThemePreset\[\] = \[([\s\S]*?)\n\];/
)?.[1];
if (presetsBody == null) errors.push("theme-tokens.ts 里找不到 PRESETS 表");
const presetIds = new Set();
let presetCount = 0;
for (const m of (presetsBody ?? "").matchAll(
  /\{\s*id:\s*"([^"]+)"[\s\S]*?base:\s*"(dark|light)",\s*tokens:\s*(\w+)/g
)) {
  const [, id, base, table] = m;
  presetCount++;
  if (presetIds.has(id)) errors.push(`预设 id 重复：${id}`);
  presetIds.add(id);
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id))
    errors.push(`预设 id ${id} 含非法字符（必须匹配 sanitizeThemeId 的字符集）`);
  const body = tableBody(table);
  if (!body) {
    errors.push(`预设 ${id} 引用的 token 表 ${table} 不存在`);
    continue;
  }
  const allowed = new Set([...(base === "dark" ? darkKeys : lightKeys), ...extras]);
  for (const [key, value] of entriesOf(body)) {
    if (!allowed.has(key))
      errors.push(`预设 ${id} 覆盖了 ${base} 基础主题里没有的 token ${key}`);
    if (!value || value === '""' || value === "''")
      errors.push(`预设 ${id} 的 ${key} 值为空`);
  }
}
if (presetsBody != null && presetCount === 0) errors.push("PRESETS 表里没有任何预设（解析失败或格式变了）");

if (errors.length) {
  console.error(`✗ 主题检查未通过（${errors.length} 处）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `✓ 主题检查通过：色板 ${palette.size} 个变量，暗色覆盖 ${dark.size} 个，预设 ${presetCount} 套（非主题常量 ${extras.size} 个），var() 引用无悬空`
);
