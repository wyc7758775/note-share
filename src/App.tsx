import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { backend, type TreeNode } from "./backend";
import { useSettings } from "./i18n";
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

  // 打开过的笔记历史（浏览器式返回/前进）
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 });

  const openNote = (path: string) => {
    setSession((s) => (s && s.path === path ? s : { path, key: (s?.key ?? 0) + 1 }));
    setHistory((h) => {
      if (h.stack[h.index] === path) return h; // 连续重复不进栈
      return { stack: [...h.stack.slice(0, h.index + 1), path], index: h.index + 1 };
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

  // 双链点击跳转（Editor 里 wikilink 节点发出）
  useEffect(() => {
    const onOpen = (e: Event) => openNote((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_NOTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTE_EVENT, onOpen);
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
  );
}
