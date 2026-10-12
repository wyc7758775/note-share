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

if (errors.length) {
  console.error(`✗ 主题检查未通过（${errors.length} 处）：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ 主题检查通过：色板 ${palette.size} 个变量，暗色覆盖 ${dark.size} 个，var() 引用无悬空`);
