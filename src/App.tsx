import { useCallback, useEffect, useState } from "react";
import { backend, type TreeNode } from "./backend";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import EmptyState from "./components/EmptyState";

export default function App() {
  const [vaultName, setVaultName] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  // sessionKey：打开"另一篇"笔记时自增以重建编辑器；重命名当前笔记时不自增
  const [session, setSession] = useState<{ path: string; key: number } | null>(null);

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

  const openNote = (path: string) => {
    setSession((s) => (s && s.path === path ? s : { path, key: (s?.key ?? 0) + 1 }));
  };

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
      <Sidebar
        vaultName={vaultName}
        tree={tree}
        currentPath={session?.path ?? null}
        onOpenNote={openNote}
        onTreeChanged={refreshTree}
        onDeletedCurrent={handleDeleted}
        onPickVault={pickVault}
        canPickVault={backend.mode === "tauri"}
      />
      <main className="flex-1 overflow-hidden">
        {vaultName === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-stone-500">
            <div className="serif text-2xl text-stone-700">NoteShare</div>
            <p className="text-sm">还没有选择笔记库文件夹</p>
            <button className="btn-primary" onClick={pickVault}>
              选择文件夹（可用已有的 Obsidian 库）
            </button>
          </div>
        ) : session ? (
          <Editor
            key={session.key}
            initialPath={session.path}
            onRenamed={handleRenamed}
            onDeleted={handleDeleted}
          />
        ) : (
          <EmptyState
            vaultName={vaultName}
            onNewNote={async () => {
              const path = await backend.createNote("", "未命名笔记");
              openNote(path);
            }}
          />
        )}
      </main>
    </div>
  );
}
