// PDF 标签视图：pdfjs 连续滚动渲染（IntersectionObserver 懒渲染当前页 ±1）、
// 工具栏缩放/适宽/页码跳转；"转为 Markdown" 用本地文本层提取（pdfToMarkdown）。
import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { useSettings } from "../i18n";
import { useDomain } from "../domain/provider";
import { backend } from "../backend";
import type { NoteService } from "../application/note-service";
import { pdfToMarkdown } from "../lib/pdfToMarkdown";

// Vite 把 worker 打进产物（dev 与 Tauri webview 下都走同源 blob，无跨域问题）。
// 每个文档配专属 PDFWorker：pdfjs 的 task.destroy() 会 terminate 底层 Worker
// 并把 port 从全局缓存删掉，共享 workerPort 会让下一次打开直接失效。
function freshWorker(): pdfjs.PDFWorker {
  // 走 create() 而非 new PDFWorker()：官方 d.ts 里构造器 port 参数类型错标为 null，
  // PDFWorkerParameters 才是正确类型；两者运行时行为一致（查缓存 → 新建）
  return pdfjs.PDFWorker.create({ port: new PdfWorker() });
}

/** 加载 vault 内的 PDF 并转成 Markdown 笔记（返回新笔记路径）。
 *  导出给文件树右键菜单复用；调用方请用动态 import() 引入，避免 pdfjs 进首屏包。 */
