import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../backend";
import { showContextMenu } from "./ContextMenu";
import { useSettings } from "../i18n";
import { EDIT_SCENE_EVENT } from "./ExcalidrawBlock";
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
  onOpenNote: (path: string) => void;
  onNewNote: (folder: string) => void;
  onCommitRename: (item: TreeNode, name: string) => void;
  onRequestRename: (item: TreeNode) => void;
  onCancelRename: () => void;
  onDelete: (path: string) => void;
  onArmDelete: (path: string | null) => void;
  onViewAsset: (item: TreeNode) => void;
  onDownloadAsset: (item: TreeNode) => void;
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

interface Props extends TreeHandlers {
  items: TreeNode[];
  depth: number;
  currentPath: string | null;
  renamingPath: string | null;
  confirmPath: string | null;
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
  items: _items,
  ...h
}: Props & { item: TreeNode }) {
  void _items;
  const { t } = useSettings();
  const [open, setOpen] = useState(true);
  const renaming = renamingPath === item.path;
  const armed = confirmPath === item.path;

  if (renaming) {
    return (
      <InlineInputRow
        initial={item.kind === "note" ? item.name.replace(/\.md$/i, "") : item.name}
        depth={depth}
        onCommit={(v) => h.onCommitRename(item, v)}
        onCancel={h.onCancelRename}
      />
    );
  }

  const rowCls = "tree-row group flex w-full items-center gap-1.5 rounded-md py-[5px] pr-1 text-left text-[13px]";
  const pad = { paddingLeft: 6 + depth * 14 };

  if (item.kind === "folder") {
    return (
      <div>
        <div
          className={`${rowCls} ${open ? "text-ink" : "text-soft"}`}
          style={pad}
          title={item.name}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, [
              { label: t("newNoteHere"), onClick: () => h.onNewNote(item.path) },
              { separator: true },
              { label: t("rename"), onClick: () => h.onRequestRename(item) },
              { label: t("trashLabel"), danger: true, onClick: () => h.onDelete(item.path) },
            ]);
          }}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-1"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`tree-chev text-faint ${open ? "tree-chev-open" : ""}`}>
              {I.chevron}
            </span>
            <span className="text-soft">{I.folder}</span>
            <span className="truncate">{item.name}</span>
          </button>
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <IconBtn title={t("newNoteHere")} onClick={() => h.onNewNote(item.path)}>
              {I.plus}
            </IconBtn>
            <IconBtn title={t("rename")} onClick={() => h.onRequestRename(item)}>
              {I.pencil}
            </IconBtn>
            <ArmDeleteBtn armed={armed} onArm={() => h.onArmDelete(item.path)} onConfirm={() => h.onDelete(item.path)} />
          </span>
        </div>
        {item.children && (
          <div className={`tree-children ${open ? "" : "tree-children-closed"}`}>
            <div>
              <FileTree
                items={item.children}
                depth={depth + 1}
                currentPath={currentPath}
                renamingPath={renamingPath}
                confirmPath={confirmPath}
                {...h}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "note") {
    const active = currentPath === item.path;
    return (
      <div
        className={`${rowCls} ${active ? "tree-row-active" : ""}`}
        style={pad}
        title={item.name.replace(/\.md$/i, "")}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, [
            { label: t("open"), onClick: () => h.onOpenNote(item.path) },
            { separator: true },
            { label: t("rename"), onClick: () => h.onRequestRename(item) },
            { label: t("trashLabel"), danger: true, onClick: () => h.onDelete(item.path) },
          ]);
        }}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 pl-1"
          onClick={() => h.onOpenNote(item.path)}
        >
          <span className={active ? "text-amber-700" : "text-faint"}>{I.note}</span>
          <span className="truncate">{item.name.replace(/\.md$/i, "")}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconBtn title={t("rename")} onClick={() => h.onRequestRename(item)}>
            {I.pencil}
          </IconBtn>
          <ArmDeleteBtn armed={armed} onArm={() => h.onArmDelete(item.path)} onConfirm={() => h.onDelete(item.path)} />
        </span>
      </div>
    );
  }

  // 附件：图片可点击查看/右键下载；.excalidraw 手绘文件可点击编辑；其他只展示
  const isImg = IMG_RE.test(item.name);
  const isScene = /\.excalidraw$/i.test(item.name);
  const active = isImg || isScene;
  return (
    <div
      className={`${rowCls} ${active ? "cursor-pointer text-soft hover:bg-hover" : "text-faint"}`}
      style={pad}
      title={isScene ? t("clickToEdit") : isImg ? t("clickToView") : item.path}
      onClick={() => {
        if (isImg) h.onViewAsset(item);
        else if (isScene)
          window.dispatchEvent(new CustomEvent(EDIT_SCENE_EVENT, { detail: item.path }));
      }}
      onContextMenu={(e) => {
        if (!isImg) return;
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          { label: t("viewAsset"), onClick: () => h.onViewAsset(item) },
          { label: t("downloadImage"), onClick: () => h.onDownloadAsset(item) },
        ]);
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        {isScene ? I.pen : I.asset}
        <span className="truncate text-[12px]">{item.name}</span>
      </span>
    </div>
  );
}

// 两步删除：第一次点变成红色"确认?"，2.6 秒内再点才真删
function ArmDeleteBtn({
  armed,
  onArm,
  onConfirm,
}: {
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
}) {
  const { t } = useSettings();
  if (armed) {
    return (
      <button
        className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] text-white"
        title={t("confirmAgain")}
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
      >
        {t("delete")}?
      </button>
    );
  }
  return (
    <IconBtn title={t("trash")} onClick={onArm}>
      {I.trash}
    </IconBtn>
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
