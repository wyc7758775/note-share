// PDF → Markdown：基于 pdfjs 文本层做结构推断（无第三方转换服务，全程本地）。
// 两遍扫描：先收集全部页的行（坐标/字号），统计正文字号后再生成分级标题、
// 合并跨行段落、识别列表、剔除页码与页眉页脚。
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

interface Line {
  text: string;
  size: number; // 字号（PDF 单位）
  x: number; // 行首 x
  y: number; // 基线 y（PDF 坐标，向上为正）
  page: number; // 1 起
  index: number; // 页内行序
}

const CJK_RE = /[\u2e80-\u2eff\u3000-\u303f\u31c0-\u31ef\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufeff]/;

/** 行文本末尾是否为 CJK（决定拼接时是否补空格） */
const endsCJK = (s: string) => CJK_RE.test(s.slice(-1));
const startsCJK = (s: string) => CJK_RE.test(s[0] ?? "");

/** 一页的文本项按 y 坐标聚成行，行内按 x 排序 */
function linesOfPage(items: TextItem[], page: number): Line[] {
  const raw = items
    .filter((it) => typeof it.str === "string" && it.str.trim().length > 0)
    .map((it) => ({
      str: it.str,
      // transform = [a,b,c,d,e,f]；字号取竖直缩放的模长，width 是 pdfjs 量好的推进宽
      size: Math.hypot(it.transform[1], it.transform[3]) || it.height || 10,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
    }));
  raw.sort((a, b) => b.y - a.y || a.x - b.x); // 自上而下
  const lines: { y: number; size: number; parts: typeof raw }[] = [];
  for (const it of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < Math.max(last.size, it.size) * 0.4) {
      last.parts.push(it);
      last.y = (last.y * (last.parts.length - 1) + it.y) / last.parts.length; // 均值防漂移
      last.size = Math.max(last.size, it.size);
    } else {
      lines.push({ y: it.y, size: it.size, parts: [it] });
    }
  }
  return lines.map((ln, i) => {
    ln.parts.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd: number | null = null;
    for (const p of ln.parts) {
      if (prevEnd !== null && p.x - prevEnd > ln.size * 0.22 && text && !text.endsWith(" ")) {
        // 西文间隙补空格；CJK 之间不补
        if (!(endsCJK(text) && startsCJK(p.str))) text += " ";
      }
      text += p.str;
      prevEnd = p.x + p.w;
    }
    return { text: text.replace(/\s+$/g, ""), size: ln.size, x: ln.parts[0].x, y: ln.y, page, index: i };
  }).filter((ln) => ln.text.trim().length > 0);
}

/** 纯页码行（"12"、"第 3 页"、"Page 12 of 40"） */
function isPageNumberLine(s: string): boolean {
  return /^(?:[\s\-–—|.)]*\d{1,4}[\s\-–—|,]*|page\s+\d{1,4}(\s*(of|\/)\s*\d{1,4})?|第\s*\d{1,4}\s*页)$/i.test(
    s.trim()
  );
}

/** 列表项前缀归一：• · ◦ ‣ ▪ 等统一成 "-"，数字序号保留 */
function listPrefix(s: string): string | null {
  const t = s.trimStart();
  if (/^[•·◦‣▪●○–—]\s+/.test(t)) return "- ";
  const m = t.match(/^(\d{1,3})[.)]\s+/);
  if (m) return `${m[1]}. `;
  if (/^[a-z][.)]\s+/i.test(t)) return "- "; // 字母列表降级为无序
  return null;
}

