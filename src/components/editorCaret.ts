// 自定义光标 hook：粗圆角短条（粗细/长短/颜色可调），替代系统细光标。
// - 外观来自偏好域（caretWidth / caretRatio / caretColor）
// - 打字机模式：光标始终保持在滚动视口垂直居中（typewriter）
// - 大跳动画：跨行长距离移动时，光标沿缓动曲线飞向新位置（caretAnimate）
// 用法：const { caret, wrapRef } = useCustomCaret(editor, locked)
//       wrapRef 挂到正文包裹层；caret 非空时渲染 <div className="caret-custom" style={…} />。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSettings } from "../i18n";

export interface CaretBox {
  top: number;
  left: number;
  width: number;
  height: number;
  color: string;
  /** CSS transition（空串 = 不平滑，打字时即时跟随） */
  transition: string;
}

/** 找最近的可滚动祖先（打字机模式居中用） */
function nearestScroller(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    n = n.parentElement;
  }
  return null;
}

export function useCustomCaret(editor: Editor | null, locked: boolean) {
  const { caretWidth, caretRatio, caretColor, typewriter, caretAnimate } = useSettings();
  const wrapRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<{ top: number; left: number } | null>(null);
  const blinkTimer = useRef<number>(0);
  const [caret, setCaret] = useState<CaretBox | null>(null);
  // 移动/打字期间常亮（否则按住方向键时正好处于闪烁的隐藏相位、看起来“消失”），停手 500ms 后恢复闪烁
  const [solid, setSolid] = useState(false);

  const updateCaret = useCallback(() => {
    const view = editor?.view;
    if (!view || locked || !view.hasFocus()) {
      setCaret(null);
      prevRef.current = null;
      return;
    }
    const { from, to } = view.state.selection;
    if (from !== to) {
      setCaret(null);
      prevRef.current = null;
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) {
      setCaret(null);
      return;
    }
    const c = view.coordsAtPos(from);
    const wr = wrap.getBoundingClientRect();
    const lineH = c.bottom - c.top;
    const h = Math.max(6, Math.round(lineH * caretRatio)); // 长短可调（默认 85% 行高）
    const top = c.top - wr.top + (lineH - h) / 2;

    // coordsAtPos 的几何：后面有字时 c.left = 下一个字的左边缘（即插入缝隙）；
    // 行尾无字时 c.left = 上一个字的右边缘（真正的行尾空白起点）。
    // 因此「居中在缝隙」和「行尾向右让 1px」要分开处理，否则会压到下一字。
    const doc = view.state.doc;
    const nextChar = from < doc.content.size ? doc.textBetween(from, from + 1) : "";
    const beforeChar = nextChar && !/\s/.test(nextChar); // 后面紧跟字母/文字
    const width = beforeChar ? Math.min(caretWidth, 2) : caretWidth; // 有字改细，行尾保持偏好粗细
    const left = beforeChar
      ? c.left - wr.left - width / 2 // 居中在插入缝隙，不贴下一字
      : c.left - wr.left + 1; // 行尾：向右让 1px，粗条落在空白里

    // 大跳动画：垂直超过 1.5 行或水平超过 240px 才平滑飞过去；打字/微移保持即时
    // 宽度变化始终加过渡，粗↔细平滑变形而不是硬切
    let transition = "width 140ms ease";
    const prev = prevRef.current;
    if (caretAnimate && prev) {
      const dx = Math.abs(left - prev.left);
      const dy = Math.abs(top - prev.top);
      if (dy > lineH * 1.5 || dx > 240) {
        const dur = Math.min(320, Math.max(140, Math.round(Math.hypot(dx, dy) / 6)));
        const ease = "cubic-bezier(.22,.61,.36,1)";
        transition = `width 140ms ease, top ${dur}ms ${ease}, left ${dur}ms ${ease}`;
      }
    }
    prevRef.current = { top, left };

    // 打字机模式：把当前行拉到视口垂直居中（选区定位后调整滚动）
    if (typewriter) {
      const sc = nearestScroller(wrap);
      if (sc) {
        const mid = sc.getBoundingClientRect().top + sc.clientHeight / 2;
        const delta = c.top + lineH / 2 - mid;
        if (Math.abs(delta) > lineH * 0.6) sc.scrollTop += delta;
      }
    }

    const color =
      caretColor === "accent" ? "var(--accent)" : caretColor === "ink" ? "var(--ink)" : caretColor;
    setCaret({ top, left, width, height: h, color, transition });

    // 移动/打字期间保持常亮，停手 500ms 后恢复闪烁
    setSolid(true);
    window.clearTimeout(blinkTimer.current);
    blinkTimer.current = window.setTimeout(() => setSolid(false), 500);
  }, [editor, locked, caretWidth, caretRatio, caretColor, typewriter, caretAnimate]);

  useEffect(() => {
    if (!editor) return;
    const evs = ["selectionUpdate", "focus", "blur", "update"] as const;
    evs.forEach((ev) => editor.on(ev, updateCaret));
    window.addEventListener("resize", updateCaret);
    return () => {
      evs.forEach((ev) => editor.off(ev, updateCaret));
      window.removeEventListener("resize", updateCaret);
    };
  }, [editor, updateCaret]);

  return { caret, wrapRef, updateCaret, solid };
}
