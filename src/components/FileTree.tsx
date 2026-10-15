import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../backend";
import { backend } from "../backend";
import { showContextMenu } from "./ContextMenu";
import { useSettings } from "../i18n";
import { useDomain } from "../domain/provider";
import { emitEditScene } from "./ExcalidrawBlock";
import { importDroppedFiles } from "../lib/dropImport";
import { IS_MAC } from "../lib/platform";
import { I } from "./icons";

// ---------- 行内输入行（重命名 / 新建文件夹共用） ----------
export function InlineInputRow({
  initial,
  placeholder,
  onCommit,
  onCancel,
  depth = 0,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  depth?: number;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="row-in px-1 py-0.5" style={{ paddingLeft: 10 + depth * 14 }}>
      <input
        ref={ref}
        className="w-full rounded-md border border-amber-600/40 bg-surface px-2 py-1 text-[13px] outline-none focus:border-amber-700/70 focus:ring-2 focus:ring-amber-700/10"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(v);
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
        onBlur={() => onCommit(v)}
      />
    </div>
  );
}

export interface TreeHandlers {
  onOpenNote: (path: string, opts?: { newTab?: boolean; newPane?: boolean }) => void;
  onNewNote: (folder: string) => void;
  onCommitRename: (item: TreeNode, name: string) => void;
  onRequestRename: (item: TreeNode) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
  onArmDelete: (path: string | null) => void;
  onViewAsset: (item: TreeNode) => void;
  onDownloadAsset: (item: TreeNode) => void;
  /** 在指定文件夹里新建白板（弹行内命名输入；null = 取消） */
  onNewCanvasIn: (folder: string | null) => void;
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** 文件名：主名靠左、后缀靠右的两端对齐（Obsidian 式，后缀极淡对齐成一列） */
function TreeName({ name }: { name: string }) {
  const i = name.lastIndexOf(".");
  const hasExt = i > 0 && i < name.length - 1;
  return (
    <span className="flex h-full min-w-0 flex-1 items-center justify-between gap-2">
      <span className="truncate">{hasExt ? name.slice(0, i) : name}</span>
      {hasExt && <span className="shrink-0 text-faint opacity-50">{name.slice(i)}</span>}
    </span>
  );
}

interface Props extends TreeHandlers {
  items: TreeNode[];
  depth: number;
  currentPath: string | null;
  renamingPath: string | null;
  confirmPath: string | null;
  /** 正在命名的白板目标文件夹（"" = 根） */
  newCanvasIn: string | null;
  /** 展开状态受控（由 Sidebar 持有并持久化）：不在集合 = 收起（默认收起） */
  expandedFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
}

export default function FileTree(props: Props) {
  return <div>{props.items.map((item) => <TreeRow key={item.path} item={item} {...props} />)}</div>;
}

function TreeRow({
  item,
  depth,
  currentPath,
  renamingPath,
  confirmPath,
  newCanvasIn,
  expandedFolders,
  onToggleFolder,
  items: _items,
  ...h
}: Props & { item: TreeNode }) {
  void _items;
  const { t } = useSettings();
  const { notes: noteService } = useDomain();
  const open = expandedFolders.has(item.path); // 受控：默认收起，展开的记录在 Sidebar（localStorage 持久化）
  const renaming = renamingPath === item.path;
  const [dropHint, setDropHint] = useState(false);
  const dragging = useRef(false);
  // 删除退出动画：先播收起动效，再真正走回收站（防止连点重复删）
  const [exiting, setExiting] = useState(false);
  const animatedDelete = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(() => h.onDelete(item.path), 200);
  };

  const isFolder = item.kind === "folder";
  const parentFolder = item.path.split("/").slice(0, -1).join("/");

  /** 行内命名完成 → 在目标文件夹创建白板并开新标签 */
  const commitCanvas = async (folder: string, name: string) => {
    h.onNewCanvasIn(null);
    const n = name.trim();
    if (!n) return;
    const p = await noteService.createCanvas(folder, n);
    if (p) h.onOpenNote(p, { newTab: true });
  };

  if (renaming) {
    return (
      <InlineInputRow
        // 所有文件类型编辑时都隐藏后缀（提交时自动拼回，见 Sidebar.onCommitRename）
        initial={item.kind === "folder" ? item.name : item.name.replace(/\.[^.]+$/, "")}
        depth={depth}
        onCommit={(v) => h.onCommitRename(item, v)}
        onCancel={h.onCancelRename}
      />
    );
  }

  // 行高固定 30px，主按钮 h-full 撑满——整行高度都可点击
  const rowCls =
    "tree-row group flex h-[30px] w-full items-center gap-1.5 rounded-md pr-1 text-left text-[13px]";
  const pad = { paddingLeft: 4 + depth * 9 };
  const exitCls = exiting ? "tree-row-exiting" : "";

