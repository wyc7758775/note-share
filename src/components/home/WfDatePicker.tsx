// 官方 Choose date 弹层的共享本体（Type date 输入 + Today/Tomorrow/Next week 快捷 + 月历网格，
// 月/年可下钻）。ribbon 的 DatePickOverlay 与日期 chip 的弹出层共用同一份 UI，
// 差异只在 onPick 的动作（前者建/跳日期条目，后者给 chip 改期）。
import { useEffect, useRef, useState } from "react";

const WD_SUN = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]; // 选择器网格 Su 起头
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Chevron({ dir }: { dir: -1 | 1 }) {
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

/** 解析 "Type date" 输入（官方：自然语言 + 常见日期写法），失败返回 null */
export function parseDateInput(raw: string, today: Date): Date | null {
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

export function WfDatePicker({
  today,
  initial,
  onPick,
  onClose,
}: {
  today: Date;
  /** 初始定位月份（chip 弹层 = chip 当前日期的月份） */
  initial?: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
}) {
  const start = initial ?? today;
  const [view, setView] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
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
    const startD = new Date(first.getTime() - lead * 86400000);
    for (let i = 0; i < 42; i++) {
      const d = new Date(startD.getTime() + i * 86400000);
      grid.push({ d, inMonth: d.getMonth() === view.getMonth() });
    }
  }
  const todayK = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  // chip 弹层才标当前日期（ribbon 打开时不传 initial，行为同旧版）
  const curK = initial
    ? `${initial.getFullYear()}-${initial.getMonth()}-${initial.getDate()}`
    : null;

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
            if (d) onPick(d);
          }
        }}
      />
      <div className="wf-picker-quick">
        <button onClick={() => onPick(today)}>Today</button>
        <button onClick={() => onPick(new Date(today.getTime() + 86400000))}>Tomorrow</button>
        <button onClick={() => onPick(new Date(today.getTime() + 7 * 86400000))}>Next week</button>
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
              const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              return (
                <button
                  key={k}
                  className={`${inMonth ? "" : "is-out"}${k === todayK ? " is-today" : ""}${
                    k === curK ? " is-cur" : ""
                  }`}
                  onClick={() => onPick(d)}
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
