// 笔记悬浮目录（自创样式，刻意不抄 Obsidian）：
// - 平时无底无边、浅灰小字悬于编辑区右缘留白处，几乎不构成视觉存在
// - hover 整块点亮：文字逐级加深（浅灰 → 灰 → 墨色）
// - 点击平滑滚到标题；滚动时高亮当前所在章节
// - 智能让位：展开态若会压到正文 → 自动收成右缘小圆钮，此时手动展开只是
//   "偷看"，任何滚动即让位；放得下时完全尊重用户的展开/收起选择（持久
//   记忆，滚动不推翻）；编辑区更窄（<980）时整体让位（响应式隐藏）
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
  // 放得下时的用户选择（localStorage 记忆；滚动不推翻——用户说了算）
  const [userCollapsed, setUserCollapsed] = useState(
    () => localStorage.getItem("noteshare.tocCollapsed") === "1"
  );
  // 压到内容时的"偷看"展开：任何滚动即失效
  const [peek, setPeek] = useState(false);
  const [wide, setWide] = useState(true);
  const [overlaps, setOverlaps] = useState(false);
  const [activePos, setActivePos] = useState<number | null>(null);
  const overlapsRef = useRef(false);

  const collapsed = overlaps ? !peek : userCollapsed;

  const toggleCollapsed = () => {
    if (overlaps) {
      // 压到内容：展开只是偷看，滚动即收
      setPeek((v) => !v);
      return;
    }
    // 放得下：用户说了算，持久记忆，滚动不推翻
    setUserCollapsed((v) => {
      localStorage.setItem("noteshare.tocCollapsed", v ? "0" : "1");
      return !v;
    });
    setPeek(false); // 清掉可能过期的偷看标记
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

  // 响应式 + 遮挡检测：
  // - 编辑区宽度不足（正文 768 + 目录 210 放不下）→ 整体隐藏
  // - 展开态目录（右缘 14 + 宽 212 = 226）左缘越过正文文字右缘 → 判为压到内容。
  //   正文居中，水平几何与滚动无关；挂载时同步量一次（不能用 useLayoutEffect：
  //   它与 ref 挂载同遍历按树序跑，本组件在前、滚动容器 ref 尚未挂上；RO 的
  //   首次派发又走渲染循环，后台/隐藏页面会停），之后交给 RO 跟随 resize
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const measure = () => {
      const rect = pane.getBoundingClientRect();
      setWide(rect.width >= 980);
      let proseRight = Infinity;
      try {
        proseRight = editor.view.dom.getBoundingClientRect().right;
      } catch {
        /* view 未就绪/已销毁：按不压处理，下一轮再测 */
      }
      const next = rect.right - 226 < proseRight;
      if (next !== overlapsRef.current) {
        overlapsRef.current = next;
        setOverlaps(next);
        setPeek(false); // 档位翻转，旧的偷看意图作废
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [editor, scrollRef]);

  // 滚动时高亮"当前所在章节"（视口顶之下最近的标题）；
  // 任何滚动同时结束偷看——目录让位给阅读
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      setPeek(false);
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
      <div className="note-toc note-toc-collapsed">
        <button className="note-toc-fab" title="目录" onClick={toggleCollapsed}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 4h11M2.5 8h7M2.5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="note-toc">
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