  if (isFolder) {
    return (
      <div>
        <div
          className={`${rowCls} ${exitCls} text-ink ${dropHint ? "tree-row-drop" : ""}`}
          style={pad}
          title={item.name}
          onDragOver={(e) => {
            const external = e.dataTransfer.types.includes("Files"); // OS 拖入的文件
            if (!external && !e.dataTransfer.types.includes("application/x-noteshare-tree")) return;
            e.preventDefault(); // 允许放置
            e.dataTransfer.dropEffect = external ? "copy" : "move";
            setDropHint(true);
          }}
          onDragLeave={() => setDropHint(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropHint(false);
            // OS 文件拖到文件夹行：定向导入到该文件夹（stopPropagation 免得全局再导一份）
            if (e.dataTransfer.files?.length) {
              e.stopPropagation();
              void importDroppedFiles(e.dataTransfer.files, item.path, noteService);
              return;
            }
            const raw = e.dataTransfer.getData("application/x-noteshare-tree");
            if (!raw) return;
            try {
              const { path, kind } = JSON.parse(raw);
              if (path === item.path) return; // 拖到自己（文件夹）无效
              const fromFolder = path.split("/").slice(0, -1).join("/");
              if (fromFolder === item.path) return; // 已在此文件夹
              void (kind === "note"
                ? noteService.moveNote(path, item.path)
                : noteService.moveAsset(path, item.path));
            } catch {
              /* 非法数据忽略 */
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, [
              { label: t("newNoteHere"), onClick: () => h.onNewNote(item.path) },
              { label: t("newScene"), onClick: () => void noteService.createScene(item.path).then((p) => {
                if (p) emitEditScene(p); // 新标签打开新画的画板
              }) },
              { label: t("newCanvas"), onClick: () => {
                if (!open) onToggleFolder(item.path); // 保证输入行可见（仅未展开时展开）
                h.onNewCanvasIn(item.path);
              } },
              { separator: true },
              { label: t("rename"), onClick: () => h.onRequestRename(item) },
              { label: t("trashLabel"), danger: true, onClick: animatedDelete },
            ]);
          }}
        >
          <button
            className="flex h-full min-w-0 flex-1 items-center gap-1"
            onClick={() => onToggleFolder(item.path)}
          >
            <span className={`tree-chev text-faint ${open ? "tree-chev-open" : ""}`}>
              {I.chevron}
            </span>
            <span className="truncate">{item.name}</span>
          </button>
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <IconBtn title={t("newNoteHere")} onClick={() => h.onNewNote(item.path)}>
              {I.plus}
            </IconBtn>
          </span>
        </div>
        {(item.children || newCanvasIn === item.path) && (
          <div
            className={`tree-children ${open || newCanvasIn === item.path ? "" : "tree-children-closed"}`}
          >
            {newCanvasIn === item.path && (
              <InlineInputRow
                initial=""
                placeholder={t("newCanvasPh")}
                depth={depth + 1}
                onCommit={(v) => void commitCanvas(item.path, v)}
                onCancel={() => h.onNewCanvasIn(null)}
              />
            )}
            {item.children && (
              <div>
                <FileTree
                  items={item.children}
                  depth={depth + 1}
                  currentPath={currentPath}
                  renamingPath={renamingPath}
                  confirmPath={confirmPath}
                  newCanvasIn={newCanvasIn}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  {...h}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "note") {
    const active = currentPath === item.path;
    return (
      <div
        className={`${rowCls} ${exitCls} ${active ? "tree-row-active" : ""} ${dragging.current ? "tree-row-dragging" : ""}`}
        style={pad}
        title={item.name}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/x-noteshare-tree",
            JSON.stringify({ path: item.path, kind: "note" })
          );
          e.dataTransfer.effectAllowed = "move";
          dragging.current = true;
          setDropHint(false);
        }}
        onDragEnd={() => (dragging.current = false)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, [
            { label: t("open"), onClick: () => h.onOpenNote(item.path) },
            { label: t("openInNewTab"), onClick: () => h.onOpenNote(item.path, { newTab: true }) },
            { label: t("openInNewPane"), onClick: () => h.onOpenNote(item.path, { newPane: true }) },
            {
              label: IS_MAC ? t("revealInFinder") : t("revealInExplorer"),
              onClick: () =>
                void backend
                  .revealPath(item.path)
                  .catch((err) => console.error("在文件管理器中显示失败", err)),
            },
            { separator: true },
            { label: t("newCanvas"), onClick: () => h.onNewCanvasIn(parentFolder) }, // 同级目录新建白板（行内命名）
            { separator: true },
            { label: t("rename"), onClick: () => h.onRequestRename(item) },
            { label: t("trashLabel"), danger: true, onClick: animatedDelete },
          ]);
        }}
      >
        <button
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1"
          onClick={(e) =>
            h.onOpenNote(item.path, {
              newTab: e.ctrlKey || e.metaKey, // Ctrl+点击：当前栏新标签
              newPane: (e.ctrlKey || e.metaKey) && e.shiftKey, // Ctrl+Shift+点击：新栏
            })
          }
        >
          <TreeName name={item.name} />
        </button>
      </div>
    );
  }

