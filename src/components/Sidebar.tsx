import { useEffect, useRef, useState } from "react";
import { backend, type SearchHit, type TreeNode } from "../backend";
import { I } from "./icons";
import FileTree, { InlineInputRow, type TreeHandlers } from "./FileTree";

interface Props {
  vaultName: string | null;
  tree: TreeNode[];
  currentPath: string | null;
  onOpenNote: (path: string) => void;
  onTreeChanged: () => Promise<void>;
  onDeletedCurrent: () => Promise<void>;
  onPickVault: () => void;
  canPickVault: boolean;
}

const HIDDEN = new Set([".obsidian", ".trash"]);

export default function Sidebar(props: Props) {
  const { vaultName, tree, currentPath, onOpenNote, onTreeChanged } = props;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // 行内重命名 / 新建文件夹 / 两步删除 的状态
  const [renaming, setRenaming] = useState<TreeNode | null>(null);
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);

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
    onOpenNote: (p) => {
      setQuery("");
      onOpenNote(p);
    },
    onNewNote: async (folder) => {
      const path = await backend.createNote(folder, "未命名笔记");
      await onTreeChanged();
      onOpenNote(path);
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
      const target = await backend.renamePath(item.path, n);
      await onTreeChanged();
      if (currentPath === item.path) onOpenNote(target);
    },
    onDelete: async (path) => {
      armDelete(null);
      const wasCurrent =
        currentPath === path ||
        currentPath?.startsWith(path + "/") ||
        currentPath?.startsWith(path + "\\");
      await backend.deletePath(path);
      await onTreeChanged();
      if (wasCurrent) await props.onDeletedCurrent();
    },
    onArmDelete: armDelete,
  };

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r"
      style={{ background: "var(--paper-side)", borderColor: "var(--line)" }}
    >
      {/* 库标题 */}
      <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-stone-400">{I.folder}</span>
          <span className="truncate text-[13px] font-medium text-stone-700" title={vaultName ?? ""}>
            {vaultName ?? "…"}
          </span>
        </div>
        {props.canPickVault && (
          <button
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-600"
            title="切换笔记库文件夹"
            onClick={props.onPickVault}
          >
            {I.folderPlus}
          </button>
        )}
      </div>

      {/* 搜索 */}
      <div className="px-3 pb-2 pt-1">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400">
            {I.search}
          </span>
          <input
            className="w-full rounded-md border border-stone-300/80 bg-white/70 py-1.5 pl-8 pr-2 text-[13px] outline-none transition-colors placeholder:text-stone-400 focus:border-amber-700/50 focus:bg-white"
            placeholder="搜索笔记…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 主体：搜索结果 或 文件树 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {hits !== null ? (
          <div className="px-1.5">
            {hits.length === 0 && (
              <p className="px-1 py-4 text-center text-xs text-stone-400">没有找到「{query}」</p>
            )}
            {hits.map((h) => (
              <button
                key={h.path}
                className="tree-row block w-full rounded-md px-2 py-1.5 text-left hover:bg-stone-200/60"
                onClick={() => handlers.onOpenNote(h.path)}
              >
                <div className="truncate text-[13px] text-stone-700">{h.title}</div>
                <div className="truncate text-[11px] text-stone-400">{h.snippet}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            {newFolderMode && (
              <InlineInputRow
                initial=""
                placeholder="新文件夹名称，回车创建"
                onCommit={async (v) => {
                  setNewFolderMode(false);
                  if (v.trim()) {
                    await backend.createFolder("", v.trim());
                    await onTreeChanged();
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
          </>
        )}
      </div>

      {/* 底部新建 */}
      <div className="flex gap-1.5 border-t border-stone-200 p-2.5">
        <button
          className="btn-outline flex-1 justify-center !py-1"
          onClick={() => void handlers.onNewNote("")}
        >
          {I.plus} 新笔记
        </button>
        <button
          className="btn-outline justify-center !py-1"
          title="新建文件夹"
          onClick={() => setNewFolderMode((v) => !v)}
        >
          {I.folderPlus}
        </button>
      </div>
    </aside>
  );
}
