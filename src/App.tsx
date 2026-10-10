import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { backend, type TreeNode } from "./backend";
import { useSettings } from "./i18n";
import { createDomain, DomainProvider } from "./domain/provider";
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
  const domain = useMemo(() => createDomain(), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  // sessionKey：打开"另一篇"笔记时自增以重建编辑器；重命名当前笔记时不自增
  const [session, setSession] = useState<{ path: string; key: number } | null>(null);
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

  const refreshTree = useCallback(async () => {
    setTree(await backend.tree());
  }, []);

  // 领域装配：名录初始化；文件树订阅领域事件自动刷新（不再由各组件手动通知）
  useEffect(() => {
    void domain.directory.init();
  }, [domain]);
  useEffect(() => {
    const off = domain.bus.on(
      ["noteCreated", "noteRenamed", "noteMoved", "assetMoved", "noteTrashed"],
      () => {
        void refreshTree();
      }
    );
    return off;
  }, [domain, refreshTree]);

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

  // 没打开笔记时点击手绘文件 → 主区显示独立画板面板（有笔记打开时由 Editor 接管右侧面板）
  useEffect(() => {
    const onEdit = (e: Event) => {
      if (session) return;
      setSceneView((e as CustomEvent<string>).detail);
    };
    window.addEventListener(EDIT_SCENE_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_SCENE_EVENT, onEdit);
  }, [session]);

  // 笔记历史（MRU 去重栈）：只有"阅读链路"跳转（双链）进历史——
  // 文件树/搜索点击属于重新定位，不动栈；重复跳转去重后移到栈顶，A↔B 不会堆成 A B A B。
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });

  const openNote = (path: string, viaHistory = false) => {
    setSession((s) => (s && s.path === path ? s : { path, key: (s?.key ?? 0) + 1 }));
    if (!viaHistory) return;
    setHistory((h) => {
      const stack = h.stack.filter((p) => p !== path); // MRU：移除旧位置
      return { stack: [...stack, path], index: stack.length };
    });
  };

  const jumpHistory = (delta: 1 | -1) => {
    setHistory((h) => {
      const i = h.index + delta;
      if (i < 0 || i >= h.stack.length) return h;
      setSession({ path: h.stack[i], key: Date.now() });
      return { ...h, index: i };
    });
  };

  // 双链点击跳转（阅读链路，进历史）
  useEffect(() => {
    const onOpen = (e: Event) => openNote((e as CustomEvent<string>).detail, true);
    window.addEventListener(OPEN_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, onOpen);
  }, []);

  // 鼠标侧键（X1/X2 = button 3/4）驱动笔记历史：拦截浏览器的默认网页历史行为
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
    // auxclick 兜底：部分浏览器的历史导航在 auxclick 上触发
    window.addEventListener("mousedown", onAux);
    window.addEventListener("auxclick", onAux);
    return () => {
      window.removeEventListener("mousedown", onAux);
      window.removeEventListener("auxclick", onAux);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVault = async () => {
    const dir = await backend.pickVault();
    if (dir) {
      setVaultName(await backend.getVaultName());
      setSession(null);
      await refreshTree();
    }
  };

  const handleRenamed = async (newPath: string) => {
    setSession((s) => (s ? { ...s, path: newPath } : s));
    await refreshTree();
  };

  const handleDeleted = async () => {
    setSession(null);
    await refreshTree();
  };

  return (
    <DomainProvider domain={domain}>
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
          currentPath={session?.path ?? null}
          width={sideWidth}
          onOpenNote={openNote}
          onTreeChanged={refreshTree}
          onDeletedCurrent={handleDeleted}
          onPickVault={pickVault}
          canPickVault={backend.mode === "tauri"}
          onResize={setSideWidth}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>
      <main className="min-w-0 flex-1 overflow-hidden">
        {sceneView !== null ? (
          <div className="view-swap h-full">
            <Suspense
              fallback={
              <div className="flex h-full items-center justify-center text-sm text-faint">
                    {t("sceneLoading")}
                  </div>
              }
            >
              <ScenePanelStandalone
                src={sceneView}
                onBack={() => setSceneView(null)}
                backLabel="关闭"
                onSaved={() => {}}
              />
            </Suspense>
          </div>
        ) : vaultName === null ? (
          <div className="view-swap flex h-full flex-col items-center justify-center gap-4 text-soft">
            <div className="serif text-2xl text-ink">NoteShare</div>
            <p className="text-sm">{t("noVaultHint")}</p>
            <button className="btn-primary" onClick={pickVault}>
              {t("pickVaultBtn")}
            </button>
          </div>
        ) : session ? (
          <Editor
            key={session.key}
            initialPath={session.path}
            onRenamed={handleRenamed}
            onDeleted={handleDeleted}
            onToggleSidebar={() => setSideCollapsed((v) => !v)}
            sideCollapsed={sideCollapsed}
            canBack={history.index > 0}
            canForward={history.index < history.stack.length - 1}
            onBack={() => jumpHistory(-1)}
            onForward={() => jumpHistory(1)}
          />
        ) : (
          <div className="view-swap relative h-full">
            <button
              className="side-toggle-float"
              data-tip={sideCollapsed ? "展开左侧栏" : "收起左侧栏"}
              onClick={() => setSideCollapsed((v) => !v)}
            >
              {I.panelLeft}
            </button>
            <EmptyState
              vaultName={vaultName}
              onNewNote={async () => {
                const path = await backend.createNote("", t("untitledNote"));
                openNote(path);
              }}
            />
          </div>
        )}
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
    </DomainProvider>
  );
}