  // 附件：图片可点击查看/右键下载；.excalidraw 手绘、.canvas 白板可点击编辑；PDF 可点击阅读；其他只展示
  const isImg = IMG_RE.test(item.name);
  const isScene = /\.excalidraw$/i.test(item.name);
  const isCanvas = /\.canvas$/i.test(item.name);
  const isPdf = /\.pdf$/i.test(item.name);
  const active = isImg || isScene || isCanvas || isPdf;
  return (
    <div
      className={`${rowCls} ${exitCls} ${active ? "cursor-pointer hover:bg-hover" : "text-faint"} ${dragging.current ? "tree-row-dragging" : ""}`}
      style={pad}
      title={isScene ? t("clickToEdit") : isCanvas ? t("clickToEditCanvas") : isImg ? t("clickToView") : isPdf ? t("clickToReadPdf") : item.path}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/x-noteshare-tree",
          JSON.stringify({ path: item.path, kind: "asset" })
        );
        e.dataTransfer.effectAllowed = "move";
        dragging.current = true;
      }}
      onDragEnd={() => (dragging.current = false)}
      onClick={(e) => {
        if (isImg) h.onViewAsset(item);
        else if (isScene) emitEditScene(item.path, e.ctrlKey || e.metaKey); // 画板进标签（Ctrl=新标签）
        else if (isCanvas || isPdf) h.onOpenNote(item.path, { newTab: e.ctrlKey || e.metaKey }); // 白板/PDF 进标签
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isImg) {
          showContextMenu(e.clientX, e.clientY, [
            { label: t("openInNewTab"), onClick: () => h.onOpenNote(item.path, { newTab: true }) },
            { label: t("openInNewPane"), onClick: () => h.onOpenNote(item.path, { newPane: true }) },
            { separator: true },
            { label: t("viewAsset"), onClick: () => h.onViewAsset(item) },
            { label: t("downloadImage"), onClick: () => h.onDownloadAsset(item) },
          ]);
          return;
        }
        if (isPdf) {
          showContextMenu(e.clientX, e.clientY, [
            { label: t("openInNewTab"), onClick: () => h.onOpenNote(item.path, { newTab: true }) },
            { label: t("openInNewPane"), onClick: () => h.onOpenNote(item.path, { newPane: true }) },
            { separator: true },
            {
              label: t("pdfConvert"),
              onClick: () =>
                void import("./PdfViewer")
                  .then((m) => m.convertPdfToNote(item.path, noteService))
                  .then((p) => {
                    if (p) h.onOpenNote(p, { newTab: true }); // 转完直接弹出新笔记，即转换反馈
                  })
                  .catch((err) => console.error("PDF 转 Markdown 失败", err)),
            },
            { separator: true },
            { label: t("rename"), onClick: () => h.onRequestRename(item) },
            { label: t("trashLabel"), danger: true, onClick: animatedDelete },
          ]);
          return;
        }
        if (isScene) {
          showContextMenu(e.clientX, e.clientY, [
            { label: t("openInNewTab"), onClick: () => emitEditScene(item.path, true) },
            { label: t("openInNewPane"), onClick: () => h.onOpenNote(item.path, { newPane: true }) },
            { separator: true },
            { label: t("rename"), onClick: () => h.onRequestRename(item) },
            { label: t("trashLabel"), danger: true, onClick: animatedDelete },
          ]);
          return;
        }
        if (isCanvas) {
          showContextMenu(e.clientX, e.clientY, [
            { label: t("openInNewTab"), onClick: () => h.onOpenNote(item.path, { newTab: true }) },
            { label: t("openInNewPane"), onClick: () => h.onOpenNote(item.path, { newPane: true }) },
            { separator: true },
            { label: t("rename"), onClick: () => h.onRequestRename(item) },
            { label: t("trashLabel"), danger: true, onClick: animatedDelete },
          ]);
        }
      }}
    >
        <span className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1">
          <TreeName name={item.name} />
        </span>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      className="rounded p-1 text-faint transition-colors hover:bg-surface hover:text-soft"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
