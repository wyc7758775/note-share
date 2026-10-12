// 编辑器 Markdown 的进出预处理：
// Obsidian 的嵌入语法是 ![[路径]]，标准 Markdown 是 ![alt](路径)。
// 进入 tiptap 前把 ![[x]] 转成 ![x](x)，保存时再把 .excalidraw 图片转回 ![[x]]，
// 这样 Obsidian 里能直接渲染画板嵌入。

const EMBED_RE = /!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const WIKILINK_RE = /\[\[([^\][\n]+?)\]\]/g;
const HOME_EMBED_RE = /!\[\[Home#\^([A-Za-z0-9][A-Za-z0-9-]*)\]\]/g;
export const WIKILINK_PREFIX = "noteshare-wikilink:";
/** Home 节点嵌入在编辑器内的伪装 src 前缀（HomeEmbed 节点认它） */
export const HOME_EMBED_PREFIX = "noteshare-homeembed:";

/** markdown-it 会把中文等非 ASCII 路径百分号编码，读文件前先还原 */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function forEditor(markdown: string): string {
  return markdown
    .replace(/\\\[\\\[/g, "[[")
    .replace(/\\\]\\\]/g, "]]")
    // Home 节点嵌入：![[Home#^id]] → 伪装 img（HomeEmbed 节点解析），先于通用 EMBED_RE
    .replace(HOME_EMBED_RE, (_m, id: string) => `![](${HOME_EMBED_PREFIX}${id})`)
    .replace(EMBED_RE, (_m, p: string) => {
      const src = safeDecode(p);
      return `![${src}](${src})`;
    })
    // [[笔记名]] 双链伪装成 markdown 链接（Wikilink 节点认这个 href 前缀），
    // 在 EMBED_RE 之后执行，![[x]] 已先转成图片，不会被误吃
    .replace(WIKILINK_RE, (_m, name: string) => `[${name}](${WIKILINK_PREFIX}${encodeURIComponent(name)})`)
    // 任务行改用 * 标记：CommonMark 规定"标记字符变化即开始新列表"，
    // 这样普通 "- 列表" 与 "- [ ] 任务列表" 相邻时不会被 markdown-it
    // 合并成混合列表（混合列表会让 tiptap 解析出错乱结构）。
    // 保存时 tiptap 统一输出 "-"，磁盘格式不受影响。
    .replace(/^(\s*)- (\[[ xX]\] )/gm, "$1* $2");
}

export function forSave(markdown: string): string {
  return (
    markdown
      .replace(IMG_RE, (m, alt: string, srcRaw: string) => {
        // Home 节点嵌入：伪装 src → 还原为 ![[Home#^id]]
        if (srcRaw.startsWith(HOME_EMBED_PREFIX)) {
          return `![[Home#^${safeDecode(srcRaw.slice(HOME_EMBED_PREFIX.length))}]]`;
        }
        const src = safeDecode(srcRaw);
        if (src.endsWith(".excalidraw")) {
          return `![[${src}]]`;
        }
        // 我们自己生成的嵌入 alt == src，转回 Obsidian 嵌入写法保持原样
        if (alt && safeDecode(alt) === src) {
          return `![[${src}]]`;
        }
        return m;
      })
      // "[[ 笔记链接是纯文本，序列化器会把 [[ / ]] 转义，还原成 Obsidian 双链写法
      .replace(/\\\[\\\[/g, "[[")
      .replace(/\\\]\\\]/g, "]]")
  );
}

export function isExcalidrawSrc(src: string): boolean {
  return src.endsWith(".excalidraw");
}

/** .excalidraw 场景文件对应的自动导出 PNG 路径 */
export function pngSibling(sceneSrc: string): string {
  return sceneSrc.replace(/\.excalidraw$/, ".png");
}

/** 从一段 Markdown 里提取所有 vault 相对资源路径（用于发布时内联） */
export function extractAssetPaths(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(IMG_RE)) {
    const src = m[2];
    if (!/^(https?:|data:|#)/.test(src)) out.add(src);
  }
  for (const m of markdown.matchAll(EMBED_RE)) {
    if (!m[1].startsWith("Home#^")) out.add(m[1]); // Home 节点嵌入不是附件
  }
  return [...out];
}
