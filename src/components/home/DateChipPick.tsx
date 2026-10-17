// 日期 chip（.wf-date-chip）点击弹出的官方同款选择器：
// 屏幕级单例 DOM 宿主 + React 渲染 WfDatePicker（OutlineTagSuggest 的浮层方案同款）。
// 选定后 setDayEntryDate 给条目改期并按 Calendar/年/月 归位。
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { WfDatePicker } from "./WfDatePicker";
import { setDayEntryDate } from "./outlineKit";

let hostEl: HTMLDivElement | null = null;
let hostRoot: Root | null = null;
let closeFn: (() => void) | null = null;

export function closeDateChipPicker() {
  closeFn?.();
}

function ensureHost(): { el: HTMLDivElement; root: Root } {
  let el = hostEl;
  let root = hostRoot;
  if (!el || !el.isConnected || !root) {
    el?.remove();
    el = document.createElement("div");
    el.className = "wf-date-pop";
    document.body.appendChild(el);
    root = createRoot(el);
    hostEl = el;
    hostRoot = root;
  }
  return { el, root };
}

export function openDateChipPicker(opts: {
  editor: Editor;
  itemPos: number;
  date: Date;
  anchor: DOMRect;
}) {
  const { editor, itemPos, date, anchor } = opts;
  const { el, root } = ensureHost();
  closeFn?.(); // 已开的先关（点到另一个 chip 时换目标）
  const close = () => {
    root.render(null);
    el.removeAttribute("data-show");
    closeFn = null;
  };
  closeFn = close;
  root.render(
    <WfDatePicker
      today={new Date()}
      initial={date}
      onPick={(d) => {
        setDayEntryDate(editor, itemPos, d);
        close();
      }}
      onClose={close}
    />
  );
  el.setAttribute("data-show", "1");
  // 定位：chip 下方左对齐；下方放不下翻到上方，水平夹回视口
  const POP_W = 252;
  const POP_H = 400;
  const GAP = 6;
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - POP_W - 8);
  let top = anchor.bottom + GAP;
  if (top + POP_H > window.innerHeight - 8) {
    top = Math.max(8, anchor.top - POP_H - GAP);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
