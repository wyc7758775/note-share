// 文章 HTML（composeArticleHtml 产物）→ A4 分页 PDF。
// 排版与"导出单文件 HTML"完全同源：离屏 iframe 套同一份阅读 CSS，观感一致。
// 文本经浏览器 2x 栅格化进 PDF——中文/emoji 零字体嵌入问题，代价是不可选中复制，
// 分享/打印场景够用；日后要可选中文本再考虑 CJK 字体子集嵌入。
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

const A4_W = 794; // A4 @96dpi 的 CSS 像素
const A4_H = 1123;
const PAD = 56; // ≈15mm 页边距
const CONTENT_W = A4_W - PAD * 2;
const CONTENT_H = A4_H - PAD * 2;
const A4_W_PT = 595.28; // jsPDF 用 pt 单位的 A4
const A4_H_PT = 841.89;

// 覆盖阅读 CSS 里为浏览器窗口设计的部分：文章撑满内容宽、白底、去页面留白
const OVERRIDE_CSS = `<style>
  html, body { margin: 0; background: #fff; }
  article { max-width: none; margin: 0; padding: 0; }
</style>`;

interface BlockBox {
  el: Element;
  mt: number;
  mb: number;
  h: number;
}

/** 等一拍让布局/图片稳定。用 setTimeout 而非 rAF：离屏 iframe 与最小化窗口
 *  里 rAF 可能永不调度（Chromium 对不可见 frame 不排帧），定时器最差被节流到 1Hz 也总会触发。 */
function settle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 离屏 iframe 渲染整篇文章（宽=内容宽），返回测量好的顶层块列表 */
async function layoutBlocks(html: string): Promise<{ iframe: HTMLIFrameElement; blocks: BlockBox[] }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-99999px",
    top: "0",
    width: `${CONTENT_W}px`,
    height: "600px",
    border: "0",
    background: "#fff",
  });
  iframe.srcdoc = html + OVERRIDE_CSS;
  document.body.appendChild(iframe);
  // srcdoc iframe 会先对 about:blank 触发一次 load 再对真文档触发一次（规范已知行为），
  // 单等一次 load 会抢在真文档解析前查询——轮询到 article 真出现为止
  await new Promise<void>((resolve, reject) => {
    const t0 = performance.now();
    const check = () => {
      const d = iframe.contentDocument;
      if (d && d.readyState === "complete" && d.querySelector("article")) return resolve();
      if (performance.now() - t0 > 5000) return reject(new Error("srcdoc 加载超时"));
      setTimeout(check, 30);
    };
    iframe.addEventListener("load", check);
    check();
  });
  const win = iframe.contentWindow!;
  // 等 dataURL 图片与字体就绪后再量高度，否则分页会量错
  await win.document.fonts.ready;
  await settle(60);

  const doc = win.document;
  const article = doc.querySelector("article");
  const body = doc.querySelector(".doc-body");
  if (!article || !body) {
    iframe.remove();
    throw new Error("文章结构不符合预期（缺少 article/.doc-body）");
  }
  const cs = win.getComputedStyle.bind(win);
  const els = [...article.children].flatMap((ch) =>
    ch.classList.contains("doc-body") ? [...ch.children] : [ch]
  ) as HTMLElement[];
  const blocks = els.map((el) => {
    const s = cs(el);
    return { el, mt: parseFloat(s.marginTop), mb: parseFloat(s.marginBottom), h: el.offsetHeight };
  });
  return { iframe, blocks };
}

/** 贪心装箱：装不下就换页。按 mt+h+mb 计高（略保守，宁多留白不裁字）；
 *  单块超过一页高的（超长代码块/大图）独占一页，页尾溢出部分被裁掉。 */
function paginate(blocks: BlockBox[]): BlockBox[][] {
  const pages: BlockBox[][] = [];
  let cur: BlockBox[] = [];
  let used = 0;
  for (const b of blocks) {
    const eff = b.mt + b.h + b.mb;
    if (cur.length && used + eff > CONTENT_H) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(b);
    used += eff;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

/** 每页快照：块的 outerHTML 静态拼进 A4 页框，2x 栅格化成 PNG。
 *  页框建在主文档而非 iframe 里——html-to-image 捕获 srcdoc iframe 内部节点会挂起
 *  （不报错、永远 pending）；阅读 CSS 复制一份进主文档，导出专用类名与应用样式不冲突。 */
async function capturePages(iframe: HTMLIFrameElement, pages: BlockBox[][]): Promise<string[]> {
  const idoc = iframe.contentDocument!;
  const style = document.createElement("style");
  style.textContent =
    [...idoc.querySelectorAll("style")].map((s) => s.textContent).join("\n") +
    `
/* 阅读 CSS 的 body 字体/配色规则在主文档里命中不了页框，这里按等价规则补上 */
.__mdpdf-page {
  font: 17px/1.85 -apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif;
  color: #292524;
}
`;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-99999px", top: "0", margin: "0" });
  const page = document.createElement("div");
  page.className = "__mdpdf-page";
  Object.assign(page.style, {
    width: `${A4_W}px`,
    height: `${A4_H}px`,
    background: "#fff",
    padding: `${PAD}px`,
    boxSizing: "border-box",
    overflow: "hidden",
    margin: "0",
  });
  // 内层保留 .doc-body 类名：阅读 CSS 的选择器都以它为前缀，丢了样式全失效
  const inner = document.createElement("div");
  inner.className = "doc-body";
  page.appendChild(inner);
  host.append(style, page);
  document.body.appendChild(host);

  const shots: string[] = [];
  // html-to-image 的 createImage 在 img.decode() 后要等 rAF 才 resolve——
  // 窗口最小化/面板后台时 rAF 不调度，导出会永久挂起。捕获期间换成定时器垫片。
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0);
  try {
    for (const pg of pages) {
      inner.innerHTML = pg.map((b) => b.el.outerHTML).join("");
      shots.push(
        await toPng(page, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          width: A4_W,
          height: A4_H,
        })
      );
    }
  } finally {
    window.requestAnimationFrame = origRaf;
    host.remove();
  }
  return shots;
}

/** 组装并返回 PDF 字节 */
export async function articleHtmlToPdf(html: string): Promise<Uint8Array<ArrayBuffer>> {
  const { iframe, blocks } = await layoutBlocks(html);
  try {
    const shots = await capturePages(iframe, paginate(blocks));
    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
    shots.forEach((url, i) => {
      if (i) pdf.addPage();
      pdf.addImage(url, "PNG", 0, 0, A4_W_PT, A4_H_PT);
    });
    return new Uint8Array(pdf.output("arraybuffer"));
  } finally {
    iframe.remove();
  }
}

/** Uint8Array → base64（分块转，大文件 spread 会爆调用栈） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