/** 全文档出现于多数页的相同首/末行 → 页眉页脚 */
function headerFooterTexts(pages: Line[][], threshold: number): Set<string> {
  const count = new Map<string, number>();
  for (const lines of pages) {
    if (!lines.length) continue;
    for (const ln of [lines[0], lines[lines.length - 1]]) {
      const key = ln.text.trim();
      if (key.length < 2 || isPageNumberLine(key)) continue;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  for (const [k, c] of count) if (c >= Math.max(3, threshold)) out.add(k);
  return out;
}

/** 正文字号：按行字符量加权取众数区间（取加权中位附近的档位） */
function bodySizeOf(lines: Line[]): number {
  const weighted = new Map<number, number>();
  for (const ln of lines) {
    const k = Math.round(ln.size * 2) / 2; // 0.5 档
    weighted.set(k, (weighted.get(k) ?? 0) + ln.text.length);
  }
  let best = 10;
  let bestW = -1;
  for (const [k, w] of weighted) {
    if (w > bestW) {
      best = k;
      bestW = w;
    }
  }
  return best;
}

function headingLevel(size: number, body: number): 0 | 1 | 2 | 3 {
  const r = size / body;
  if (r >= 1.7) return 1;
  if (r >= 1.3) return 2;
  if (r >= 1.08) return 3;
  return 0;
}

export interface PdfToMdOptions {
  /** 文档标题（写入 frontmatter 与首行标题） */
  title: string;
  /** 来源 PDF 的 vault 相对路径（写入 frontmatter） */
  source: string;
}

/** 把已加载的 PDF 文档转成 Markdown 文本 */
export async function pdfToMarkdown(doc: PDFDocumentProxy, opts: PdfToMdOptions): Promise<string> {
  const pages: Line[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(
      linesOfPage(content.items.filter((it): it is TextItem => "str" in it), p)
    );
  }
  const all = pages.flat();
  const body = bodySizeOf(all);
  const noise = headerFooterTexts(pages, Math.ceil(pages.length * 0.6));

  // ---- 行 → 块（标题独立成块；正文按行距合并段落，允许跨页续段） ----
  const blocks: { text: string; level: number }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ text: para.join(""), level: 0 });
      para = [];
    }
  };
  let prev: Line | null = null;
  for (const ln of all) {
    const trimmed = ln.text.trim();
    const nearEdge = ln.index <= 1 || pages[ln.page - 1].length - ln.index <= 2;
    if ((nearEdge && isPageNumberLine(trimmed)) || noise.has(trimmed)) continue;
    const level = headingLevel(ln.size, body);
    const list = listPrefix(trimmed);
    if (level > 0) {
      flush();
      blocks.push({ text: trimmed, level });
      prev = ln;
      continue;
    }
    if (list) {
      flush();
      // 去掉原始项目符/序号，换成规范 Markdown 前缀
      const rest = trimmed
        .replace(/^[•·◦‣▪●○–—]\s+/, "")
        .replace(/^\d{1,3}[.)]\s+/, "")
        .replace(/^[a-z][.)]\s+/i, "");
      blocks.push({ text: `${list}${rest}`, level: 0 });
      prev = ln;
      continue;
    }
    // 段落续行判定：与上一行同页、行距约一个行高、未缩进开头
    const cont =
      prev &&
      para.length > 0 &&
      ((prev.page === ln.page && Math.abs(prev.y - ln.y) < ln.size * 2.1) ||
        // 跨页续段：上一页末行接本页首行，且上行不以句读结尾（句子被分页截断）
        (prev.page === ln.page - 1 &&
          ln.index === 0 &&
          prev.index === pages[prev.page - 1].length - 1 &&
          Math.abs(ln.size - body) < body * 0.08 &&
          !/[。！？；.!?;:]$/.test(prev.text.trimEnd())));
    if (cont) {
      const joiner = endsCJK(para[para.length - 1]) || startsCJK(trimmed) ? "" : " ";
      para[para.length - 1] += joiner + trimmed;
    } else {
      flush();
      para = [trimmed];
    }
    prev = ln;
  }
  flush();

  // ---- 输出 ----
  const now = new Date().toISOString();
  const out: string[] = [`---`, `title: ${opts.title}`, `source: ${opts.source}`, `created: ${now}`, `---`, ``, `# ${opts.title}`, ``];
  let first = true;
  for (const b of blocks) {
    const text = b.text.replace(/\s{3,}/g, " ").trim();
    if (!text) continue;
    if (first) {
      first = false;
      // 文档首个一级标题与注入的标题行相同时跳过（frontmatter 已表达）
      if (b.level === 1 && text.replace(/\s+/g, "").toLowerCase() === opts.title.replace(/\s+/g, "").toLowerCase()) {
        continue;
      }
    }
    out.push(b.level > 0 ? `${"#".repeat(b.level)} ${text}` : text);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
