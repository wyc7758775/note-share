// 官方 Calendar 复刻（workflowy.com 页面 DOM 直读）：
// [<][📅][>] 导航簇 + 横向日期带。箭头 = 前/后一天（月视图 = 前/后一月，自动建节点）；
// 📅 弹日期选择器（Type date 输入 + Today/Tomorrow/Next week 快捷 + 月历网格，可下钻月/年）。
// 日期带一条滚动道：Today chip（仅当今天在起点之前）+ 1px 全高分隔线 + 从 zoom 日（或月首日）
// 起连续的日期 chip（跨月首 chip 头部标月名）+ 年份标签 + 后续 12 个月 chip。
// chip = 28px 竖条（头 18px 标签 + 38px 日期块：周缩写 light + 日号 medium、r4、hover 底色）；
// 今天 = 深底（官方 bg-tertiary）、当前打开日 = 浅底（官方 bg-secondary）、有笔记 = 底部圆点。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import {
  ensureDayAt,
  ensureMonthTarget,
  getRibbonHost,
  itemAddressAt,
  outlineStructureKey,
} from "./outlineKit";
import { dayKey, isDateText, monthOfText, outlineCards, yearOfText } from "./homeViews";

const WD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WD_SUN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // 选择器网格 Su 起头
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** chip 数量：日视图从 zoom 日起 31 个（官方同数），月视图整月 */
const DAY_CHIPS = 31;
/** 月份行：锚定月之后的 12 个月 */
const MONTH_CHIPS = 12;

type ZoomAnchor =
  | { kind: "day"; date: Date }
  | { kind: "month"; year: number; month: number };

/** zoom 目标解析：日期条目（±800 天内匹配）或月份条目（年份取年条目祖先，缺省当前年） */
function zoomAnchor(editor: Editor, today: Date): ZoomAnchor | null {
  const zoomPos = outlineStructureKey.getState(editor.state)?.zoomPos ?? null;
  if (zoomPos == null) return null;
  const node = editor.state.doc.nodeAt(zoomPos);
  if (!node) return null;
  let own = "";
  node.forEach((c) => {
    if (c.type.name === "paragraph" && !own) own = c.textContent.trim();
  });
  for (let off = 0; off < 800; off++) {
    for (const sign of off === 0 ? [0] : [-1, 1]) {
      const d = new Date(today.getTime() + sign * off * 86400000);
      if (isDateText(own, d)) return { kind: "day", date: d };
    }
  }
  const mon = monthOfText(own);
  if (mon != null) {
    const $ = editor.state.doc.resolve(zoomPos + 1);
    let year: number | null = null;
    for (let d = $.depth; d >= 1 && year == null; d--) {
      const anc = $.node(d);
      if (anc.type.name === "taskItem") year = yearOfText(anc.textContent);
    }
    return { kind: "month", year: year ?? today.getFullYear(), month: mon };
  }
  return null;
}

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
      <path
        d={dir < 0 ? "M8 1.5 2.5 8 8 14.5" : "M2 1.5 7.5 8 2 14.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
      <rect x="1.2" y="2.5" width="11.6" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.2 6h11.6M4.4 1v3M9.6 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** 解析 "Type date" 输入（官方：自然语言 + 常见日期写法），失败返回 null */
function parseDateInput(raw: string, today: Date): Date | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^today$/.test(s)) return today;
  if (/^tomorrow$/.test(s)) return new Date(today.getTime() + 86400000);
  if (/^yesterday$/.test(s)) return new Date(today.getTime() - 86400000);
  if (/^next week$/.test(s)) return new Date(today.getTime() + 7 * 86400000);
  if (/^last week$/.test(s)) return new Date(today.getTime() - 7 * 86400000);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s);
  if (m) {
    const y = m[3] ? Number(m[3]) : today.getFullYear();
    return new Date(y, Number(m[1]) - 1, Number(m[2]));
  }
  m = new RegExp(`^(${MON.join("|").toLowerCase()})\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?$`).exec(s);
  if (m) {
    const y = m[3] ? Number(m[3]) : today.getFullYear();
    return new Date(y, MON.findIndex((x) => x.toLowerCase() === m![1]), Number(m[2]));
  }
  return null;
}

