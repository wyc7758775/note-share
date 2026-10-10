// 栏视图：标签条 + 内容（笔记/画板/图片/欢迎页）+ 拖拽落区。
// 拖标签悬停到栏上时按鼠标位置判定落区（四边 25% 条带 = 拆分新栏，中央 = 加入
// 标签列表），半透明高亮预览——与 Obsidian 的拖拽分栏一致；拖到标签条上则由
// 标签条自己处理（插入到指定位置），不进入这里的判定。
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { Pane, DropZone } from "../domain/workspace";
import { useDomain } from "../domain/provider";
import { useSettings } from "../i18n";
import { backend } from "../backend";
import PaneTabs, { TAB_MIME } from "./PaneTabs";
import Editor from "./Editor";
import EmptyState from "./EmptyState";
import { emitViewImage } from "./ExcalidrawBlock";

const ScenePanel = lazy(() => import("./ExcalidrawPanel"));

/** 标签可承载的图片附件 */
const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** 靠边多宽的比例内算"边缘落区"（拆分），其余为中央（加入标签） */
const EDGE = 0.25;

interface Props {
  pane: Pane;
  active: boolean;
  vaultName: string | null;
  /** 欢迎页"新建笔记" */
  onNewNote: () => void;
  /** 画板保存后刷新文件树 */
  onSceneSaved: () => void;
  /** 阅读历史导航（悬浮在笔记左上角） */
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

function zoneOf(clientX: number, clientY: number, rect: DOMRect): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (y < EDGE) return "top";
  if (y > 1 - EDGE) return "bottom";
  if (x < EDGE) return "left";
  if (x > 1 - EDGE) return "right";
  return "center";
}

/** 落区高亮块的几何（相对落区层的百分比） */
function zoneRect(zone: DropZone): React.CSSProperties {
  switch (zone) {
    case "left":
      return { left: 0, top: 0, bottom: 0, width: "33%" };
    case "right":
      return { right: 0, top: 0, bottom: 0, width: "33%" };
    case "top":
      return { left: 0, right: 0, top: 0, height: "33%" };
    case "bottom":
      return { left: 0, right: 0, bottom: 0, height: "33%" };
    default:
      return { left: "25%", top: "25%", width: "50%", height: "50%" };
  }
}

export default function PaneView({
  pane,
  active,
  vaultName,
  onNewNote,
  onSceneSaved,
  canBack,
  canForward,
  onBack,
  onForward,
}: Props) {
  const { t } = useSettings();
  const { workspace } = useDomain();
  const [zone, setZone] = useState<DropZone | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const activeTab =
    pane.tabs.find((tb) => tb.id === pane.activeTabId) ?? pane.tabs[pane.tabs.length - 1] ?? null;

  /** 事件目标在标签条内（那儿的插入逻辑由标签条自己处理，不进落区判定） */
  const inTabBar = (e: React.DragEvent) =>
    !!(e.target as HTMLElement).closest?.(".tab-bar");

  // 拖拽判定走捕获阶段：先于子元素（Excalidraw 画布会 stopPropagation 吞掉
  // 冒泡的 dragover/drop，否则画板栏上高亮和拆分全部失效）
  const handleDragOverZone = (e: React.DragEvent) => {
    if (inTabBar(e)) {
      setZone(null); // 悬停到标签条上：清掉内容区高亮，由标签条显示插入线
      return;
    }
    if (!e.dataTransfer.types.includes(TAB_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const host = hostRef.current;
    if (host) setZone(zoneOf(e.clientX, e.clientY, host.getBoundingClientRect()));
  };

  const handleDropZone = (e: React.DragEvent) => {
    if (inTabBar(e)) return; // 标签条上的 drop 交给标签条（插入到指定位置）
    e.preventDefault();
    e.stopPropagation();
    const z = zone ?? "center";
    setZone(null);
    const raw = e.dataTransfer.getData(TAB_MIME);
    if (!raw) return;
    try {
      const { paneId: fromPane, tabId } = JSON.parse(raw) as { paneId: number; tabId: number };
      if (z === "center") {
        workspace.moveTab(fromPane, tabId, pane.id, pane.tabs.length);
      } else {
        const newPaneId = workspace.splitPane(pane.id, z);
        workspace.moveTab(fromPane, tabId, newPaneId, 0);
      }
    } catch {
      /* 非法数据忽略 */
    }
  };

  return (
    <div
      ref={hostRef}
      className={`pane-col ${active ? "pane-col-active" : ""}`}
      onPointerDown={() => workspace.focus(pane.id)}
      onDragOverCapture={handleDragOverZone}
      onDragLeave={(e) => {
        if (!hostRef.current?.contains(e.relatedTarget as Node)) setZone(null);
      }}
      onDropCapture={handleDropZone}
    >
      <PaneTabs pane={pane} active={active} />

      {activeTab === null ? (
        <div className="view-swap relative min-h-0 flex-1">
          <EmptyState vaultName={vaultName ?? ""} onNewNote={onNewNote} />
        </div>
      ) : /\.excalidraw$/i.test(activeTab.path) ? (
        <div className="view-swap min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                {t("sceneLoading")}
              </div>
            }
          >
            <ScenePanel
              key={`${pane.id}:${activeTab.path}`}
              src={activeTab.path}
              onSaved={onSceneSaved}
              onClose={() => workspace.closeTab(pane.id, activeTab.id)}
            />
          </Suspense>
        </div>
      ) : IMG_RE.test(activeTab.path) ? (
        <div className="view-swap min-h-0 flex-1">
          <ImagePane key={`${pane.id}:${activeTab.path}`} src={activeTab.path} />
        </div>
      ) : (
        <Editor
          key={`${pane.id}:${activeTab.path}`}
          initialPath={activeTab.path}
          active={active}
          canBack={canBack}
          canForward={canForward}
          onBack={onBack}
          onForward={onForward}
        />
      )}

      {/* 拖拽落区高亮（覆盖标签条下方的内容区，半透明色块不拦截事件） */}
      {zone && (
        <div className="pane-drop-layer">
          <div className="pane-drop-hint" style={zoneRect(zone)} />
        </div>
      )}
    </div>
  );
}

/** 图片标签视图：附件以标签打开时的居中预览，双击用阅览器看大图 */
function ImagePane({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const { base64, mime } = await backend.readAssetBase64(src);
        if (!dead) setUrl(`data:${mime};base64,${base64}`);
      } catch {
        if (!dead) setUrl(src); // 外链等读不到就退回原始路径
      }
    })();
    return () => {
      dead = true;
    };
  }, [src]);
  return (
    <div className="img-tab">
      {url ? (
        <img
          src={url}
          alt={src.split("/").pop() ?? ""}
          onClick={() => emitViewImage(url)}
        />
      ) : (
        <span className="text-sm text-faint">…</span>
      )}
    </div>
  );
}
