// 白板卡片的 Markdown 只读渲染（markdown-it，html 关闭防注入）。
// 与编辑器的 tiptap 链路无关——卡片要的是轻量、快、可嵌在任意尺寸的小窗里。
// 扩展三类 Obsidian 语法：
//   [[名字]]        → <a data-cv-name> 双链（点击跳转/创建）
//   ![[路径]]       → 图片嵌入（占位 data-cv-src，挂载后由卡片异步换成 dataURL）
//   - [ ] / - [x]  → 任务勾选框（只读）
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
const esc = md.utils.escapeHtml;

// ---- [[双链]]（inline 规则，先于 link；前面带 ! 的是嵌入，交给 cvEmbed） ----
function cvWikilink(state: any, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false;
  if (pos > 0 && src.charCodeAt(pos - 1) === 0x21 /* ! */) return false;
  const end = src.indexOf("]]", pos + 2);
  if (end < 0) return false;
  const inner = src.slice(pos + 2, end);
  if (!inner || inner.includes("[")) return false;
  const [nameRaw, alias] = inner.split("|");
  const name = nameRaw.trim().replace(/\.md$/i, "");
  if (!name) return false;
  if (!silent) {
    const token = state.push("cv_wikilink", "", 0);
    token.content = (alias ?? "").trim() || name;
    token.meta = { name };
  }
  state.pos = end + 2;
  return true;
}
md.inline.ruler.before("link", "cv_wikilink", cvWikilink);
md.renderer.rules.cv_wikilink = (tokens: any[], i: number) => {
  const t = tokens[i];
  return `<a class="cv-wikilink" data-cv-name="${esc(String(t.meta?.name ?? ""))}">${esc(t.content)}</a>`;
};

// ---- ![[嵌入]]：图片扩展名 → 图片占位；其他（笔记等）→ 降级为双链 ----
function cvEmbed(state: any, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (
    src.charCodeAt(pos) !== 0x21 /* ! */ ||
    src.charCodeAt(pos + 1) !== 0x5b ||
    src.charCodeAt(pos + 2) !== 0x5b
  )
    return false;
  const end = src.indexOf("]]", pos + 3);
  if (end < 0) return false;
  const [p0, size] = src.slice(pos + 3, end).split("|");
  const p = p0.trim();
  if (!p) return false;
  if (!silent) {
    if (IMG_EXT_RE.test(p) || /\.excalidraw$/i.test(p)) {
      const img = state.push("image", "", 0);
      img.attrSet("src", p);
      img.content = p;
      if (size && /^\d+$/.test(size.trim())) img.attrSet("width", size.trim());
    } else {
      const a = state.push("cv_wikilink", "", 0);
      a.content = p.replace(/\.md$/i, "");
      a.meta = { name: a.content };
    }
  }
  state.pos = end + 2;
  return true;
}
md.inline.ruler.before("image", "cv_embed", cvEmbed);

// ---- 标准图片：非 http/data 的 src 一律视为 vault 相对路径 → 占位符 ----
md.renderer.rules.image = (tokens: any[], i: number) => {
  const t = tokens[i];
  const src = t.attrGet("src") ?? "";
  const w = t.attrGet("width");
  const isRemote = /^(https?:|data:)/i.test(src);
  const srcPart = isRemote ? `src="${esc(src)}"` : `data-cv-src="${esc(src)}"`;
  return `<img class="cv-img" ${srcPart} alt="${esc(t.content ?? "")}"${w ? ` width="${esc(w)}"` : ""}>`;
};

// ---- 任务列表：列表项文字以 [ ] / [x] 开头 → 勾选框（只读） ----
md.core.ruler.after("inline", "cv_task", (state: any) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== "inline") continue;
    if (tokens[i - 1].type !== "paragraph_open") continue;
    if (tokens[i - 2].type !== "list_item_open") continue;
    const children = tokens[i].children ?? [];
    const first = children[0];
    if (!first || first.type !== "text") continue;
    const m = first.content.match(/^ *[(（]([ xX]|ｘ)[)）] +/);
    if (!m) continue;
    first.content = first.content.slice(m[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<input type="checkbox" class="cv-task" disabled ${
      m[1].trim() && m[1] !== " " ? "checked" : ""
    }>`;
    children.unshift(box);
    tokens[i - 2].attrJoin("class", "cv-task-item");
  }
  return true;
});

/** 渲染卡片正文（已剥离 frontmatter 的 markdown）→ HTML 字符串 */
export function renderCardMarkdown(body: string): string {
  return md.render(body);
}

/** 把容器里所有 vault 图片占位符换成 dataURL（模块级缓存，跨卡片共享） */
const assetCache = new Map<string, string>();

async function readAssetUrl(path: string): Promise<string | null> {
  const hit = assetCache.get(path);
  if (hit !== undefined) return hit;
  try {
    const { backend } = await import("../backend");
    const { base64, mime } = await backend.readAssetBase64(path);
    const url = `data:${mime};base64,${base64}`;
    assetCache.set(path, url);
    return url;
  } catch {
    assetCache.set(path, ""); // 读不到：置空标记，避免反复尝试
    return null;
  }
}

/** 容器内 <img data-cv-src="vault 路径"> 异步换真图（含 .excalidraw 的 PNG 预览） */
export async function hydrateCardImages(el: HTMLElement): Promise<void> {
  const imgs = [...el.querySelectorAll<HTMLImageElement>("img[data-cv-src]")];
  await Promise.all(
    imgs.map(async (im) => {
      const raw = im.getAttribute("data-cv-src") ?? "";
      let p = raw;
      if (/\.excalidraw$/i.test(raw)) p = raw.replace(/\.excalidraw$/i, ".png");
      const url = await readAssetUrl(p);
      if (url) im.src = url;
      else im.classList.add("cv-img-missing");
    })
  );
}
