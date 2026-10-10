// 栏内标签条：一栏可叠多个标签（笔记/画板），点击切换、中键或 × 关闭、
// 拖拽重排/拖到其他栏换位置、+ 在当前标签所在文件夹新建笔记并开新标签。
// 行尾：⋯（当前标签的锁定/发布/删除）、✕ 关栏（多栏时）。
// 只调领域服务（Workspace / SessionBook / NoteService），布局渲染由 PaneView 负责。
import { useEffect, useRef, useState } from "react";
import { useDomain, useWorkspaceVersion } from "../domain/provider";
import { useSettings } from "../i18n";
import type { Pane } from "../domain/workspace";
import { showContextMenu } from "./ContextMenu";
import { I } from "./icons";

/** 标签拖拽的 dataTransfer 类型（栏内重排、跨栏移动与拆分落区共用） */
export const TAB_MIME = "application/x-noteshare-tab";

/** 快捷键修饰键的显示名（苹果设备是 Command；与 Editor 保持一致） */
const MOD_KEY = /mac|iphone|ipad|ipod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ?? ""
)
  ? "⌘"
  : "Ctrl+";

interface Props {
  pane: Pane;
  /** 是否为活动栏（活动栏标签条配色更亮） */
  active: boolean;
}

function tabLabel(path: string): string {
  return path.split("/").pop()?.replace(/\.(md|excalidraw)$/i, "") ?? "";
}

export default function PaneTabs({ pane, active }: Props) {
  const { t } = useSettings();
  const { workspace, notes: noteService, sessions, bus } = useDomain();
  useWorkspaceVersion(); // 标签增删/切换/激活跟随工作台版本

  // 本栏内正被拖拽的标签 id（淡化显示）；dropHint = 落点指示线的插入位置
  const [dragTabId, setDragTabId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [, setLockTick] = useState(0); // lockToggled 事件驱动菜单文案刷新
  const stripRef = useRef<HTMLDivElement>(null);

  const activeTab = pane.tabs.find((tb) => tb.id === pane.activeTabId) ?? null;
  const multiPane = workspace.paneList.length > 1;

  // 锁定状态变化（快捷键或菜单触发）时刷新，菜单文案跟随
  useEffect(() => {
    return bus.on("lockToggled", () => setLockTick((v) => v + 1));
  }, [bus]);

  const newNote = async () => {
    const cur = activeTab;
    const folder = cur ? cur.path.split("/").slice(0, -1).join("/") : "";
    const path = await noteService.create(t("untitledNote"), folder);
    if (path) workspace.open(path, "newTab");
  };

  /** 当前标签的操作菜单（锁定 / 发布 / 删除） */
  const openTabMenu = (e: React.MouseEvent) => {
    if (!activeTab) return;
    const path = activeTab.path;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const locked = sessions.mode(path) === "locked";
    showContextMenu(Math.round(r.left), Math.round(r.bottom + 6), [
      {
        label: locked ? t("unlockEdit", { mod: `${MOD_KEY}E` }) : t("lockReading", { mod: `${MOD_KEY}E` }),
        icon: locked ? I.unlock : I.lock,
        onClick: () => {
          bus.emit({ type: "saveRequested" }); // 锁定前先保存当前编辑
          sessions.toggle(path);
        },
      },
      { separator: true },
      {
        label: t("publishExportMenu"),
        onClick: () => {
          window.dispatchEvent(new CustomEvent("noteshare:open-publish", { detail: path }));
        },
      },
      { separator: true },
      {
        label: t("deleteNote"),
        danger: true,
        onClick: () => {
          showContextMenu(Math.round(r.left), Math.round(r.bottom + 6), [
            {
              label: t("confirmTrash"),
              danger: true,
              onClick: () => void noteService.trash(path),
            },
            { label: t("cancel") },
          ]);
        },
      },
    ]);
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
    <div className={`tab-bar ${active ? "tab-bar-active" : ""}`}>
      <div
        ref={stripRef}
        className="tab-strip"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TAB_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          // 经过标签条空白（非任何标签）= 追加到末尾
          if (!(e.target as HTMLElement).closest(".tab-item")) setDropIndex(pane.tabs.length);
        }}
        onDragLeave={(e) => {
          if (!stripRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
        onDrop={handleDrop}
      >
        {pane.tabs.map((tab) => {
          const on = tab.id === pane.activeTabId;
          const isScene = /\.excalidraw$/i.test(tab.path);
          const i = pane.tabs.indexOf(tab);
          return (
            <div
              key={tab.id}
              className={[
                "tab-item",
                on ? "tab-item-on" : "",
                dragTabId === tab.id ? "tab-item-drag" : "",
                dropIndex === i ? "tab-item-drop tab-item-drop-before" : "",
                dropIndex === i + 1 && i === pane.tabs.length - 1
                  ? "tab-item-drop tab-item-drop-after"
                  : "",
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
                if (!e.dataTransfer.types.includes(TAB_MIME)) return;
                e.preventDefault();
                e.stopPropagation();
                setDropIndex(indexAt(e, e.currentTarget as HTMLElement));
              }}
              onDrop={handleDrop}
              onClick={() => workspace.activateTab(pane.id, tab.id)}
              onAuxClick={(e) => {
                if (e.button !== 1) return; // 中键关闭（Obsidian 同款）
                e.preventDefault();
                workspace.closeTab(pane.id, tab.id);
              }}
            >
              <span className={`tab-ico ${isScene ? "tab-ico-scene" : ""}`}>
                {isScene ? I.pen : I.note}
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
        <button
          className="tab-new"
          data-tip={t("newTabNote")}
          onClick={() => void newNote()}
        >
          {I.plus}
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        {activeTab && (
          <button className="tab-more" data-tip={t("more")} onClick={openTabMenu}>
            {I.more}
          </button>
        )}
        {multiPane && (
          <button
            className="tab-pane-close"
            data-tip={t("closePane")}
            onClick={() => workspace.close(pane.id)}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
