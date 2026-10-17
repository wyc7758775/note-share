// 栏内标签条：一栏可叠多个标签（笔记/画板），点击切换、中键或 × 关闭、
// 拖拽重排/拖到其他栏换位置、+ 在当前标签所在文件夹新建笔记并开新标签。
// 笔记操作菜单（⋯）在编辑器左上角的悬浮导航组里，与前进后退同行；
// 关栏没有按钮（拖拽拆分自由布局，关掉全部标签即得空栏）。
// 只调领域服务（Workspace / NoteService），布局渲染由 PaneView 负责。
import { useRef, useState } from "react";
import { useDomain, useWorkspaceVersion } from "../domain/provider";
import { useSettings } from "../i18n";
import { HOME_PATH } from "../outline/store";
import { NODE_MIME } from "./home/outlineKit";
import type { Pane } from "../domain/workspace";
import WindowControls, { SHOW_WINDOW_CONTROLS } from "./WindowControls";
import { I } from "./icons";

/** 标签拖拽的 dataTransfer 类型（栏内重排、跨栏移动与拆分落区共用） */
export const TAB_MIME = "application/x-noteshare-tab";

interface Props {
  pane: Pane;
  /** 是否为活动栏（活动栏标签条配色更亮） */
  active: boolean;
  /** 视觉右上角的栏：标签条右端挂自绘窗口按钮（无原生标题栏时） */
  titleEdge?: boolean;
  /** 右端 ＋：新建笔记（落在活动标签所在文件夹，参数为空 = 库根目录） */
  onNewNote: (folder: string) => void;
}

function tabLabel(path: string): string {
  if (path === HOME_PATH) return "Workflowy"; // 固定入口显示名（存储路径仍是 Home.md）
  return path.split("/").pop()?.replace(/\.(md|excalidraw|canvas)$/i, "") ?? "";
}

