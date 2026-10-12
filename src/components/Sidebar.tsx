import { useEffect, useRef, useState } from "react";
import { backend, type SearchHit, type TreeNode } from "../backend";
import { useSettings } from "../i18n";
import type { VaultRef } from "../domain/vault";
import type { VaultService } from "../application/vault-service";
import { downloadDataUrl } from "../lib/download";
import { showContextMenu } from "./ContextMenu";
import { useDomain, useOutlineVersion } from "../domain/provider";
import { HOME_PATH, type OutlineSearchRow } from "../outline/store";
import { requestOpenHome, requestZoomHome } from "../outline/home-bus";
import { NODE_MIME } from "./home/outlineKit";
import { I } from "./icons";
import FileTree, { InlineInputRow, type TreeHandlers } from "./FileTree";
import ImageViewer, { type ViewerImage } from "./ImageViewer";
import VaultMenu from "./VaultMenu";

/** 请求聚焦侧栏搜索（欢迎页"打开文件" / Ctrl+O） */
export const FOCUS_SEARCH_EVENT = "noteshare:focus-search";

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** 收集某个文件夹下的所有图片附件（同文件夹组成一册图片廊） */
function collectImageAssets(items: TreeNode[], folder: string): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "folder") walk(n.children ?? []);
      else if (n.kind === "asset" && IMG_RE.test(n.name)) {
        const parent = n.path.split("/").slice(0, -1).join("/");
        if (parent === folder) out.push(n);
      }
    }
  };
  walk(items);
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

const HIDDEN = new Set([".obsidian", ".trash", "Home.md"]);

/** 目录树展开状态持久化（默认收起，只记展开过的文件夹路径；按仓库隔离） */
function treeExpandedKey(vaultId: string) {
  return `noteshare.treeExpanded.${vaultId}`;
}
function loadExpanded(vaultId: string): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(treeExpandedKey(vaultId)) ?? "[]");
    return new Set(Array.isArray(arr) ? arr.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}
function saveExpanded(vaultId: string, set: Set<string>) {
  try {
    localStorage.setItem(treeExpandedKey(vaultId), JSON.stringify([...set]));
  } catch {
    /* 存储满等异常：静默放弃本次记忆 */
  }
}
/** 收集树里全部文件夹路径（惰性清理展开集合用） */
function folderPathsOf(items: TreeNode[], out: Set<string> = new Set()): Set<string> {
  for (const it of items) {
    if (it.kind === "folder") {
      out.add(it.path);
      folderPathsOf(it.children ?? [], out);
    }
  }
  return out;
}

