// 栏内标签条：一栏可叠多个标签（笔记/画板），点击切换、中键或 × 关闭、
// 拖拽重排/拖到其他栏换位置、+ 在当前标签所在文件夹新建笔记并开新标签；
// 多栏时行尾提供关栏按钮。只调 Workspace（领域服务），布局渲染由 App 负责。
import { useRef, useState } from "react";
import { useDomain, useWorkspaceVersion } from "../domain/provider";
import { useSettings } from "../i18n";
import type { Pane } from "../domain/workspace";
import { I } from "./icons";

/** 标签拖拽的 dataTransfer 类型（栏内重排与跨栏移动共用） */
const TAB_MIME = "application/x-noteshare-tab";

interface Props {
  pane: Pane;
  /** 是否为活动栏（活动栏标签条配色更亮） */
  active: boolean;
  /** 多栏时显示关栏按钮 */
  multiPane: boolean;
  onClosePane: () => void;
}

function tabLabel(path: string): string {
  return path.split("/").pop()?.replace(/\.(md|excalidraw)$/i, "") ?? "";
}

export default function PaneTabs({ pane, active, multiPane, onClosePane }: Props) {
  const { t } = useSettings();
  const { workspace, notes: noteService } = useDomain();
  useWorkspaceVersion(); // 标签增删/切换/激活跟随工作台版本

  // 本栏内正被拖拽的标签 id（淡化显示）；dropHint = 落点指示线的插入位置
  const [dragTabId, setDragTabId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const newNote = async () => {
    const cur = pane.tabs.find((tb) => tb.id === pane.activeTabId);
    const folder = cur ? cur.path.split("/").slice(0, -1).join("/") : "";
    const path = await noteService.create(t("untitledNote"), folder);
    if (path) workspace.open(path, "newTab");
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
      {multiPane && (
        <button
          className="tab-pane-close"
          data-tip={t("closePane")}
          onClick={onClosePane}
        >
          ✕
        </button>
      )}
    </div>
  );
}
