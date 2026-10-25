// 笔记悬浮目录（自创样式，刻意不抄 Obsidian）：
// - **靠正文自适应**：默认左缘锚定正文右缘外侧（GAP_X），绝不粘到窗口/编辑区右边缘
// - 宽度 = 内容实测需要（夹在 [MIN_W, MAX_W]）；**展开方向要算**：
//   右侧装得下 → 向右展开（不压正文）；右侧不够 = 需折叠的情况 → **默认先收起**，
//   用户点开后才是向左展开的背景板态（纸底 + 描边 + 阴影），一直保持到再点收起
// - 装不下（真超长标题）才省略号，且只有真截断时挂 title（hover 出全文）
// - 点击平滑滚到标题；滚动时高亮当前所在章节
// - 永不自动消失：只有用户点收起才变右缘小圆钮（按钮始终存在，持久记忆）
import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";

/** 目录宽度下限（再窄就没法读了） */
const MIN_W = 180;
/** 目录宽度上限（跟正文走的自适应上限：足够装下常见长度的标题，又不会被窗口无限拉长） */
const MAX_W = 460;
/** 目录左缘与正文右缘的间距 */
const GAP_X = 6;
/** 小圆钮（拥挤兑底）与编辑区右缘的最小距离 */
const FAB_INSET = 10;
/** 展开态目录与编辑区右缘至少保留的空隙（任何宽度下都不贴边） */
const EDGE_INSET = 16;

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

