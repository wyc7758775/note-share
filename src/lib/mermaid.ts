// Mermaid 图表的 Pele 渲染桥（UI 投影层，不含业务事实）。
//
// 为什么单独一层：
// - Pele 只在真正出现 mermaid 代码块时才需要加载（约 700KB），静态 import 会把
//   它塞进首屏包；这里统一用动态 import + 单例 Promise。
// - 编辑器预览、HTML/PDF 导出、发布三条链路共用同一套语言判断和主题字体，
//   避免各写一份“什么算 mermaid 代码块”的规则。
// - Pele 输出的是纯 SVG（不产生 Excalidraw 元素），所以它不能替换 Excalidraw
//   内置的 Mermaid → Excalidraw 转换；那条链路的依赖保持原样。
import type { Mounted, RenderOptions } from "pele";

/** 导出 HTML 时阅读区的字体：与 exportHtml.ts 的 READER_CSS 保持一致 */
export const MERMAID_FONT =
  '-apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif';
export const MERMAID_FONT_MONO = 'Consolas, "JetBrains Mono", monospace';

/** 导出阅读区正文宽约 672px，留一点余量让 Pele 自行缩放 */
export const MERMAID_EXPORT_WIDTH = 640;

let pelePromise: Promise<typeof import("pele")> | null = null;

function loadPele(): Promise<typeof import("pele")> {
  pelePromise ??= import("pele");
  return pelePromise;
}

/** fenced code block 的 info string / tiptap language 属性是否表示 mermaid */
export function isMermaidLanguage(language: unknown): boolean {
  if (typeof language !== "string") return false;
  const lang = language.trim().toLowerCase();
  return lang === "mermaid" || lang === "mmd";
}

/**
 * 把 Pele 挂到容器里（读取容器 CSS 变量、自动跟随宽度、错误直接显示在容器内）。
 * 动态 import 期间节点可能已被 ProseMirror 移除，这里在前后各检查一次连接状态。
 */
export async function mountMermaid(
  el: HTMLElement,
  source: string,
  options: RenderOptions & {
    zoom?: boolean | "auto";
    onError?: (error: unknown) => void;
  } = {}
): Promise<Mounted | null> {
  const { mount } = await loadPele();
  // widget 的 toDOM 先于插入文档调用，所以只能等动态 import 完成后再判断连接状态
  if (!el.isConnected) return null;
  return mount(el, source, {
    zoom: false,
    fontFamily: MERMAID_FONT,
    fontFamilyMono: MERMAID_FONT_MONO,
    ...options,
  });
}

export interface MermaidSvg {
  svg: string;
  width: number;
  height: number;
}

/** 渲染成 SVG 字符串（首次调用时懒加载 Pele）——用于导出 HTML / PDF */
export async function renderMermaidSvg(
  source: string,
  options: RenderOptions = {}
): Promise<MermaidSvg> {
  if (!source.trim()) throw new Error("empty mermaid source");
  const { render } = await loadPele();
  return render(source, {
    fontFamily: MERMAID_FONT,
    fontFamilyMono: MERMAID_FONT_MONO,
    fontSize: 16,
    maxWidth: MERMAID_EXPORT_WIDTH,
    ...options,
  });
}

/**
 * 把 Tiptap / markdown-it 产出的 HTML 里的 mermaid fenced code block 换成 SVG。
 * 语法错误时保留原始 <pre><code>，导出不能因为一张图坏掉而丢正文。
 */
export async function renderMermaidInHtml(html: string): Promise<string> {
  if (!/language-(?:mermaid|mmd)\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks = [...doc.querySelectorAll("pre > code")].filter((code) =>
    [...code.classList].some((c) => /^language-(mermaid|mmd)$/i.test(c))
  );

  const runId = Math.random().toString(36).slice(2, 8);
  let index = 0;
  await Promise.all(
    blocks.map(async (code) => {
      const pre = code.parentElement;
      if (!pre) return;
      const source = code.textContent ?? "";
      if (!source.trim()) return;
      try {
        // 同一篇 HTML 里可能有多张图，给每张图独立的 SVG id 前缀，避免 marker/clip id 相撞
        const { svg } = await renderMermaidSvg(source, {
          idPrefix: `pele-${runId}-${index++}`,
        });
        const figure = doc.createElement("figure");
        figure.className = "mermaid-fig";
        figure.innerHTML = svg;
        pre.replaceWith(figure);
      } catch (err) {
        // 保留源码块，发布/导出仍能看到内容；控制台留一条可诊断信息
        console.warn("Mermaid 图表渲染失败，已保留源码块：", err);
      }
    })
  );

  return doc.body.innerHTML;
}