interface Props {
  tree: TreeNode[];
  currentPath: string | null;
  width: number;
  onOpenNote: (path: string, opts?: { newTab?: boolean; newPane?: boolean }) => void;
  /** 文件夹级变化（新建文件夹等非笔记域操作）后刷新树 */
  onTreeChanged: () => Promise<void>;
  /** 仓库切换（应用级服务与当前引用，左下角菜单用） */
  vaultService: VaultService;
  currentVault: VaultRef;
  onSwitchVault: (path: string) => Promise<void>;
  onManageVaults: () => void;
  onResize: (width: number) => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

export default function Sidebar(props: Props) {
  const { tree, currentPath, onOpenNote, width, onResize } = props;
  const { t } = useSettings();
  const { notes: noteService, bus, outline } = useDomain();
  const outlineVersion = useOutlineVersion(); // Home 大纲变化刷新节点搜索
  const [tab, setTab] = useState<"files" | "search">("files");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [homeRows, setHomeRows] = useState<OutlineSearchRow[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---- 目录树展开状态（受控 + localStorage 记忆；默认收起） ----
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    loadExpanded(props.currentVault.id)
  );
  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(props.currentVault.id, next);
      return next;
    });
  };
  // 树刷新时惰性清理：文件夹被删/改名后，展开集合里的失效路径顺手清掉。
  // 树为空 = 尚未加载完成（directory.init 异步），此时不清理——否则刷新瞬间会把
  // 全部展开记录当失效清空，记忆失效
  useEffect(() => {
    if (!tree.length) return;
    setExpandedFolders((prev) => {
      const valid = folderPathsOf(tree);
      const next = new Set([...prev].filter((p) => valid.has(p)));
      if (next.size === prev.size) return prev;
      saveExpanded(props.currentVault.id, next);
      return next;
    });
  }, [tree, props.currentVault.id]);
  // 文件夹改名/移动：展开集合里的路径前缀跟随（assetMoved 由 Sidebar 自己的重命名提交发出）
  useEffect(() => {
    const relocate = (from: string, to: string) => {
      setExpandedFolders((prev) => {
        if (![...prev].some((p) => p === from || p.startsWith(from + "/"))) return prev;
        const next = new Set<string>();
        for (const p of prev) {
          if (p === from) next.add(to);
          else if (p.startsWith(from + "/")) next.add(to + p.slice(from.length));
          else next.add(p);
        }
        saveExpanded(props.currentVault.id, next);
        return next;
      });
    };
    return bus.on(["assetMoved"], (e) => {
      if (e.type !== "assetMoved") return;
      relocate(e.from, e.to);
    });
  }, [bus, props.currentVault.id]);

  // 打开文件（欢迎页按钮 / Ctrl+O）：切到搜索页并聚焦输入框
  useEffect(() => {
    const onFocusSearch = () => {
      setTab("search");
      window.setTimeout(() => searchRef.current?.focus(), 30);
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocusSearch);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocusSearch);
  }, []);

  // 行内重命名 / 新建文件夹 / 新建白板命名 / 两步删除 / 图片阅览器 的状态
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newCanvasIn, setNewCanvasIn] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!query.trim()) {
      setHits(null);
      setHomeRows(null);
      return;
    }
    // Home 节点即时过滤（内存索引，无防抖）
    setHomeRows(outline.search(query.trim()));
    timer.current = window.setTimeout(async () => {
      try {
        setHits(await backend.search(query.trim()));
      } catch {
        setHits([]);
      }
    }, 250);
    return () => window.clearTimeout(timer.current);
    // outlineVersion：Home 内容变化时重算节点分区
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, outlineVersion]);

  const armDelete = (path: string | null) => {
    window.clearTimeout(armTimer.current);
    setConfirmPath(path);
    if (path) {
      armTimer.current = window.setTimeout(() => setConfirmPath(null), 2600);
    }
  };

  const handlers: TreeHandlers = {
    onOpenNote: (p, opts) => {
      setQuery("");
      setTab("files");
      onOpenNote(p, opts);
    },
    onNewNote: async (folder) => {
      const path = await noteService.create(t("untitledNote"), folder);
      if (path) onOpenNote(path); // 树/名录由 noteCreated 事件驱动刷新
    },
    onRequestRename: (item) => {
      armDelete(null);
      setRenaming(item);
    },
    onCancelRename: () => setRenaming(null),
    onCommitRename: async (item, name) => {
      setRenaming(null);
      const n = name.trim();
      if (!n) return;
      // 编辑时后缀已隐藏（见 FileTree 的 InlineInputRow），提交按原后缀拼回：
      // 任何文件类型都改不了扩展名，避免误改后缀导致文件打不开
      const ext = item.kind === "folder" ? "" : item.name.match(/\.([^.]+)$/)?.[1] ?? "";
      const stem = ext ? item.name.slice(0, -ext.length - 1) : item.name;
      if (n === stem) return;
      if (item.kind === "note") {
        const target = await noteService.rename(item.path, n);
        if (target && currentPath === item.path) onOpenNote(target);
      } else if (ext) {
        // 附件（白板/手绘/图片…）：扩展名保全；手绘的预览 PNG 成对跟随；
        // 发 assetMoved 让文件树刷新、持有它的标签路径跟随
        const base = n.replace(/\.[^.]+$/, ""); // 防御手敲后缀：剥掉，以原后缀为准
        if (!base) return;
        const to = await backend.renamePath(item.path, `${base}.${ext}`);
        if (ext.toLowerCase() === "excalidraw") {
          try {
            await backend.renamePath(item.path.replace(/\.excalidraw$/i, ".png"), `${base}.png`);
          } catch {
            /* 没有预览 PNG 就跳过 */
          }
        }
        bus.emit({ type: "assetMoved", from: item.path, to });
      } else {
        await backend.renamePath(item.path, n); // 文件夹重命名不属于笔记聚合，走 backend
        await props.onTreeChanged();
      }
    },
    onDelete: async (path) => {
      armDelete(null);
      if (/\.md$/i.test(path)) {
        await noteService.trash(path); // 笔记走领域事件（栏清理由 Workspace 订阅完成）
      } else {
        await backend.deletePath(path); // 文件夹
      }
    },
    onArmDelete: armDelete,
    onNewCanvasIn: setNewCanvasIn,
    onViewAsset: async (item) => {
      const parent = item.path.split("/").slice(0, -1).join("/");
      const siblings = collectImageAssets(tree, parent);
      const images: ViewerImage[] = [];
      for (const s of siblings) {
        try {
          const { base64, mime } = await backend.readAssetBase64(s.path);
          images.push({ src: `data:${mime};base64,${base64}`, name: s.name });
        } catch {
          /* 读不到就跳过 */
        }
      }
      const index = Math.max(0, images.findIndex((x) => x.name === item.name));
      if (images.length) setViewer({ images, index });
    },
    onDownloadAsset: async (item) => {
      try {
        const { base64, mime } = await backend.readAssetBase64(item.path);
        await downloadDataUrl(item.name, `data:${mime};base64,${base64}`);
      } catch (e) {
        console.error("下载失败", e);
      }
    },
  };

  /** 拖拽右缘调整侧栏宽度 */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = width;
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) =>
      onResize(Math.max(190, Math.min(480, Math.round(startW + ev.clientX - startX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("resizing");
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // 触摸设备上系统打断手势（来电、手势导航）时也要解除拖拽状态
    window.addEventListener("pointercancel", up);
  };

  return (
    <aside className="sidebar" style={{ width }}>
      {/* 顶部：Home 固定入口 + 文件 / 搜索 双 Tab（Obsidian 式图标条，悬停有提示气泡） */}
      <div className="side-tabs">
        <button
          className={`side-tab side-tab-home ${currentPath === HOME_PATH ? "active" : ""}`}
          data-tip={t("homeOpenEntry")}
          onClick={() => onOpenNote(HOME_PATH, { newTab: true })}
        >
          {I.home}
        </button>
        <button
          className={`side-tab ${tab === "files" ? "active" : ""}`}
          data-tip={t("tabFiles")}
          onClick={() => setTab("files")}
        >
          {I.folder}
        </button>
        <button
          className={`side-tab ${tab === "search" ? "active" : ""}`}
          data-tip={t("tabSearch")}
          onClick={() => setTab("search")}
        >
          {I.search}
        </button>
        <span className="flex-1" />
        <button
          className="side-tab"
          data-tip={t("collapseSidebar")}
          onClick={props.onToggleSidebar}
        >
          {I.panelLeft}
        </button>
      </div>

      {tab === "files" ? (
        <>
          <div
            className="side-scroll"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-noteshare-tree")) e.preventDefault();
            }}
            onDrop={(e) => {
              // 拖到树空白区 = 移回根目录
              const raw = e.dataTransfer.getData("application/x-noteshare-tree");
              if (!raw) return;
              e.preventDefault();
              try {
                const { path, kind } = JSON.parse(raw);
                const fromFolder = path.split("/").slice(0, -1).join("/");
                if (!fromFolder) return; // 已在根
                const svc = noteService;
                void (kind === "note" ? svc.moveNote(path, "") : svc.moveAsset(path, ""));
              } catch {
                /* 非法数据忽略 */
              }
            }}
            onContextMenu={(e) => {
              // 目录树空白处右键：新建笔记 / 新建文件夹 / 新建画板 / 新建白板
              //（树内行有自己的菜单且不冒泡）
              e.preventDefault();
              showContextMenu(e.clientX, e.clientY, [
                {
                  label: t("newNote"),
                  onClick: () => void handlers.onNewNote(""),
                },
                {
                  label: t("newFolder"),
                  onClick: () => setNewFolderMode(true),
                },
                {
                  label: t("newScene"),
                  onClick: () => void noteService.createScene("").then((p) => {
                    if (p) window.dispatchEvent(new CustomEvent("noteshare:edit-scene", { detail: p }));
                  }),
                },
                {
                  label: t("newCanvas"),
                  onClick: () => setNewCanvasIn(""), // 根目录行内命名
                },
              ]);
            }}
          >
            {newFolderMode && (
              <InlineInputRow
                initial=""
                placeholder={t("newFolderPlaceholder")}
                onCommit={async (v) => {
                  setNewFolderMode(false);
                  if (v.trim()) {
                    await backend.createFolder("", v.trim());
                    await props.onTreeChanged();
                  }
                }}
                onCancel={() => setNewFolderMode(false)}
              />
            )}
            {newCanvasIn === "" && (
              <InlineInputRow
                initial=""
                placeholder={t("newCanvasPh")}
                onCommit={async (v) => {
                  setNewCanvasIn(null);
                  const n = v.trim();
                  if (!n) return;
                  const p = await noteService.createCanvas("", n);
                  if (p) handlers.onOpenNote(p, { newTab: true });
                }}
                onCancel={() => setNewCanvasIn(null)}
              />
            )}
            <FileTree
              items={tree.filter((t) => !HIDDEN.has(t.name))}
              depth={0}
              currentPath={currentPath}
              renamingPath={renaming?.path ?? null}
              confirmPath={confirmPath}
              newCanvasIn={newCanvasIn}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              {...handlers}
            />
          </div>
        </>
      ) : (
        <div className="side-scroll">
          <input
            ref={searchRef}
            className="side-search"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hits !== null && hits.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-faint">
              {t("noResults", { q: query })}
            </p>
          )}
          {hits?.map((h) => (
            <button
              key={h.path}
              className="tree-row block w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
              title={h.path}
              onClick={(e) =>
                handlers.onOpenNote(h.path, {
                  newTab: e.ctrlKey || e.metaKey,
                  newPane: (e.ctrlKey || e.metaKey) && e.shiftKey,
                })
              }
            >
              <div className="truncate text-[13px] text-ink">{h.title}</div>
              <div className="truncate text-[11px] text-faint">{h.snippet}</div>
            </button>
          ))}
          {homeRows && homeRows.length > 0 && (
            <div className="mt-2">
              <div className="px-2 py-1 text-[11px] font-medium text-faint">{t("homeNodes")}</div>
              {homeRows.map((row) => (
                <div
                  key={row.node.address.join("/")}
                  className="home-node-row"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      NODE_MIME,
                      JSON.stringify({ source: "search", address: row.node.address })
                    );
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title={t("homeDragHint")}
                  onClick={(e) => {
                    const ctrl = e.ctrlKey || e.metaKey;
                    requestOpenHome({ newTab: ctrl, newPane: ctrl && e.shiftKey });
                    requestZoomHome({ address: row.node.address });
                  }}
                >
                  <div className="truncate text-[13px] text-ink">
                    {row.node.done ? <s className="text-faint">{row.node.text.split("\n")[0]}</s> : row.node.text.split("\n")[0]}
                  </div>
                  {row.path.length > 0 && (
                    <div className="truncate text-[11px] text-faint">{row.path.join(" / ")}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 底部：仓库切换菜单 + 设置 */}
      <div className="vault-bar">
        <VaultMenu
          service={props.vaultService}
          current={props.currentVault}
          onSwitch={props.onSwitchVault}
          onManage={props.onManageVaults}
        />
        <button
          className="vault-setting-btn"
          data-tip={t("settings")}
          onClick={props.onOpenSettings}
        >
          {I.gear}
        </button>
      </div>

      {/* 右缘拖宽手柄 */}
      <div
        className={`side-resizer ${dragging ? "dragging" : ""}`}
        onPointerDown={startResize}
      />

      {/* 共用图片阅览器（附件图片廊） */}
      {viewer && (
        <ImageViewer
          images={viewer.images}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </aside>
  );
}