/** 单条目录项：单行省略号；只有真正被截断才挂 title（hover 展示全文） */
function TocItem({
  heading,
  active,
  onJump,
}: {
  heading: TocHeading;
  active: boolean;
  onJump: (pos: number) => void;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    // scrollWidth/clientWidth 是取整值，差 1px 也可能已经在画省略号了，
    // 所以只要有一点点溢出就算截断（宁可多一个 tip，也不要省略号了却没提示）
    const check = () => setTruncated(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [heading.text]);
  return (
    <button
      className={`note-toc-item note-toc-l${heading.level}${active ? " on" : ""}`}
      onClick={() => onJump(heading.pos)}
      title={truncated ? heading.text : undefined}
    >
      <span ref={textRef} className="note-toc-text">
        {heading.text}
      </span>
    </button>
  );
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
  // 正文右缘外侧的锚点（相对编辑区左边）：目录左缘默认落在这里
  const [anchor, setAnchor] = useState(0);
  // 锚点到编辑区右缘还剩多宽（向右展开的容量）
  const [spaceR, setSpaceR] = useState(0);
  // 编辑区宽度（向左展开、小圆钮夹紧共用）
  const [hostW, setHostW] = useState(0);
  // 完整显示全部标题所需宽度
  const [needed, setNeeded] = useState(0);
  const [activePos, setActivePos] = useState<number | null>(null);
  // 放不下时的临时展开（背景板态）：记录"为哪个宽度档点开的"。
  // 用 key 而不是布尔，宽度档一变就自然回到"默认收起"，不需要副作用里清状态。
  const [peekKey, setPeekKey] = useState<string | null>(null);
  // 离屏测量副本（收起态也挂载，保证宽度能测准）
  const measureRef = useRef<HTMLDivElement>(null);

  // ---- 展开方向的计算 ----
  // 想要宽度 = 完整显示全部标题（夹在 [MIN_W, MAX_W]）
  const want = Math.min(MAX_W, Math.max(MIN_W, needed || MIN_W));
  // 编辑区里横向能容下的极限（两侧各留 EDGE_INSET）
  const maxInPane = Math.max(MIN_W, hostW - EDGE_INSET * 2);
  // 右侧装得下 → 向右展开，不压正文；装不下 → 需折叠的情况：默认先收起，
  // 用户点开后才是向左展开的背景板态
  const overlay = want > spaceR + 1;
  const narrowKey = `${Math.round(spaceR)}:${Math.round(want)}`;
  const collapsed = overlay ? peekKey !== narrowKey : userCollapsed;
  const width = Math.min(want, maxInPane);
  // 向右：左缘钉在正文右缘外侧；向左：右缘钉在编辑区右侧（向左侧生长）
  const left = overlay
    ? Math.max(EDGE_INSET, hostW - EDGE_INSET - width)
    : Math.min(anchor, Math.max(EDGE_INSET, hostW - EDGE_INSET - width));
  // 收起态的小圆钮也要跟着正文：优先贴正文右缘，超出编辑区则夹回内侧
  const fabLeft = Math.max(FAB_INSET, Math.min(anchor, hostW - 30 - FAB_INSET));

  const toggleCollapsed = () => {
    // 需折叠的情况：只是临时展开（背景板态），不改持久偏好
    if (overlay) {
      setPeekKey((v) => (v === narrowKey ? null : narrowKey));
      return;
    }
    setUserCollapsed((v) => {
      localStorage.setItem("noteshare.tocCollapsed", v ? "1" : "0");
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

  // 量两件事（以正文所在栏为基准，与滚动无关）：
  // 1) anchor = 正文右缘 + GAP_X（目录左缘锚点，跟着正文自适应）
  // 2) spaceR = 锚点到编辑区右缘还剩多少（向右展开的容量）
  // 挂载时同步量一次（RO 首派发走渲染循环，后台页会停），之后交给 ResizeObserver。
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    // 定位基准 = 正文所在的栏（NoteToc 的 offsetParent：flex 列容器）
    const host = pane.parentElement ?? pane;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      let proseRight = rect.right;
      try {
        proseRight = editor.view.dom.getBoundingClientRect().right;
      } catch {
        /* view 未就绪/已销毁：按铺满处理（下一轮再测） */
      }
      const x0 = Math.round(proseRight - rect.left + GAP_X);
      setAnchor(x0);
      setHostW(Math.round(rect.width));
      setSpaceR(Math.max(0, Math.round(rect.width - EDGE_INSET - x0)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [editor, scrollRef]);

  // 量"完整显示全部标题"所需宽度：离屏副本量（收起态列表不渲染，绝不能依赖它，
  // 否则收起时量不到宽度 → 退回 MIN_W，展开后每行只能显示几个字）。
  useEffect(() => {
    const box = measureRef.current;
    if (!box) return;
    let alive = true;
    const measure = () => {
      if (!alive || !measureRef.current) return;
      const el = measureRef.current;
      // 条目在离屏副本里是 max-content，直接取最宽那条
      let itemW = 0;
      el.querySelectorAll<HTMLElement>(".note-toc-item").forEach((b) => {
        itemW = Math.max(itemW, b.getBoundingClientRect().width);
      });
      const inner = el.querySelector<HTMLElement>(".note-toc-inner");
      const list = el.querySelector<HTMLElement>(".note-toc-list");
      const innerPad = inner
        ? parseFloat(getComputedStyle(inner).paddingLeft) + parseFloat(getComputedStyle(inner).paddingRight)
        : 0;
      const listPad = list ? parseFloat(getComputedStyle(list).paddingRight) : 0;
      // +4：亚像素/字体舍入的安全余量，避免“刚好吃不下”时还画省略号
      setNeeded(Math.ceil(itemW + innerPad + listPad + 4));
    };
    measure();
    // 字体是异步加载的（Assistant 等）：字体到位后重新量一次，避免按回退字体算窄
    let off = false;
    void document.fonts?.ready.then(() => {
      if (!off) measure();
    });
    return () => {
      alive = false;
      off = true;
    };
  }, [headings]);

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

  if (headings.length < 2) return null;

  const jump = (pos: number) => {
    try {
      const at = editor.view.domAtPos(pos + 1);
      const dom = at.node.nodeType === 1 ? (at.node as HTMLElement) : at.node.parentElement;
      dom?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      /* 忽略瞬时失效 */
    }
  };

  // 离屏测量副本：段落/条目与真实目录同结构，但不受容器宽度约束（max-content），
  // 收起态也挂载 —— 保证"完整显示所需宽度"任何状态下都量得准
  const measureLayer = (
    <div ref={measureRef} className="note-toc note-toc-measure" aria-hidden="true">
      <div className="note-toc-inner">
        <div className="note-toc-list">
          {headings.map((h) => (
            <div key={h.pos} className={`note-toc-item note-toc-l${h.level}`}>
              <span className="note-toc-text">{h.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (collapsed) {
    return (
      <>
        {measureLayer}
        <div className="note-toc note-toc-collapsed" style={{ left: fabLeft }}>
          <button className="note-toc-fab" title="目录" onClick={toggleCollapsed}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 4h11M2.5 8h7M2.5 12h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {measureLayer}
      <div className={`note-toc${overlay ? " note-toc-board" : ""}`} style={{ left, width }}>
        <div className="note-toc-inner">
          <button className="note-toc-fold" title="收起目录" onClick={toggleCollapsed}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="note-toc-list">
            {headings.map((h) => (
              <TocItem key={h.pos} heading={h} active={activePos === h.pos} onJump={jump} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
