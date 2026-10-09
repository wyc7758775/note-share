// "[[" 呼出笔记链接菜单：模糊搜索已有笔记插入 [[笔记名]]；
// 没有匹配时回车直接创建新笔记（在当前笔记的同级文件夹），Obsidian 式双链体验。
// 不用 @tiptap/suggestion：它的触发正则要求字符前是空白/行首，"[" 前是 "[" 永远不匹配。
// 自实现：监听文本输入，检测第二个 "[" 激活；query 直接从文档读（光标到 "[[" 之间的文本），
// 退格/输入天然同步。
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createRoot } from "react-dom/client";
import { useState } from "react";

export interface NoteEntry {
  name: string; // 不含 .md
  path: string;
}

export interface WikiItem {
  kind: "note" | "create";
  name: string;
  path?: string;
}

interface Active {
  from: number; // 第一个 "[" 的位置
}

export function createWikiLinkMenu(
  getNotes: () => NoteEntry[],
  onPick: (editor: any, item: WikiItem) => void
) {
  return Extension.create({
    name: "wikiLinkMenu",
    addProseMirrorPlugins() {
      const editor = this.editor;
      let active: Active | null = null;
      let root: ReturnType<typeof createRoot> | null = null;
      let container: HTMLDivElement | null = null;
      let keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

      const close = () => {
        active = null;
        keyHandler = null;
        root?.unmount();
        root = null;
        container?.remove();
        container = null;
      };

      /** 当前过滤词：两个 "[" 之后到光标的文本 */
      const queryOf = (view: any): string | null => {
        if (!active) return null;
        const to = view.state.selection.from;
        if (to < active.from + 2) return null; // "[" 已被删掉
        const q = view.state.doc.textBetween(active.from + 2, to, "\n");
        if (q.includes("\n")) return null; // 跨段落：关闭
        return q;
      };

      const itemsOf = (query: string): WikiItem[] => {
        const q = query.trim().toLowerCase();
        const list: WikiItem[] = getNotes()
          .filter((n) => !q || n.name.toLowerCase().includes(q))
          .map((n) => ({ kind: "note", name: n.name, path: n.path }));
        if (query.trim()) list.push({ kind: "create", name: query.trim() });
        return list.slice(0, 8);
      };

      const openMenu = (view: any) => {
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        renderMenu(view);
      };

      const renderMenu = (view: any) => {
        if (!root || !active) return;
        const query = queryOf(view) ?? "";
        const coords = view.coordsAtPos(view.state.selection.from);
        root.render(
          <WikiLinkList
            items={itemsOf(query)}
            clientRect={() =>
              DOMRect.fromRect({ x: coords.left, y: coords.bottom, width: 0, height: 0 })
            }
            registerKeyHandler={(h) => (keyHandler = h)}
            onClose={close}
            onPickItem={(item) => {
              const to = view.state.selection.from;
              const from = active!.from;
              close();
              editor
                .chain()
                .focus()
                .deleteRange({ from, to })
                .run();
              onPick(editor, item);
            }}
          />
        );
      };

      return [
        new Plugin({
          key: new PluginKey("wikiLinkMenu$"),
          view() {
            return {
              update(view, prevState) {
                if (!active) return;
                // 光标移出范围（点击别处 / 全选删除）→ 关闭
                const moved =
                  view.state.selection.from !== prevState.selection.from &&
                  view.state.selection.from < active.from;
                if (moved || queryOf(view) === null) {
                  close();
                  return;
                }
                renderMenu(view);
              },
              destroy() {
                close();
              },
            };
          },
          props: {
            handleTextInput(view: any, from: number, _to: number, text: string) {
              if (text !== "[") {
                // 普通输入：下一帧重渲染菜单（query 从文档读）
                if (active) requestAnimationFrame(() => renderMenu(view));
                return false;
              }
              const before = view.state.doc.textBetween(Math.max(0, from - 1), from);
              if (!active && before === "[") {
                active = { from: from - 1 };
                requestAnimationFrame(() => {
                  if (active) openMenu(view);
                });
              }
              return false; // "[" 照常插入
            },
            handleKeyDown(view: any, e: KeyboardEvent) {
              if (!active) return false;
              if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) {
                const handled = keyHandler?.(e) ?? false;
                if (handled) e.preventDefault();
                return handled;
              }
              if (e.key === "Backspace") {
                // 让编辑器先删；view.update 里重渲染/关闭
                requestAnimationFrame(() => {
                  if (!active) return;
                  if (queryOf(view) === null) close();
                  else renderMenu(view);
                });
                return false;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}

function WikiLinkList({
  items,
  clientRect,
  registerKeyHandler,
  onPickItem,
  onClose,
}: {
  items: WikiItem[];
  clientRect: () => DOMRect | undefined;
  registerKeyHandler: (h: ((e: KeyboardEvent) => boolean) | null) => void;
  onPickItem: (item: WikiItem) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);

  registerKeyHandler((e) => {
    if (e.key === "ArrowDown") {
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return true;
    }
    if (e.key === "ArrowUp") {
      setIndex((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === "Enter") {
      if (items[index]) onPickItem(items[index]);
      return true;
    }
    if (e.key === "Escape") {
      onClose();
      return true;
    }
    return false;
  });

  const rect = clientRect?.();
  const style: React.CSSProperties = rect
    ? {
        left: Math.min(rect.left, window.innerWidth - 280),
        top: Math.min(rect.bottom + 6, window.innerHeight - 40 - items.length * 44),
      }
    : { visibility: "hidden" };

  if (!items.length) return null;

  return (
    <div className="slash-menu wiki-menu" style={style}>
      {items.map((it, i) => (
        <button
          key={it.kind + it.name}
          className={`slash-item ${i === index ? "slash-item-active" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // 不让编辑器失焦
            onPickItem(it);
          }}
        >
          <span className="slash-icon">{it.kind === "create" ? "＋" : "📄"}</span>
          <span className="slash-text">
            <span className="slash-title">
              {it.kind === "create" ? (
                <>
                  创建「{it.name}」<span className="wiki-create-hint">（当前文件夹）</span>
                </>
              ) : (
                it.name
              )}
            </span>
            <span className="slash-desc">
              {it.kind === "note" ? it.path : "新建笔记并插入链接"}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
