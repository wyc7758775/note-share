import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { backend } from "./backend";
import { useSettings } from "./i18n";
import { DomainProvider, useDomain, useWorkspaceVersion } from "./domain/provider";
import type { LayoutNode } from "./domain/workspace";
import Sidebar from "./components/Sidebar";
import PaneView from "./components/PaneView";
import SettingsModal from "./components/SettingsModal";
import { OPEN_NOTE_EVENT } from "./components/WikiLink";
import { EDIT_SCENE_EVENT } from "./components/ExcalidrawBlock";
import { I } from "./components/icons";

export default function App() {
  const { t } = useSettings();
  const { workspace, bus, directory } = useDomain();
  useWorkspaceVersion(); // 分栏/标签布局变化触发重渲染
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [tree, setTree] = useState<import("./backend").TreeNode[]>([]);

  // 侧栏宽度与收起（记忆到本地）
  const [sideWidth, setSideWidth] = useState(() => {
    const v = Number(localStorage.getItem("noteshare.sideWidth"));
    return Number.isFinite(v) && v >= 190 && v <= 480 ? v : 256;
  });
  const [sideCollapsed, setSideCollapsed] = useState(
    () => localStorage.getItem("noteshare.sideCollapsed") === "1"
  );
  useEffect(() => {
    localStorage.setItem("noteshare.sideWidth", String(sideWidth));
  }, [sideWidth]);
  useEffect(() => {
    localStorage.setItem("noteshare.sideCollapsed", sideCollapsed ? "1" : "0");
  }, [sideCollapsed]);

  // 笔记历史（MRU 去重栈）：双链跳转（阅读链路）进历史；树/搜索点击只切活动栏不动栈
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });

  // 打开笔记/画板：单击替换活动栏当前标签，Ctrl+点击当前栏新标签，Ctrl+Shift+点击在右侧拆新栏
  const openNote = useCallback(
    (path: string, opts?: { viaHistory?: boolean; newTab?: boolean; newPane?: boolean }) => {
      workspace.open(path, opts?.newPane ? "newPane" : opts?.newTab ? "newTab" : "replace");
      if (!opts?.viaHistory) return;
      setHistory((h) => {
        const stack = h.stack.filter((p) => p !== path); // MRU：移除旧位置
        return { stack: [...stack, path], index: stack.length };
      });
    },
    [workspace]
  );

  const jumpHistory = useCallback(
    (delta: 1 | -1) => {
      setHistory((h) => {
        const i = h.index + delta;
        if (i < 0 || i >= h.stack.length) return h;
        workspace.open(h.stack[i]); // 返回/前进作用于活动栏当前标签
        return { ...h, index: i };
      });
    },
    [workspace]
  );

  const refreshTree = useCallback(async () => {
    setTree(await backend.tree());
  }, []);

  // 领域装配：名录初始化；文件树/分栏跟随领域事件自动更新
  useEffect(() => {
    void directory.init();
  }, [directory]);
  useEffect(() => {
    const off = bus.on(
      ["noteCreated", "noteRenamed", "noteMoved", "assetMoved", "assetCreated", "noteTrashed"],
      (e) => {
        void refreshTree();
        if (e.type === "noteRenamed" || e.type === "noteMoved") {
          workspace.relocate(e.from, e.to); // 所有栏的标签路径跟随
          setHistory((h) => ({ ...h, stack: h.stack.map((p) => (p === e.from ? e.to : p)) }));
        } else if (e.type === "noteTrashed") {
          workspace.clearPath(e.path); // 持有它的标签关闭（相邻顶上）
        }
      }
    );
    return off;
  }, [bus, refreshTree, workspace]);

  useEffect(() => {
    (async () => {
      setVaultName(await backend.getVaultName());
      await refreshTree();
    })();
  }, [refreshTree]);

  // 屏蔽原生右键菜单（各区域用 showContextMenu 弹自绘菜单；Excalidraw 面板自带菜单，交给它）
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".excalidraw")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);

  // 打开画板编辑：统一进标签（detail = { path, newTab }），不进阅读历史
  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; newTab?: boolean }>).detail;
      workspace.open(d.path, d.newTab ? "newTab" : "replace");
    };
    window.addEventListener(EDIT_SCENE_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_SCENE_EVENT, onEdit);
  }, [workspace]);

  // 双链点击跳转（阅读链路，进历史；Ctrl+点击当前栏新标签，Ctrl+Shift+点击新栏）
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; newTab?: boolean; newPane?: boolean }>).detail;
      openNote(d.path, { viaHistory: true, newTab: d.newTab, newPane: d.newPane });
    };
    window.addEventListener(OPEN_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, onOpen);
  }, [openNote]);

  // 鼠标侧键（X1/X2）驱动笔记历史
  useEffect(() => {
    const onAux = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        jumpHistory(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        jumpHistory(1);
      }
    };
    window.addEventListener("mousedown", onAux);
    window.addEventListener("auxclick", onAux);
    return () => {
      window.removeEventListener("mousedown", onAux);
      window.removeEventListener("auxclick", onAux);
    };
  }, [jumpHistory]);

  const pickVault = async () => {
    const dir = await backend.pickVault();
    if (dir) {
      setVaultName(await backend.getVaultName());
      await refreshTree();
    }
  };

  const canBack = history.index > 0;
  const canForward = history.index < history.stack.length - 1;

  // ---- 布局树递归渲染：row = 左右并排，col = 上下堆叠，叶子是栏（标签组） ----
  const activePaneId = workspace.active.id;

  const renderLayout = (node: LayoutNode): ReactNode => {
    if (node.kind === "pane") {
      const pane = workspace.paneOf(node.paneId);
      if (!pane) return null;
      return (
        <PaneView
          key={pane.id}
          pane={pane}
          active={pane.id === activePaneId}
          vaultName={vaultName}
          onNewNote={async () => {
            const path = await backend.createNote("", t("untitledNote"));
            openNote(path);
          }}
          onSceneSaved={() => void refreshTree()}
          canBack={canBack}
          canForward={canForward}
          onBack={() => jumpHistory(-1)}
          onForward={() => jumpHistory(1)}
        />
      );
    }
    const row = node.kind === "row";
    return (
      <div key={node.id} className={row ? "layout-row" : "layout-col"}>
        {node.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && (
              <div
                className={`layout-resizer ${row ? "layout-resizer-col" : "layout-resizer-row"}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  const leftEl = (e.currentTarget as HTMLElement)
                    .previousElementSibling as HTMLElement;
                  const rightEl = (e.currentTarget as HTMLElement)
                    .nextElementSibling as HTMLElement;
                  const startA = row
                    ? leftEl.getBoundingClientRect().width
                    : leftEl.getBoundingClientRect().height;
                  const startB = row
                    ? rightEl.getBoundingClientRect().width
                    : rightEl.getBoundingClientRect().height;
                  document.body.classList.add("resizing");
                  const move = (ev: PointerEvent) => {
                    const axis = row ? "clientX" : "clientY";
                    const total = startA + startB;
                    const delta = ev[axis] - e[axis];
                    // 按像素比实时分配（flex-grow 归一化）
                    workspace.resize(node.id, i - 1, (startA + delta) / total);
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                    window.removeEventListener("pointercancel", up);
                    document.body.classList.remove("resizing");
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                  window.addEventListener("pointercancel", up);
                }}
              />
            )}
            <div className="layout-child" style={{ flexGrow: child.size, flexBasis: 0 }}>
              {renderLayout(child)}
            </div>
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full">
        {/* 侧栏外层做收起/展开的宽度动画；收起后隐藏内容防焦点进入 */}
        <div
          className="side-anim"
          style={{
            width: sideCollapsed ? 0 : sideWidth,
            visibility: sideCollapsed ? "hidden" : "visible",
          }}
          aria-hidden={sideCollapsed}
        >
          <Sidebar
            vaultName={vaultName}
            tree={tree}
            currentPath={workspace.activePath}
            width={sideWidth}
            onOpenNote={(path, opts) => openNote(path, opts)}
            onTreeChanged={refreshTree}
            onPickVault={pickVault}
            canPickVault={backend.mode === "tauri"}
            onResize={setSideWidth}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleSidebar={() => setSideCollapsed((v) => !v)}
          />
        </div>
        <main className={`relative flex min-w-0 flex-1 overflow-hidden ${sideCollapsed ? "sidebar-collapsed" : ""}`}>
          {vaultName === null ? (
            <div className="view-swap flex h-full w-full flex-col items-center justify-center gap-4 text-soft">
              <div className="serif text-2xl text-ink">NoteShare</div>
              <p className="text-sm">{t("noVaultHint")}</p>
              <button className="btn-primary" onClick={pickVault}>
                {t("pickVaultBtn")}
              </button>
            </div>
          ) : (
            <>
              {sideCollapsed && (
                <button
                  className="side-toggle-float"
                  data-tip={t("expandSidebar")}
                  onClick={() => setSideCollapsed(false)}
                >
                  {I.panelLeft}
                </button>
              )}
              <div className="flex h-full min-h-0 w-full flex-1">
                {renderLayout(workspace.layout)}
              </div>
            </>
          )}
        </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
