// 编辑器 Markdown 的进出预处理：
// Obsidian 的嵌入语法是 ![[路径]]，标准 Markdown 是 ![alt](路径)。
// 进入 tiptap 前把 ![[x]] 转成 ![x](x)，保存时再把 .excalidraw 图片转回 ![[x]]，
// 这样 Obsidian 里能直接渲染画板嵌入。

const EMBED_RE = /!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** markdown-it 会把中文等非 ASCII 路径百分号编码，读文件前先还原 */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function forEditor(markdown: string): string {
  return markdown.replace(EMBED_RE, (_m, p: string) => {
    const src = safeDecode(p);
    return `![${src}](${src})`;
  });
}

export function forSave(markdown: string): string {
  return markdown.replace(IMG_RE, (m, alt: string, srcRaw: string) => {
    const src = safeDecode(srcRaw);
    if (src.endsWith(".excalidraw")) {
      return `![[${src}]]`;
    }
    // 我们自己生成的嵌入 alt == src，转回 Obsidian 嵌入写法保持原样
    if (alt && safeDecode(alt) === src) {
      return `![[${src}]]`;
    }
    return m;
  });
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
    out.add(m[1]);
  }
  return [...out];
}
