// 笔记悬浮目录（自创样式，刻意不抄 Obsidian）：
// - 平时无底无边、浅灰小字悬于编辑区右缘留白处，几乎不构成视觉存在
// - hover 整块点亮：毛玻璃底 + 文字逐级加深（浅灰 → 灰 → 墨色）
// - 点击平滑滚到标题；滚动时高亮当前所在章节
// - 可收起成右缘小圆钮（状态记忆）；编辑区不够宽时整体让位（响应式）
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";

export interface TocHeading {
  pos: number;
  level: number;
  text: string;
}

/** 提取 h1–h3（有文字的） */
export function collectHeadings(editor: Editor): TocHeading[] {
  const out: TocHeading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level ?? 1);
      const text = node.textContent.trim();
      if (text && level <= 3) out.push({ pos, level, text });
    }
    return true;
  });
  return out;
}

export default function NoteToc({
  editor,
  scrollRef,
}: {
  editor: Editor;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("noteshare.tocCollapsed") === "1"
  );
  const [wide, setWide] = useState(true);
  const [activePos, setActivePos] = useState<number | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      localStorage.setItem("noteshare.tocCollapsed", v ? "0" : "1");
      return !v;
    });
  };

  // 标题跟随文档变化
  useEffect(() => {
    const upd = () => setHeadings(collectHeadings(editor));
    upd();
    editor.on("transaction", upd);
    return () => {
      editor.off("transaction", upd);
    };
  }, [editor]);

  // 响应式：编辑区宽度不足（正文 768 + 目录 210 放不下）时整体隐藏
  useEffect(() => {
    const host = hostRef.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      setWide(entries[0].contentRect.width >= 980);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // 滚动时高亮"当前所在章节"（视口顶之下最近的标题）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        let hit: number | null = null;
        for (const h of headings) {
          try {
            const at = editor.view.domAtPos(h.pos + 1);
            const dom = at.node.nodeType === 1 ? (at.node as HTMLElement) : at.node.parentElement;
            if (dom && dom.getBoundingClientRect().top <= 120) hit = h.pos;
          } catch {
            /* 文档变动瞬间可能取不到，跳过 */
          }
        }
        setActivePos(hit);
      });
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor, headings, scrollRef]);

  if (!wide || headings.length < 2) return null;

  const jump = (pos: number) => {
    try {
      const at = editor.view.domAtPos(pos + 1);
      const dom = at.node.nodeType === 1 ? (at.node as HTMLElement) : at.node.parentElement;
      dom?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      /* 忽略瞬时失效 */
    }
  };

  if (collapsed) {
    return (
      <div ref={hostRef} className="note-toc note-toc-collapsed">
        <button className="note-toc-fab" title="目录" onClick={toggleCollapsed}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 4h11M2.5 8h7M2.5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={hostRef} className="note-toc">
      <div className="note-toc-inner">
        <button className="note-toc-fold" title="收起目录" onClick={toggleCollapsed}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="note-toc-list">
          {headings.map((h) => (
            <button
              key={h.pos}
              className={`note-toc-item note-toc-l${h.level}${activePos === h.pos ? " on" : ""}`}
              onClick={() => jump(h.pos)}
              title={h.text}
            >
              {h.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
