import { Fragment, Suspense, lazy, useCallback, useEffect, useState } from "react";
import { backend } from "./backend";
import { useSettings } from "./i18n";
import { DomainProvider, useDomain, useWorkspaceVersion } from "./domain/provider";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import EmptyState from "./components/EmptyState";
import SettingsModal from "./components/SettingsModal";
import { EDIT_SCENE_EVENT } from "./components/ExcalidrawBlock";
import { OPEN_NOTE_EVENT } from "./components/WikiLink";
import { I } from "./components/icons";

// 没打开笔记时点击手绘文件：主区直接显示画板编辑面板
const ScenePanelStandalone = lazy(() => import("./components/ExcalidrawPanel"));

export default function App() {
  const { t } = useSettings();
  const { workspace, bus, directory } = useDomain();
  useWorkspaceVersion(); // 分栏布局变化触发重渲染
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [tree, setTree] = useState<import("./backend").TreeNode[]>([]);
  const [sceneView, setSceneView] = useState<string | null>(null);

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

  const openNote = useCallback(
    (path: string, opts?: { viaHistory?: boolean; newPane?: boolean }) => {
      if (opts?.newPane) workspace.openInNewPane(path);
      else workspace.openInActive(path);
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
        workspace.openInActive(h.stack[i]); // 返回/前进作用于活动栏
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
          workspace.relocate(e.from, e.to); // 栏内路径跟随
          setHistory((h) => ({ ...h, stack: h.stack.map((p) => (p === e.from ? e.to : p)) }));
        } else if (e.type === "noteTrashed") {
          workspace.clearPath(e.path); // 持有它的栏清空
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

  // 没打开笔记时点击手绘文件 → 主区显示独立画板面板
  useEffect(() => {
    const onEdit = (e: Event) => {
      if (workspace.all.some((p) => p.path)) return; // 有栏开着笔记时由 Editor 接管
      setSceneView((e as CustomEvent<string>).detail);
    };
    window.addEventListener(EDIT_SCENE_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_SCENE_EVENT, onEdit);
  }, [workspace]);

  // 双链点击跳转（阅读链路，进历史；Ctrl+点击开新栏）
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; newPane?: boolean }>).detail;
      openNote(d.path, { viaHistory: true, newPane: d.newPane });
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

  const activePane = workspace.active;
  const canBack = history.index > 0;
  const canForward = history.index < history.stack.length - 1;

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
            currentPath={activePane.path}
            width={sideWidth}
            onOpenNote={(path, opts) => openNote(path, opts)}
            onTreeChanged={refreshTree}
            onPickVault={pickVault}
            canPickVault={backend.mode === "tauri"}
            onResize={setSideWidth}
            onOpenSettings={() => setSettingsOpen(true)}
            canBack={canBack}
            canForward={canForward}
            onBack={() => jumpHistory(-1)}
            onForward={() => jumpHistory(1)}
            onToggleSidebar={() => setSideCollapsed((v) => !v)}
          />
        </div>
        <main className="flex min-w-0 flex-1 overflow-hidden">
          {sceneView !== null ? (
            <div className="view-swap h-full w-full">
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center text-sm text-faint">
                    {t("sceneLoading")}
                  </div>
                }
              >
                <ScenePanelStandalone
                  src={sceneView}
                  onBack={() => setSceneView(null)}
                  backLabel={t("close")}
                  onSaved={() => {}}
                />
              </Suspense>
            </div>
          ) : vaultName === null ? (
            <div className="view-swap flex h-full w-full flex-col items-center justify-center gap-4 text-soft">
              <div className="serif text-2xl text-ink">NoteShare</div>
              <p className="text-sm">{t("noVaultHint")}</p>
              <button className="btn-primary" onClick={pickVault}>
                {t("pickVaultBtn")}
              </button>
            </div>
          ) : (
            <div className="relative flex h-full min-w-0 w-full">
              {sideCollapsed && (
                <button
                  className="side-toggle-float"
                  data-tip={t("expandSidebar")}
                  onClick={() => setSideCollapsed(false)}
                >
                  {I.panelLeft}
                </button>
              )}
              {workspace.all.map((pane, idx) => {
                const isActive = pane.id === activePane.id;
                const prev = workspace.all[idx - 1];
                return (
                  <Fragment key={pane.id}>
                    {idx > 0 && (
                      <div
                        className="pane-resizer"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          const startX = e.clientX;
                          const leftEl = (e.currentTarget as HTMLElement)
                            .previousElementSibling as HTMLElement;
                          const rightEl = (e.currentTarget as HTMLElement)
                            .nextElementSibling as HTMLElement;
                          const startL = leftEl.getBoundingClientRect().width;
                          const startR = rightEl.getBoundingClientRect().width;
                          document.body.classList.add("resizing");
                          const move = (ev: PointerEvent) => {
                            const dx = ev.clientX - startX;
                            workspace.setSize(prev.id, startL + dx);
                            workspace.setSize(pane.id, startR - dx);
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
                    <section
                      className={`pane-col ${isActive ? "pane-col-active" : ""}`}
                      style={pane.width ? { flex: `0 0 ${pane.width}px` } : undefined}
                      onPointerDown={() => workspace.focus(pane.id)}
                    >
                    {pane.path === null ? (
                      <div className="view-swap relative h-full">
                        <EmptyState
                          vaultName={vaultName}
                          onNewNote={async () => {
                            const path = await backend.createNote("", t("untitledNote"));
                            openNote(path);
                          }}
                        />
                      </div>
                    ) : (
                      <Editor
                        key={`${pane.id}:${pane.path}`}
                        initialPath={pane.path}
                        active={isActive}
                        closable={workspace.all.length > 1}
                        onClose={() => workspace.close(pane.id)}
                      />
                    )}
                  </section>
                  </Fragment>
                );
              })}
            </div>
          )}
        </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
