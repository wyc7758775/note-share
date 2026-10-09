// 自定义右键菜单：命令式的单例菜单（showContextMenu 在光标处弹出）
// 全应用已屏蔽原生 contextmenu，由各区域自行调用本模块构造菜单项。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export interface CtxMenuItem {
  label?: string;
  separator?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** 前置勾选位（用于加粗/斜体等开关态） */
  checked?: boolean;
  /** 前置图标（与勾选位互斥使用） */
  icon?: ReactNode;
  onClick?: () => void;
}

let current: { destroy: () => void } | null = null;

export function hideContextMenu() {
  current?.destroy();
}

export function showContextMenu(x: number, y: number, items: CtxMenuItem[]) {
  current?.destroy();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const onDoc = (e: Event) => {
    if (e.type === "mousedown" && container.contains(e.target as Node)) return;
    destroy();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") destroy();
  };
  const destroy = () => {
    window.removeEventListener("mousedown", onDoc, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onDoc, true);
    window.removeEventListener("resize", onDoc);
    root.unmount();
    container.remove();
    if (current && current.destroy === destroy) current = null;
  };
  window.addEventListener("mousedown", onDoc, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onDoc, true);
  window.addEventListener("resize", onDoc);

  current = { destroy };
  root.render(<Menu x={x} y={y} items={items} close={destroy} />);
}

function Menu({
  x,
  y,
  items,
  close,
}: {
  x: number;
  y: number;
  items: CtxMenuItem[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item ${it.danger ? "ctx-danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onClick?.();
            }}
          >
            <span className="ctx-check">
              {it.checked ? "✓" : it.icon ?? ""}
            </span>
            {it.label}
          </button>
        )
      )}
    </div>
  );
}