export async function convertPdfToNote(src: string, noteService: NoteService): Promise<string | null> {
  const { base64 } = await backend.readAssetBase64(src);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const task = pdfjs.getDocument({ data: bytes, worker: freshWorker() });
  const doc = await task.promise;
  try {
    const stem = (src.split("/").pop() ?? "pdf").replace(/\.pdf$/i, "");
    const md = await pdfToMarkdown(doc, { title: stem, source: src });
    return await noteService.importMarkdown(src, md);
  } finally {
    void task.destroy();
  }
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const STEP = 1.15;

interface PageGeo {
  width: number;
  height: number;
}

interface Props {
  src: string;
  /** 标签处于活动栏且可见（隐藏时停 rAF 一类的活，这里暂不区分） */
  active: boolean;
  onClose: () => void;
}

/** 单页：进入视口才渲染 canvas；scale 变化时重渲，卸载时取消渲染任务 */
function PdfPage({
  doc,
  pageNo,
  geo,
  scale,
  visible,
}: {
  doc: PDFDocumentProxy;
  pageNo: number;
  geo: PageGeo;
  scale: number;
  visible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let task: { cancel: () => void } | null = null;
    let dead = false;
    void (async () => {
      try {
        const page = await doc.getPage(pageNo);
        if (dead) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(geo.width * scale)}px`;
        canvas.style.height = `${Math.floor(geo.height * scale)}px`;
        const handle = page.render({ canvas, viewport });
        task = handle;
        await handle.promise;
      } catch (e) {
        // RENDERING_CANCELLED 属正常切换，不打扰用户
        if (!(e instanceof Error) || !/cancel/i.test(e.message)) console.warn("PDF 渲染失败", e);
      }
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, pageNo, scale, visible, geo.width, geo.height]);

  return (
    <div
      className="pdf-page"
      data-page={pageNo}
      style={{ width: Math.floor(geo.width * scale), height: Math.floor(geo.height * scale) }}
    >
      <canvas ref={canvasRef} />
      <span className="pdf-page-no">{pageNo}</span>
    </div>
  );
}

/** 视口内懒渲染：跟踪出现在滚动区里的页号集合 */
function useVisiblePages(root: HTMLElement | null): Set<number> {
  const [visible, setVisible] = useState<Set<number>>(new Set([1]));
  useEffect(() => {
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          let changed = false;
          const add = (n: number) => {
            if (n >= 1 && !next.has(n)) {
              next.add(n);
              changed = true;
            }
          };
          for (const en of entries) {
            const n = Number((en.target as HTMLElement).dataset.page);
            if (Number.isNaN(n)) continue;
            if (en.isIntersecting) {
              add(n);
              add(n - 1);
              add(n + 1);
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: "40% 0px" }
    );
    for (const el of root.querySelectorAll(".pdf-page")) io.observe(el);
    return () => io.disconnect();
  }, [root]);
  return visible;
}

export default function PdfViewer({ src, active, onClose }: Props) {
  const { t } = useSettings();
  const { notes: noteService, workspace } = useDomain();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [geos, setGeos] = useState<PageGeo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scaleMode, setScaleMode] = useState<"fit" | number>("fit");
  const [fitScale, setFitScale] = useState(1);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const visiblePages = useVisiblePages(root);
  const [convert, setConvert] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [convertedName, setConvertedName] = useState("");

  // ---- 加载文档 ----
  useEffect(() => {
    let dead = false;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    void (async () => {
      setDoc(null);
      setGeos([]);
      setError(null);
      setConvert("idle");
      try {
        const { base64 } = await backend.readAssetBase64(src);
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        task = pdfjs.getDocument({ data: bytes, worker: freshWorker() });
        const loaded = await task.promise;
        if (dead) {
          void task.destroy();
          return;
        }
        const first = await loaded.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        setGeos(Array.from({ length: loaded.numPages }, () => ({ width: vp.width, height: vp.height })));
        setDoc(loaded);
        setPage(1);
      } catch (e) {
        console.error("PDF 加载失败", e);
        if (!dead) setError(src.split("/").pop() ?? src);
      }
    })();
    return () => {
      dead = true;
      void task?.destroy(); // 换文件/卸载：中止加载并释放 worker 侧资源
    };
  }, [src]);

  // ---- 适宽计算 ----
  useEffect(() => {
    if (!geos.length) return;
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const maxW = Math.max(...geos.map((g) => g.width));
      const avail = el.clientWidth - 64;
      if (maxW > 0 && avail > 0) setFitScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, avail / maxW)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [geos]);

  const scale = scaleMode === "fit" ? fitScale : scaleMode;
  const total = geos.length;

  // ---- 滚动 → 当前页码（视口中线所在页） ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mid = el.scrollTop + el.clientHeight / 2;
        let acc = 0;
        let cur = 1;
        for (let i = 0; i < geos.length; i++) {
          const h = geos[i].height * scale + 16;
          if (acc + h >= mid) {
            cur = i + 1;
            break;
          }
          acc += h;
          cur = i + 2;
        }
        setPage(Math.min(cur, total));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [geos, scale, total, active]);

  const zoom = useCallback((dir: 1 | -1) => {
    setScaleMode((m) => {
      const base = m === "fit" ? fitScale : m;
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, base * (dir > 0 ? STEP : 1 / STEP)));
    });
  }, [fitScale]);

  const goToPage = useCallback((n: number) => {
    const el = scrollRef.current;
    if (!el || n < 1 || n > total) return;
    const target = el.querySelector(`.pdf-page[data-page="${n}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    setPage(n);
  }, [total]);

  // ---- 转为 Markdown：提取文本层 → 落盘同名 .md → 新标签打开 ----
  const convertToMd = useCallback(async () => {
    if (!doc || convert === "busy") return;
    setConvert("busy");
    try {
      const stem = (src.split("/").pop() ?? "pdf").replace(/\.pdf$/i, "");
      const md = await pdfToMarkdown(doc, { title: stem, source: src });
      const mdPath = await noteService.importMarkdown(src, md);
      if (!mdPath) throw new Error("import failed");
      setConvertedName(mdPath.split("/").pop() ?? mdPath);
      setConvert("done");
      workspace.open(mdPath, "newTab");
    } catch (e) {
      console.error("PDF 转 Markdown 失败", e);
      setConvert("fail");
    }
  }, [doc, src, convert, noteService, workspace]);

  const pct = Math.round(scale * 100);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <div className="pdf-toolbar-group">
          <button title={t("pdfZoomOut")} onClick={() => zoom(-1)} disabled={!doc}>
            −
          </button>
          <span className="pdf-zoom-pct">{pct}%</span>
          <button title={t("pdfZoomIn")} onClick={() => zoom(1)} disabled={!doc}>
            +
          </button>
          <button
            title={t("pdfFitWidth")}
            className={scaleMode === "fit" ? "pdf-tool-on" : ""}
            onClick={() => setScaleMode("fit")}
            disabled={!doc}
          >
            ⤢
          </button>
        </div>
        <div className="pdf-toolbar-group">
          <input
            className="pdf-page-input"
            type="number"
            min={1}
            max={total || 1}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setPage(Math.max(1, Math.min(total || 1, n)));
            }}
            onKeyDown={(e) => e.key === "Enter" && goToPage(page)}
            title={t("pdfGoPage")}
          />
          <span className="pdf-page-total">/ {total || "…"}</span>
        </div>
        <div className="pdf-toolbar-spacer" />
        {convert === "done" ? (
          <span className="pdf-convert-ok" title={convertedName}>
            ✓ {t("pdfConverted", { name: convertedName })}
          </span>
        ) : (
          <button
            className={`pdf-convert-btn ${convert === "fail" ? "pdf-convert-fail" : ""}`}
            onClick={() => void convertToMd()}
            disabled={!doc || convert === "busy"}
            title={convert === "fail" ? t("pdfConvertFail") : undefined}
          >
            {convert === "busy" ? t("pdfConverting") : convert === "fail" ? t("pdfConvertFail") : t("pdfConvert")}
          </button>
        )}
        <button className="pdf-close-btn" title={t("close")} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="pdf-scroll" ref={(el) => { scrollRef.current = el; setRoot(el); }}>
        {error ? (
          <div className="pdf-fallback">
            <p>{t("pdfLoadFail")}</p>
            <p className="pdf-fallback-path">{error}</p>
          </div>
        ) : !doc ? (
          <div className="pdf-fallback">{t("pdfLoading")}</div>
        ) : (
          geos.map((g, i) => (
            <PdfPage key={i} doc={doc} pageNo={i + 1} geo={g} scale={scale} visible={visiblePages.has(i + 1)} />
          ))
        )}
      </div>
    </div>
  );
}