/** 日期选择器（官方同款）：Type date 输入 + 快捷日 + 月历网格（月/年可下钻） */
function DatePickOverlay({
  editor,
  today,
  onGoto,
  onClose,
}: {
  editor: Editor;
  today: Date;
  onGoto: (address: number[]) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [level, setLevel] = useState<"days" | "months" | "years">("days");
  const [input, setInput] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDoc, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const page = (delta: number) => {
    if (level === "days") setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));
    else if (level === "months") setView(new Date(view.getFullYear() + delta, 0, 1));
    else setView(new Date(view.getFullYear() + delta * 12, 0, 1));
  };

  // 网格：前置上月尾 + 本月 + 后置下月头，共 6 周（Su 起头）
  const grid: { d: Date; inMonth: boolean }[] = [];
  if (level === "days") {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = first.getDay();
    const start = new Date(first.getTime() - lead * 86400000);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      grid.push({ d, inMonth: d.getMonth() === view.getMonth() });
    }
  }
  const todayK = dayKey(today);

  const pick = (d: Date) => {
    const pos = ensureDayAt(editor, d);
    if (pos != null) {
      const addr = itemAddressAt(editor.state.doc, pos);
      if (addr) onGoto(addr);
    }
    onClose();
  };

  return (
    <div className="wf-picker" ref={boxRef} contentEditable={false}>
      <input
        className="wf-picker-input"
        placeholder="Type date"
        value={input}
        autoFocus
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const d = parseDateInput(input, today);
            if (d) pick(d);
          }
        }}
      />
      <div className="wf-picker-quick">
        <button onClick={() => pick(today)}>Today</button>
        <button onClick={() => pick(new Date(today.getTime() + 86400000))}>Tomorrow</button>
        <button onClick={() => pick(new Date(today.getTime() + 7 * 86400000))}>Next week</button>
      </div>
      <div className="wf-picker-head">
        <button className="wf-picker-nav" onClick={() => page(-1)} aria-label="previous">
          <Chevron dir={-1} />
        </button>
        <button className="wf-picker-title" onClick={() => setLevel("months")}>
          {MON[view.getMonth()]}
        </button>
        <button className="wf-picker-title" onClick={() => setLevel("years")}>
          {view.getFullYear()}
        </button>
        <button className="wf-picker-nav" onClick={() => page(1)} aria-label="next">
          <Chevron dir={1} />
        </button>
      </div>
      {level === "days" && (
        <>
          <div className="wf-picker-grid wf-picker-wd">
            {WD_SUN.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="wf-picker-grid">
            {grid.map(({ d, inMonth }) => {
              const k = dayKey(d);
              return (
                <button
                  key={k}
                  className={`${inMonth ? "" : "is-out"}${k === todayK ? " is-today" : ""}`}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </>
      )}
      {level === "months" && (
        <div className="wf-picker-grid wf-picker-grid12">
          {MON.map((m, i) => (
            <button
              key={m}
              className={i === view.getMonth() && today.getFullYear() === view.getFullYear() ? " is-today" : ""}
              onClick={() => {
                setView(new Date(view.getFullYear(), i, 1));
                setLevel("days");
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {level === "years" && (
        <div className="wf-picker-grid wf-picker-grid12">
          {Array.from({ length: 12 }, (_, i) => view.getFullYear() - 5 + i).map((y) => (
            <button
              key={y}
              className={y === today.getFullYear() ? " is-today" : ""}
              onClick={() => {
                setView(new Date(y, view.getMonth(), 1));
                setLevel("months");
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HomeToday({
  editor,
  onLocate,
}: {
  editor: Editor | null;
  onLocate: (address: number[]) => void;
}) {
  const [tick, setTick] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 拖拽平移（官方 cursor-grab）：按下记录起点，位移 >4px 视为拖动并接管 click
  const dragRef = useRef<{ x: number; sl: number } | null>(null);
  const draggedRef = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const onTr = () => setTick((x) => x + 1);
    editor.on("transaction", onTr as never);
    return () => {
      editor.off("transaction", onTr as never);
    };
  }, [editor]);

  const today = new Date();
  const anchor = useMemo(
    () => (editor ? zoomAnchor(editor, today) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, tick]
  );

  // 有笔记的日期（chip 底部圆点）
  const datedKeys = useMemo(() => {
    if (!editor) return new Set<string>();
    const s = new Set<string>();
    for (const c of outlineCards(editor)) {
      for (let off = -400; off <= 800; off++) {
        const d = new Date(today.getTime() + off * 86400000);
        if (isDateText(c.text, d)) s.add(dayKey(d));
      }
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, tick]);

  // 锚定 chip 滚到左缘（官方行为：zoom 日对齐滚动道起点）
  const anchorKey = anchor ? (anchor.kind === "day" ? dayKey(anchor.date) : `m-${anchor.year}-${anchor.month}`) : "";
  useEffect(() => {
    const wrap = scrollRef.current;
    const el = wrap?.querySelector<HTMLElement>(`[data-chip="${anchorKey}"]`);
    if (!wrap || !el) return;
    // rect 差值对齐：offsetLeft 会被定位祖先干扰，直接把锚 chip 左缘滚到容器左缘
    wrap.scrollLeft += el.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
  }, [anchorKey]);

  if (!editor || !anchor) return null;

  const gotoAddress = (pos: number | null) => {
    if (pos == null) return;
    const addr = itemAddressAt(editor.state.doc, pos);
    if (addr) onLocate(addr);
  };
  const guardClick = () => draggedRef.current; // 拖拽平移后的 click 吞掉
  const onRibbonPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, sl: el.scrollLeft };
    draggedRef.current = false;
  };
  const onRibbonPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) {
      draggedRef.current = true;
      el.classList.add("is-dragging");
      el.scrollLeft = d.sl - dx;
    }
  };
  const onRibbonPointerUp = () => {
    dragRef.current = null;
    scrollRef.current?.classList.remove("is-dragging");
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 60);
  };
  const gotoDay = (d: Date) => gotoAddress(ensureDayAt(editor, d));
  const gotoMonth = (y: number, m: number) => gotoAddress(ensureMonthTarget(editor, y, m));

  const dayOffset = (d: Date) =>
    Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
        new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
        86400000
    );

  // 起点：日视图 = zoom 日；月视图 = 月首日。chip 数：日视图 31；月视图整月。
  const start =
    anchor.kind === "day"
      ? new Date(anchor.date.getFullYear(), anchor.date.getMonth(), anchor.date.getDate())
      : new Date(anchor.year, anchor.month, 1);
  const chipCount =
    anchor.kind === "day"
      ? DAY_CHIPS
      : new Date(anchor.year, anchor.month + 1, 0).getDate();
  const showTodayChip = dayOffset(start) > 0; // 今天在起点之前才出现（官方同款）
  const todayKeyStr = dayKey(today);

  const chips: { d: Date; label: string }[] = [];
  let lastMonth = -1;
  for (let i = 0; i < chipCount; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      chips.push({ d, label: MON[d.getMonth()] });
    } else {
      chips.push({ d, label: "" });
    }
  }

  // 月份行：锚定月之后的 12 个月，每年首 chip（含第一个）标年份
  const anchorMonthIdx = anchor.kind === "day" ? anchor.date.getMonth() + anchor.date.getFullYear() * 12 : anchor.month + anchor.year * 12;
  const months: { year: number; month: number; label: string }[] = [];
  for (let i = 1; i <= MONTH_CHIPS; i++) {
    const idx = anchorMonthIdx + i;
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    months.push({ year: y, month: m, label: m === 0 || i === 1 ? String(y) : "" });
  }

  // 箭头：日视图 ±1 天；月视图 ±1 月
  const step = (delta: number) => {
    if (anchor.kind === "day") {
      const d = new Date(anchor.date.getTime() + delta * 86400000);
      gotoDay(d);
    } else {
      const m = new Date(anchor.year, anchor.month + delta, 1);
      gotoMonth(m.getFullYear(), m.getMonth());
    }
  };

  // 官方顺序：日期条挂在缩放标题下方的装饰宿主里（标题在上、日期条居中、正文再下）
  const ribbon = (
    <div className="wf-ribbon" contentEditable={false}>
      <div className="wf-nav">
        <button className="wf-nav-btn" title="Previous" onClick={() => step(-1)}>
          <Chevron dir={-1} />
        </button>
        <button className="wf-nav-btn" title="Choose date" onClick={() => setPickerOpen((v) => !v)}>
          <CalIcon />
        </button>
        <button className="wf-nav-btn" title="Next" onClick={() => step(1)}>
          <Chevron dir={1} />
        </button>
      </div>
      <div
        className="wf-ribbon-inner"
        ref={scrollRef}
        onPointerDown={onRibbonPointerDown}
        onPointerMove={onRibbonPointerMove}
        onPointerUp={onRibbonPointerUp}
        onPointerLeave={onRibbonPointerUp}
      >
        {showTodayChip && (
          <>
            <button className="wf-chip" onClick={() => !guardClick() && gotoDay(today)}>
              <span className="wf-chip-label">Today</span>
              <span className="wf-chip-box is-today">
                <span className="wf-chip-wd">{WD[(today.getDay() + 6) % 7]}</span>
                <span className="wf-chip-num">{today.getDate()}</span>
              </span>
            </button>
            <span className="wf-ribbon-div" />
          </>
        )}
        {chips.map(({ d, label }) => {
          const k = dayKey(d);
          return (
            <button
              key={k}
              className="wf-chip"
              data-chip={k}
              onClick={() => {
                if (guardClick()) return;
                gotoDay(d);
              }}
            >
              <span className="wf-chip-label">{label}</span>
              <span
                className={`wf-chip-box${k === anchorKey ? " is-cur" : ""}${
                  k === todayKeyStr ? " is-today" : ""
                }`}
              >
                <span className="wf-chip-wd">{WD[(d.getDay() + 6) % 7]}</span>
                <span className="wf-chip-num">{d.getDate()}</span>
                {datedKeys.has(k) && <span className="wf-chip-dot" />}
              </span>
            </button>
          );
        })}
        {months.map(({ year, month, label }) => (
          <button
            key={`m-${year}-${month}`}
            className="wf-mchip"
            data-chip={`m-${year}-${month}`}
            onClick={() => {
              if (guardClick()) return;
              gotoMonth(year, month);
            }}
          >
            <span className="wf-chip-label">{label}</span>
            <span className={`wf-mchip-name${anchor.kind === "month" && year === anchor.year && month === anchor.month ? " is-cur" : ""}`}>
              {MON[month]}
            </span>
          </button>
        ))}
      </div>
      {pickerOpen && (
        <DatePickOverlay
          editor={editor}
          today={today}
          onGoto={(addr) => onLocate(addr)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
  const host = getRibbonHost();
  return host ? createPortal(ribbon, host) : null;
}
