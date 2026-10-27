// 代码块的 NodeView：普通代码块保持原样；mermaid 代码块默认只显示 Pele 图，
// 悬停时右上角浮出「图表/源码」切换与「放大」按钮。源码始终存在（只是 display:none），
// 所以文档结构、Markdown 序列化和保存格式都不变。
//
// 为什么不用 widget：widget 只能在代码块旁边再挂一块 DOM，源码和图会同时出现；
// NodeView 才能让两者互斥显示，并给每张图一个明确的模式切换。
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { Mounted } from "pele";
import { Icon } from "./icons";
import { useSettings } from "../i18n";
import { isMermaidLanguage, mountMermaid } from "../lib/mermaid";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function MermaidCanvas({
  source,
  hostRef,
}: {
  source: string;
  hostRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useSettings();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dead = false;
    let mounted: Mounted | null = null;
    host.replaceChildren();
    setPhase("loading");

    // 输入过程中每个字符都会改 source；短暂防抖避免大图每键重排
    const timer = window.setTimeout(() => {
      void mountMermaid(host, source, {
        onError: (err) => console.warn("Mermaid 图表渲染失败：", err),
      })
        .then((m) => {
          if (dead) {
            m?.destroy();
            return;
          }
          mounted = m;
          setPhase(m ? "ready" : "error");
        })
        .catch((err) => {
          if (dead) return;
          setPhase("error");
          console.warn("Mermaid 渲染器加载失败：", err);
        });
    }, 120);

    return () => {
      dead = true;
      window.clearTimeout(timer);
      mounted?.destroy();
    };
  }, [source, hostRef]);

  return (
    <div className="mermaid-preview" contentEditable={false}>
      <div ref={hostRef} className="mermaid-canvas" />
      {phase !== "ready" && (
        <div className={`mermaid-hint${phase === "error" ? " is-error" : ""}`}>
          {t(phase === "error" ? "mermaidLoadError" : "mermaidRendering")}
        </div>
      )}
    </div>
  );
}

/** 全屏放大查看 SVG：滚轮以光标为锚点缩放、窗口随内容长大（上限 92vw/86vh）、
 *  超过上限后拖拽平移、双击复位、Esc / 点击遮罩关闭。
 *  缩放必须落在 layout 尺寸上（内容盒 = 自然尺寸 × scale，内层 transform 只负责绘制），
 *  否则窗口尺寸永远不变，放大后的部分会被 overflow:hidden 裁掉。 */
