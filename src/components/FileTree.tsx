import { useEffect, useRef, useState } from "react";
import type { TreeNode } from "../backend";
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
    <div className="px-1 py-0.5" style={{ paddingLeft: 10 + depth * 14 }}>
      <input
        ref={ref}
        className="w-full rounded-md border border-amber-600/40 bg-white px-2 py-1 text-[13px] outline-none focus:border-amber-700/70 focus:ring-2 focus:ring-amber-700/10"
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
}

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
        <div className={`${rowCls} ${open ? "text-stone-700" : "text-stone-600"}`} style={pad}>
          <button
            className="flex min-w-0 flex-1 items-center gap-1"
            onClick={() => setOpen((v) => !v)}
          >
            <span className={`tree-chev text-stone-400 ${open ? "tree-chev-open" : ""}`}>
              {I.chevron}
            </span>
            <span className="text-stone-500">{I.folder}</span>
            <span className="truncate">{item.name}</span>
          </button>
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <IconBtn title="在此新建笔记" onClick={() => h.onNewNote(item.path)}>
              {I.plus}
            </IconBtn>
            <IconBtn title="重命名" onClick={() => h.onRequestRename(item)}>
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
      <div className={`${rowCls} ${active ? "tree-row-active" : ""}`} style={pad}>
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 pl-1"
          onClick={() => h.onOpenNote(item.path)}
        >
          <span className={active ? "text-amber-700" : "text-stone-400"}>{I.note}</span>
          <span className="truncate">{item.name.replace(/\.md$/i, "")}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <IconBtn title="重命名" onClick={() => h.onRequestRename(item)}>
            {I.pencil}
          </IconBtn>
          <ArmDeleteBtn armed={armed} onArm={() => h.onArmDelete(item.path)} onConfirm={() => h.onDelete(item.path)} />
        </span>
      </div>
    );
  }

  // 附件只展示
  return (
    <div className={`${rowCls} text-stone-400`} style={pad} title={item.path}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1">
        {I.asset}
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
  if (armed) {
    return (
      <button
        className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] text-white"
        title="再次点击确认移入回收站"
        onClick={(e) => {
          e.stopPropagation();
          onConfirm();
        }}
      >
        确认删除?
      </button>
    );
  }
  return (
    <IconBtn title="移入回收站" onClick={onArm}>
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
      className="rounded p-1 text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
