import { useState } from "react";
import type { TreeNode } from "../backend";
import { I } from "./icons";

interface Props {
  items: TreeNode[];
  depth: number;
  currentPath: string | null;
  onOpenNote: (path: string) => void;
  onNewNote: (folder: string) => void;
  onNewFolder: (parent: string) => void;
  onRename: (item: TreeNode) => void;
  onDelete: (item: TreeNode) => void;
}

export default function FileTree(props: Props) {
  return (
    <div>
      {props.items.map((item) => (
        <TreeRow key={item.path} item={item} {...props} />
      ))}
    </div>
  );
}

function TreeRow({
  item,
  depth,
  currentPath,
  onOpenNote,
  onNewNote,
  onNewFolder,
  onRename,
  onDelete,
}: Props & { item: TreeNode }) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: 6 + depth * 14 };

  const rowCls =
    "group flex w-full items-center gap-1.5 rounded-md py-[5px] pr-1 text-left text-[13px] transition-colors";

  if (item.kind === "folder") {
    return (
      <div>
        <div className={`${rowCls} ${open ? "text-stone-700" : "text-stone-600"} hover:bg-stone-200/60`} style={pad}>
          <button
            className="flex min-w-0 flex-1 items-center gap-1"
            onClick={() => setOpen((v) => !v)}
          >
            <span
              className={`text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
            >
              {I.chevron}
            </span>
            <span className="text-stone-500">{I.folder}</span>
            <span className="truncate">{item.name}</span>
          </button>
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <IconBtn title="在此新建笔记" onClick={() => onNewNote(item.path)}>
              {I.plus}
            </IconBtn>
            <IconBtn title="新建子文件夹" onClick={() => onNewFolder(item.path)}>
              {I.folderPlus}
            </IconBtn>
            <IconBtn title="重命名" onClick={() => onRename(item)}>
              {I.pencil}
            </IconBtn>
            <IconBtn title="移入回收站" onClick={() => onDelete(item)}>
              {I.trash}
            </IconBtn>
          </span>
        </div>
        {open && item.children && (
          <FileTree
            items={item.children}
            depth={depth + 1}
            currentPath={currentPath}
            onOpenNote={onOpenNote}
            onNewNote={onNewNote}
            onNewFolder={onNewFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        )}
      </div>
    );
  }

  if (item.kind === "note") {
    const active = currentPath === item.path;
    return (
      <div
        className={`${rowCls} ${active ? "bg-amber-100/60 text-stone-900" : "text-stone-700 hover:bg-stone-200/60"}`}
        style={pad}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 pl-1"
          onClick={() => onOpenNote(item.path)}
        >
          <span className={active ? "text-amber-700" : "text-stone-400"}>{I.note}</span>
          <span className="truncate">{item.name.replace(/\.md$/i, "")}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconBtn title="重命名" onClick={() => onRename(item)}>
            {I.pencil}
          </IconBtn>
          <IconBtn title="移入回收站" onClick={() => onDelete(item)}>
            {I.trash}
          </IconBtn>
        </span>
      </div>
    );
  }

  // 附件（图片/画板等）只展示，不给操作
  return (
    <div className={`${rowCls} text-stone-400`} style={pad} title={item.path}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        {I.asset}
        <span className="truncate text-[12px]">{item.name}</span>
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
      className="rounded p-1 text-stone-400 hover:bg-white hover:text-stone-600"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