function MermaidZoom({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useSettings();
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [pannable, setPannable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  // 滚轮缩放前记录：光标下的内容坐标 + 光标屏幕位置，布局提交后据此补偿 pan
  const anchor = useRef<{ bx: number; by: number; cx: number; cy: number } | null>(null);

  // 内容自然尺寸：量一次（svg 的 layout 尺寸；首次挂载时 scale=1，rect 就是自然尺寸）
  useLayoutEffect(() => {
    const svg = innerRef.current?.querySelector("svg");
    const r = svg?.getBoundingClientRect();
    const w = Math.round(r?.width || innerRef.current?.getBoundingClientRect().width || 0);
    const h = Math.round(r?.height || innerRef.current?.getBoundingClientRect().height || 0);
    if (w && h) setBase({ w, h });
  }, [html]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 可视区（扣掉舞台内边距）能容纳多少内容；居中布局下两侧的可用位移是对称的 */
  const limits = () => {
    const stage = stageRef.current;
    if (!stage || !base) return { maxX: 0, maxY: 0 };
    const cs = getComputedStyle(stage);
    const viewW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const viewH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return {
      maxX: Math.max(0, (base.w * scale - viewW) / 2),
      maxY: Math.max(0, (base.h * scale - viewH) / 2),
    };
  };

  // 缩放/量尺寸之后：收敛 pan 回边界，并记住窗口现在能不能拖；顺带补上锚点缩放的位置补偿
  useLayoutEffect(() => {
    if (!base) return;
    const { maxX, maxY } = limits();
    setPannable(maxX > 0.5 || maxY > 0.5);
    const a = anchor.current;
    anchor.current = null;
    let dx = 0;
    let dy = 0;
    if (a && innerRef.current) {
      const r = innerRef.current.getBoundingClientRect();
      dx = a.cx - a.bx * scale - r.left;
      dy = a.cy - a.by * scale - r.top;
    }
    setPan((p) => {
      const nx = clamp(p.x + dx, -maxX, maxX);
      const ny = clamp(p.y + dy, -maxY, maxY);
      return nx === p.x && ny === p.y ? p : { x: nx, y: ny };
    });
  }, [scale, base]);

  // 滚轮缩放：原生监听 + passive:false——React 的 onWheel 是被动监听，preventDefault 无效，
  // 缩放时背后的笔记会跟着一起滚
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const inner = innerRef.current;
      if (!inner || !base) return;
      const r = inner.getBoundingClientRect();
      anchor.current = {
        bx: (e.clientX - r.left) / scale,
        by: (e.clientY - r.top) / scale,
        cx: e.clientX,
        cy: e.clientY,
      };
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.0015), 0.25, 5));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [scale, base]);

  const reset = () => {
    anchor.current = null;
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !pannable) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const { maxX, maxY } = limits();
    setPan({
      x: clamp(d.panX + e.clientX - d.x, -maxX, maxX),
      y: clamp(d.panY + e.clientY - d.y, -maxY, maxY),
    });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      className="mermaid-zoom-overlay"
      role="dialog"
      aria-label={t("mermaidZoom")}
      onClick={onClose}
      onDoubleClick={reset}
    >
      <div
        ref={stageRef}
        className={`mermaid-zoom-stage mermaid-preview${dragging ? " is-dragging" : ""}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: pannable ? (dragging ? "grabbing" : "grab") : "default" }}
      >
        {/* 内容盒：layout 尺寸 = 自然尺寸 × scale，舞台据此撑开（到 92vw/86vh 封顶） */}
        <div
          className="mermaid-zoom-box"
          style={base ? { width: base.w * scale, height: base.h * scale } : undefined}
        >
          <div
            ref={innerRef}
            className="mermaid-zoom-svg"
            style={{
              width: base?.w,
              height: base?.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      <button type="button" className="mermaid-zoom-close" onClick={onClose} title={t("close")}>
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}

function CodeBlockView({ node, selected, editor, getPos }: NodeViewProps) {
  const { t } = useSettings();
  const isMermaid = isMermaidLanguage(node.attrs.language);
  // 已有内容 → 默认看图；新建的空 mermaid 块 → 默认写源码，避免先看到报错
  const [mode, setMode] = useState<"preview" | "source">(() =>
    isMermaid && node.textContent.trim() ? "preview" : "source"
  );
  const showPreview = isMermaid && mode === "preview";
  const hostRef = useRef<HTMLDivElement>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomHtml, setZoomHtml] = useState("");

  const goPreview = () => {
    setMode("preview");
    requestAnimationFrame(() => {
      const pos = getPos();
      if (typeof pos === "number") {
        editor.chain().setTextSelection(pos + node.nodeSize).run();
      }
    });
  };

  const goSource = () => {
    setMode("source");
    requestAnimationFrame(() => {
      const pos = getPos();
      if (typeof pos === "number") {
        editor.chain().focus().setTextSelection(pos + 1).run();
      }
    });
  };

  const openZoom = () => {
    if (hostRef.current?.querySelector(".pele, svg")) {
      setZoomHtml(hostRef.current?.innerHTML ?? "");
      setZoomOpen(true);
    }
  };

  return (
    <NodeViewWrapper
      className={`codeblock-node${isMermaid ? " is-mermaid" : ""}${selected ? " is-selected" : ""}`}
    >
      {isMermaid && (
        <div className="mermaid-tools" contentEditable={false}>
          {showPreview ? (
            <>
              <button
                type="button"
                className="mermaid-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={goSource}
                title={t("mermaidTabSource")}
              >
                <Icon name="code" size="sm" />
              </button>
              <button
                type="button"
                className="mermaid-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openZoom}
                title={t("mermaidZoom")}
              >
                <Icon name="expand" size="sm" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="mermaid-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={goPreview}
              title={t("mermaidTabPreview")}
            >
              <Icon name="diagram" size="sm" />
            </button>
          )}
        </div>
      )}

      {showPreview && (
        <div className="mermaid-body">
          <MermaidCanvas source={node.textContent} hostRef={hostRef} />
        </div>
      )}

      {/* 始终保留 contentDOM；预览模式只是隐藏，不卸载，否则 tiptap 会丢内容/选区 */}
      <pre style={showPreview ? { display: "none" } : undefined}>
        <NodeViewContent<"code"> as="code" />
      </pre>

      {zoomOpen && <MermaidZoom html={zoomHtml} onClose={() => setZoomOpen(false)} />}
    </NodeViewWrapper>
  );
}

export const MermaidCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
