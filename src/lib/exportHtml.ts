// 生成"单文件 HTML"：内联 CSS、图片转 base64，双击即可打开，也可直接发给朋友。
import { backend } from "../backend";
import { pngSibling, isExcalidrawSrc, safeDecode } from "./markdown";

export async function composeArticleHtml(
  title: string,
  contentHtml: string,
  meta?: { tags?: string[]; date?: string }
): Promise<string> {
  const bits: string[] = [];
  if (meta?.date) bits.push(`<span>${escapeHtml(meta.date)}</span>`);
  if (meta?.tags?.length)
    bits.push(
      `<span class="tags">${meta.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</span>`
    );
  const metaHtml = bits.length ? `\n  <div class="doc-meta">${bits.join("")}</div>` : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${READER_CSS}
</style>
</head>
<body>
<article>
  <h1 class="doc-title">${escapeHtml(title)}</h1>${metaHtml}
  <div class="doc-body">${contentHtml}</div>
</article>
</body>
</html>`;
}

/** 把 HTML 字符串里的 vault 相对 src 替换为 dataURL */
export async function inlineAssets(html: string): Promise<string> {
  const seen = new Map<string, string>();
  const jobs: Promise<void>[] = [];
  html.replace(/src="([^"]+)"/g, (m, src: string) => {
    if (/^(https?:|data:|#)/.test(src)) return m;
    if (seen.has(src)) return m;
    const decoded = safeDecode(src);
    const target = isExcalidrawSrc(decoded) ? pngSibling(decoded) : decoded;
    jobs.push(
      backend
        .readAssetBase64(target)
        .then(({ base64, mime }) => {
          seen.set(src, `data:${mime};base64,${base64}`);
        })
        .catch(() => {
          /* 资源缺失就保留原样 */
        })
    );
    return m;
  });
  await Promise.all(jobs);
  return html.replace(/src="([^"]+)"/g, (m, src: string) => {
    const data = seen.get(src);
    return data ? `src="${data}"` : m;
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const READER_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; background: #faf9f7; color: #292524;
  font: 17px/1.85 -apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif;
}
article { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
.doc-title {
  font-family: "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
  font-size: 2.1em; line-height: 1.35; margin: 0 0 12px; letter-spacing: .01em;
}
.doc-meta { color: #a8a29e; font-size: .82em; margin-bottom: 36px; display: flex; gap: 16px; }
.doc-meta .tags { color: #b45309; }
.doc-body img, .doc-body video { max-width: 100%; height: auto; border-radius: 8px; }
.doc-body audio { width: 100%; height: 40px; margin: .4em 0; }
.doc-body .voice-pdf {
  display: flex; align-items: center; gap: 10px; margin: 1em 0; padding: 10px 16px;
  border: 1px solid #e7e5e4; border-radius: 10px; background: #f5f4f2;
  color: #78716c; font-size: .88em;
}
.doc-body .excalidraw-fig { margin: 1.5em 0; text-align: center; }
.doc-body h1, .doc-body h2, .doc-body h3, .doc-body h4 {
  font-family: "Noto Serif SC", "Source Han Serif SC", Georgia, serif;
  line-height: 1.4; margin: 1.6em 0 .6em; font-weight: 700;
}
.doc-body h1 { font-size: 1.55em; } .doc-body h2 { font-size: 1.32em; } .doc-body h3 { font-size: 1.12em; }
.doc-body p { margin: .9em 0; }
.doc-body a { color: #b45309; text-decoration: none; border-bottom: 1px solid #d6b48a; }
.doc-body a:hover { color: #92400e; }
.doc-body blockquote {
  margin: 1.2em 0; padding: .2em 1.2em; border-left: 3px solid #d6d3d1;
  color: #57534e; background: #f5f4f2; border-radius: 0 6px 6px 0;
}
.doc-body pre {
  background: #1c1917; color: #e7e5e4; padding: 16px 20px; border-radius: 10px;
  overflow-x: auto; font-size: .86em; line-height: 1.6;
}
.doc-body code { font-family: Consolas, "JetBrains Mono", monospace; }
.doc-body :not(pre) > code { background: #eee9e2; padding: .15em .4em; border-radius: 4px; font-size: .88em; color: #7c2d12; }
.doc-body ul, .doc-body ol { padding-left: 1.6em; }
.doc-body ul.contains-task-list { list-style: none; padding-left: .4em; }
.doc-body li.task-list-item input { margin-right: .5em; }
.doc-body hr { border: none; border-top: 1px solid #e7e5e4; margin: 2.4em auto; width: 60%; }
.doc-body table { border-collapse: collapse; margin: 1.2em 0; }
.doc-body th, .doc-body td { border: 1px solid #e7e5e4; padding: 6px 12px; }
.doc-body th { background: #f5f4f2; }
`;
