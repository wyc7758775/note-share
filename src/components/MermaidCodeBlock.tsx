// 代码块的 NodeView：普通代码块保持原样；mermaid 代码块默认只显示 Pele 图，
// 顶部「图表 / 源码」切换。源码始终存在（只是 display:none），所以文档结构、
// Markdown 序列化和保存格式都不变。
//
// 为什么不用 widget：widget 只能在代码块旁边再挂一块 DOM，源码和图会同时出现；
// NodeView 才能让两者互斥显示，并给每张图一个明确的模式切换。
import { useEffect, useRef, useState } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import type { Mounted } from "pele";
import { useSettings } from "../i18n";
import { isMermaidLanguage, mountMermaid } from "../lib/mermaid";

function MermaidCanvas({ source }: { source: string }) {
  const { t } = useSettings();
  const hostRef = useRef<HTMLDivElement>(null);
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
  }, [source]);

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

function CodeBlockView({ node, selected, editor, getPos }: NodeViewProps) {
  const { t } = useSettings();
  const isMermaid = isMermaidLanguage(node.attrs.language);
  // 已有内容 → 默认看图；新建的空 mermaid 块 → 默认写源码，避免先看到报错
  const [mode, setMode] = useState<"preview" | "source">(() =>
    isMermaid && node.textContent.trim() ? "preview" : "source"
  );
  const showPreview = isMermaid && mode === "preview";

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

  return (
    <NodeViewWrapper
      className={`codeblock-node${isMermaid ? " is-mermaid" : ""}${selected ? " is-selected" : ""}`}
    >
      {isMermaid && (
        <div className="mermaid-head" contentEditable={false}>
          <span className="mermaid-badge">◇ Mermaid</span>
          <div className="mermaid-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={showPreview}
              className={`mermaid-tab${showPreview ? " on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={goPreview}
            >
              {t("mermaidTabPreview")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!showPreview}
              className={`mermaid-tab${!showPreview ? " on" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={goSource}
            >
              {t("mermaidTabSource")}
            </button>
          </div>
        </div>
      )}

      {showPreview && (
        <div className="mermaid-body">
          <MermaidCanvas source={node.textContent} />
        </div>
      )}

      {/* 始终保留 contentDOM；预览模式只是隐藏，不卸载，否则 tiptap 会丢内容/选区 */}
      <pre style={showPreview ? { display: "none" } : undefined}>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

export const MermaidCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