export default function PaneTabs({ pane, active, titleEdge, onNewNote }: Props) {
  const { t } = useSettings();
  const { workspace } = useDomain();
  useWorkspaceVersion(); // 标签增删/切换/激活跟随工作台版本

  // 本栏内正被拖拽的标签 id（淡化显示）；dropIndex = 落点指示线的插入位置
  const [dragTabId, setDragTabId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // 指示线横坐标（隐藏时保留原位，下次出现从原位滑入而不是从条首飞过来）
  const [lineX, setLineX] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  // 外部拖拽（节点/文件）悬停标签时的自动切换计时（拖走即取消）
  const hoverSwitchRef = useRef<{ tabId: number | null; timer: number }>({
    tabId: null,
    timer: 0,
  });

  /** 指示线 x：插到 index 前摆在它与前一标签的缝隙里，末尾追加摆在最后标签右侧；首端钳进条内，否则超出滚动原点被 overflow 裁掉看不见 */
  const lineXAt = (index: number): number => {
    const tabs = stripRef.current?.querySelectorAll<HTMLElement>(".tab-item") ?? [];
    if (tabs.length === 0) return 2;
    if (index >= tabs.length) {
      const last = tabs[tabs.length - 1];
      return last.offsetLeft + last.offsetWidth + 1;
    }
    return Math.max(tabs[index].offsetLeft - 1, 1);
  };

  const showDrop = (index: number) => {
    setDropIndex(index);
    setLineX(lineXAt(index));
  };

  /** 根据鼠标位置算插入位置：经过标签左半插它前面，右半插后面 */
  const indexAt = (e: React.DragEvent, el: HTMLElement): number => {
    const r = el.getBoundingClientRect();
    const tabs = stripRef.current?.querySelectorAll(".tab-item") ?? [];
    let i = 0;
    tabs.forEach((n) => {
      if (n === el) return;
      if (n.getBoundingClientRect().left < r.left) i++;
    });
    return i + (e.clientX > r.left + r.width / 2 ? 1 : 0);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 不下传给栏容器（那是拆分落区）
    const index = dropIndex ?? pane.tabs.length;
    setDropIndex(null);
    setDragTabId(null);
    const raw = e.dataTransfer.getData(TAB_MIME);
    if (!raw) return;
    try {
      const { paneId, tabId } = JSON.parse(raw) as { paneId: number; tabId: number };
      if (paneId === pane.id) {
        const fromIdx = pane.tabs.findIndex((tb) => tb.id === tabId);
        if (fromIdx < 0) return;
        workspace.moveTab(paneId, tabId, pane.id, fromIdx < index ? index - 1 : index);
      } else {
        workspace.moveTab(paneId, tabId, pane.id, index);
      }
    } catch {
      /* 非法数据忽略 */
    }
  };

  return (
    // 标签条即顶栏：空白处（条自身与内边距，不含任何子元素）可拖动窗口 / 双击最大化
    <div className={`tab-bar ${active ? "tab-bar-active" : ""}`} data-tauri-drag-region>
      <div
        ref={stripRef}
        className="tab-strip"
        data-tauri-drag-region
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          // 经过标签条空白（非任何标签）= 追加到末尾
          if (!(e.target as HTMLElement).closest(".tab-item")) showDrop(pane.tabs.length);
        }}
        onDragLeave={(e) => {
          if (!stripRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
        onDrop={handleDrop}
        // 纵向滚轮转横向滚动（标签条只有横向溢出；触控板的 deltaX 也一并累计）
        onWheel={(e) => {
          const el = stripRef.current;
          if (!el) return;
          const delta = e.deltaY || e.deltaX;
          if (delta && el.scrollWidth > el.clientWidth) el.scrollLeft += delta;
        }}
      >
        {pane.tabs.map((tab, idx) => {
          const on = tab.id === pane.activeTabId;
          const isScene = /\.excalidraw$/i.test(tab.path);
          const isCanvas = /\.canvas$/i.test(tab.path);
          const isPdf = /\.pdf$/i.test(tab.path);
          const isHome = tab.path === HOME_PATH;
          // 凹角只画在有邻居的一侧：首/末标签贴边时白底直接顶到栏缘，无需过渡
          const hasLeft = idx > 0;
          const hasRight = idx < pane.tabs.length - 1;
          return (
            <div
              key={tab.id}
              className={[
                "tab-item",
                on ? "tab-item-on" : "",
                dragTabId === tab.id ? "tab-item-drag" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={tab.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_MIME, JSON.stringify({ paneId: pane.id, tabId: tab.id }));
                e.dataTransfer.effectAllowed = "move";
                setDragTabId(tab.id);
              }}
              onDragEnd={() => {
                setDragTabId(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(TAB_MIME)) {
                  e.preventDefault();
                  e.stopPropagation();
                  showDrop(indexAt(e, e.currentTarget as HTMLElement));
                  return;
                }
                // 拖着外部内容（Workflowy 节点 / 文件树条目）悬停标签：短暂停顿即切换过去，
                // 否则单栏双标签时拖拽永远到不了另一个标签的内容区
                if (
                  !e.dataTransfer.types.includes(NODE_MIME) &&
                  !e.dataTransfer.types.includes("application/x-noteshare-tree")
                )
                  return;
                e.preventDefault();
                if (on) return;
                if (hoverSwitchRef.current.tabId === tab.id) return;
                window.clearTimeout(hoverSwitchRef.current.timer);
                hoverSwitchRef.current = {
                  tabId: tab.id,
                  timer: window.setTimeout(() => {
                    hoverSwitchRef.current = { tabId: null, timer: 0 };
                    workspace.activateTab(pane.id, tab.id);
                  }, 320),
                };
              }}
              onDragLeave={() => {
                if (hoverSwitchRef.current.tabId === tab.id) {
                  window.clearTimeout(hoverSwitchRef.current.timer);
                  hoverSwitchRef.current = { tabId: null, timer: 0 };
                }
              }}
              onDrop={handleDrop}
              onClick={() => workspace.activateTab(pane.id, tab.id)}
              onMouseDown={(e) => {
                // 中键按下即关（preventDefault 压掉 Windows 自动滚动手势，auxclick 就不再来了）
                if (e.button !== 1) return;
                e.preventDefault();
                workspace.closeTab(pane.id, tab.id);
              }}
            >
              {/* 激活标签的底部外圆角：内联 SVG 直切斜边 + 轻微软化
                  （Obsidian 实测剖面 ≈ 45° 直切，仅 1px 弧度）。fillet-l 在左、fillet-r 镜像。 */}
              {on && (
                <svg className="tab-fillet tab-fillet-l" width="5.5" height="5.5" viewBox="0 0 5.5 5.5" aria-hidden>
                  <path d="M5.5 0 Q1.7 1.7 0 5.5 L5.5 5.5 Z" fill="var(--paper)" />
                </svg>
              )}
              {on && (
                <svg className="tab-fillet tab-fillet-r" width="5.5" height="5.5" viewBox="0 0 5.5 5.5" aria-hidden>
                  <path d="M0 0 Q3.8 1.7 5.5 5.5 L0 5.5 Z" fill="var(--paper)" />
                </svg>
              )}
              <span className={`tab-ico ${isScene ? "tab-ico-scene" : ""}`}>
                {isHome
                  ? I.home
                  : isScene
                    ? I.pen
                    : isCanvas
                      ? I.canvas
                      : isPdf
                        ? I.pdf
                        : I.note}
              </span>
              <span className="tab-label">{tabLabel(tab.path)}</span>
              <button
                className="tab-close"
                data-tip={t("closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  workspace.closeTab(pane.id, tab.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        {/* 落点指示线：常驻单节点，显隐淡入淡出、换位平移滑动（挂在标签上的伪元素之间无法过渡） */}
        <div
          className={`tab-drop-line${dropIndex !== null ? " on" : ""}`}
          style={{ transform: `translateX(${lineX}px)` }}
        />
      </div>
      {/* 右端：分隔线 + 新建笔记（与标签条之间留出拖拽落区空白的观感一致） */}
      <button
        className="tab-new"
        data-tip={t("newNote")}
        onClick={() => {
          const cur = pane.tabs.find((tb) => tb.id === pane.activeTabId) ?? pane.tabs[pane.tabs.length - 1];
          const p = cur?.path;
          const folder =
            p && p !== HOME_PATH && /\.md$/i.test(p) && p.includes("/")
              ? p.slice(0, p.lastIndexOf("/"))
              : "";
          onNewNote(folder);
        }}
      >
        +
      </button>
      {titleEdge && SHOW_WINDOW_CONTROLS && <WindowControls />}
    </div>
  );
}
