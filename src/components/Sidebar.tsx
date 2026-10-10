import { useEffect, useRef, useState } from "react";
import { backend, type SearchHit, type TreeNode } from "../backend";
import { useSettings } from "../i18n";
import { downloadDataUrl } from "../lib/download";
import { showContextMenu } from "./ContextMenu";
import { useDomain } from "../domain/provider";
import { I } from "./icons";
import FileTree, { InlineInputRow, type TreeHandlers } from "./FileTree";
import ImageViewer, { type ViewerImage } from "./ImageViewer";

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

const HIDDEN = new Set([".obsidian", ".trash"]);

interface Props {
  vaultName: string | null;
  tree: TreeNode[];
  currentPath: string | null;
  width: number;
  onOpenNote: (path: string, opts?: { newPane?: boolean }) => void;
  /** 文件夹级变化（新建文件夹等非笔记域操作）后刷新树 */
  onTreeChanged: () => Promise<void>;
  onPickVault: () => void;
  canPickVault: boolean;
  onResize: (width: number) => void;
  onOpenSettings: () => void;
}

export default function Sidebar(props: Props) {
  const { vaultName, tree, currentPath, onOpenNote, width, onResize } = props;
  const { t } = useSettings();
  const { notes: noteService } = useDomain();
  const [tab, setTab] = useState<"files" | "search">("files");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // 行内重命名 / 新建文件夹 / 两步删除 / 图片阅览器 的状态
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!query.trim()) {
      setHits(null);
      return;
    }
    timer.current = window.setTimeout(async () => {
      try {
        setHits(await backend.search(query.trim()));
      } catch {
        setHits([]);
      }
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [query]);

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
      const old = item.kind === "note" ? item.name.replace(/\.md$/i, "") : item.name;
      if (n === old) return;
      if (item.kind === "note") {
        const target = await noteService.rename(item.path, n);
        if (target && currentPath === item.path) onOpenNote(target);
      } else {
        await backend.renamePath(item.path, n); // 文件夹重命名不属于笔记聚合，走 backend
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
      {/* 顶部：文件 / 搜索 双 Tab（Obsidian 式图标条，悬停有提示气泡） */}
      <div className="side-tabs">
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
              // 目录树空白处右键：新建笔记 / 新建文件夹（树内行有自己的菜单且不冒泡）
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
            <FileTree
              items={tree.filter((t) => !HIDDEN.has(t.name))}
              depth={0}
              currentPath={currentPath}
              renamingPath={renaming?.path ?? null}
              confirmPath={confirmPath}
              {...handlers}
            />
          </div>
        </>
      ) : (
        <div className="side-scroll">
          <input
            className="side-search"
            placeholder={t("searchPlaceholder")}
            value={query}
            autoFocus
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
              onClick={(e) => handlers.onOpenNote(h.path, { newPane: e.ctrlKey || e.metaKey })}
            >
              <div className="truncate text-[13px] text-ink">{h.title}</div>
              <div className="truncate text-[11px] text-faint">{h.snippet}</div>
            </button>
          ))}
        </div>
      )}

      {/* 底部：笔记仓库切换 + 设置 */}
      <div className="vault-bar">
        <button
          className="min-w-0 flex-1 self-stretch text-left"
          data-tip={props.canPickVault ? t("vaultSwitchTip") : t("vaultWebTip")}
          onClick={() => props.canPickVault && props.onPickVault()}
        >
          {I.folder}
          <span className="min-w-0 flex-1 truncate">{vaultName ?? "…"}</span>
          {props.canPickVault && <span className="shrink-0 text-faint">{I.switchVault}</span>}
        </button>
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
