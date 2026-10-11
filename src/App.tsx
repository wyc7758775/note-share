import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { backend } from "./backend";
import { useSettings } from "./i18n";
import {
  createDomain,
  DomainProvider,
  useDomain,
  useWorkspaceVersion,
  type Domain,
} from "./domain/provider";
import { VaultRegistry, type VaultRef } from "./domain/vault";
import { VaultService } from "./application/vault-service";
import { setMainWindowSize } from "./backend/window-size";
import type { LayoutNode } from "./domain/workspace";
import Sidebar, { FOCUS_SEARCH_EVENT } from "./components/Sidebar";
import PaneView from "./components/PaneView";
import SettingsModal from "./components/SettingsModal";
import VaultSwitcher from "./components/VaultSwitcher";
import { OPEN_NOTE_EVENT } from "./components/WikiLink";
import { EDIT_SCENE_EVENT, emitEditScene } from "./components/ExcalidrawBlock";
import { PikachuLogo, I } from "./components/icons";

/** 一次"打开的仓库"会话：领域容器 + 仓库引用。切换仓库 = 整个 session 换新 */
interface VaultSession {
  domain: Domain;
  vault: VaultRef;
}

export default function App() {
  const [registry] = useState(() => new VaultRegistry());
  const [service] = useState(() => new VaultService(registry));
  const [session, setSession] = useState<VaultSession | null>(null);
  const [managing, setManaging] = useState(false);
  const [booted, setBooted] = useState(false);
  const sessionRef = useRef<VaultSession | null>(null);

  // 启动：拉注册表，有"上次打开且目录仍在"的仓库直接进，否则落启动页
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await service.refresh();
        const last = registry.lastOpened();
        if (last) {
          const ref = await service.open(last.path);
          if (!alive) return;
          const next = { domain: createDomain(), vault: ref };
          sessionRef.current = next;
          setSession(next);
        }
      } catch {
        /* 拉取/打开失败也进启动页，在那里能重试 */
      } finally {
        if (alive) setBooted(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 打开/切换仓库：重建领域容器，key remount 让布局/名录/历史等 vault 内状态全部归零
  const openVault = useCallback(
    async (path: string) => {
      const ref = await service.open(path);
      const next = { domain: createDomain(), vault: ref };
      sessionRef.current?.domain.dispose();
      sessionRef.current = next;
      setSession(next);
      setManaging(false);
      void setMainWindowSize(); // 桌面端：从启动小窗回到工作区大窗（Obsidian 式）
    },
    [service]
  );

  if (!booted) {
    return (
      <div className="vault-boot">
        <PikachuLogo size={72} className="text-ink" />
      </div>
    );
  }
  if (managing || !session) {
    return (
      <VaultSwitcher
        service={service}
        onOpen={openVault}
        onBack={session ? () => setManaging(false) : undefined}
      />
    );
  }
  return (
    <DomainProvider key={session.vault.id} domain={session.domain}>
      <VaultApp
        vault={session.vault}
        vaultService={service}
        onOpenVault={openVault}
        onManageVaults={() => setManaging(true)}
      />
    </DomainProvider>
  );
}

/** 主界面：一个已打开仓库的全部工作区 UI（随 session 整树 remount，不做跨仓库状态保留） */
function VaultApp({
  vault,
  vaultService,
  onOpenVault,
  onManageVaults,
}: {
  vault: VaultRef;
  vaultService: VaultService;
  onOpenVault: (path: string) => Promise<void>;
  onManageVaults: () => void;
}) {
  const { t } = useSettings();
  const { workspace, bus, directory, notes: noteService } = useDomain();
  useWorkspaceVersion(); // 分栏/标签布局变化触发重渲染
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        } else if (e.type === "assetMoved") {
          workspace.relocate(e.from, e.to); // 白板/手绘重命名或移动：标签路径跟随（面板按新 src 重载）
        } else if (e.type === "noteTrashed") {
          workspace.clearPath(e.path); // 持有它的标签关闭（相邻顶上）
        }
      }
    );
    return off;
  }, [bus, refreshTree, workspace]);

  useEffect(() => {
    void refreshTree();
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

  // 全局快捷键：Ctrl+N 新建笔记（活动栏新标签）、Ctrl+O 打开文件（聚焦侧栏搜索）
  // （Ctrl+N 在浏览器里是保留键拦不住，桌面端有效；面板上的提示以此为准）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void backend.createNote("", t("untitledNote")).then((p) => openNote(p, { newTab: true }));
      } else if (k === "o") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(FOCUS_SEARCH_EVENT));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNote, t]);

  // 侧栏收起时请求搜索：先展开再聚焦（Sidebar 自己监听同一事件切搜索页）
  useEffect(() => {
    const onFocusSearch = () => setSideCollapsed(false);
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocusSearch);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocusSearch);
  }, []);

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
          vaultName={vault.name}
          onNewNote={async () => {
            const path = await noteService.create(t("untitledNote"), "");
            if (path) openNote(path);
          }}
          onNewCanvas={async (name) => {
            const path = await noteService.createCanvas("", name);
            if (path) openNote(path, { newTab: true });
          }}
          onNewScene={async () => {
            const path = await noteService.createScene("");
            if (path) emitEditScene(path); // 新标签打开新手绘
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
            tree={tree}
            currentPath={workspace.activePath}
            width={sideWidth}
            onOpenNote={(path, opts) => openNote(path, opts)}
            onTreeChanged={refreshTree}
            vaultService={vaultService}
            currentVault={vault}
            onSwitchVault={onOpenVault}
            onManageVaults={onManageVaults}
            onResize={setSideWidth}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleSidebar={() => setSideCollapsed((v) => !v)}
          />
        </div>
        <main className={`relative flex min-w-0 flex-1 overflow-hidden ${sideCollapsed ? "sidebar-collapsed" : ""}`}>
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
        </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
