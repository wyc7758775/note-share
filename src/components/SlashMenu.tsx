// "/" 斜杠命令菜单：输入 / 呼出，继续输入过滤，↑↓ 选择，回车执行，Esc 关闭
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { createRoot } from "react-dom/client";
import { useState } from "react";

export interface SlashItem {
  title: string;
  desc: string;
  icon: string;
  keywords?: string;
  onSelect: (ctx: { editor: any; range: any }) => void;
}

/** items 用 getter：每次呼出菜单时重新取词，语言切换无需重建编辑器 */
export function createSlashMenu(items: () => SlashItem[]) {
  return Extension.create<{ items: () => SlashItem[] }>({
    name: "slashMenu",
    addOptions() {
      return { items };
    },
    addProseMirrorPlugins() {
      const getItems = this.options.items;
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          startOfLine: false,
          allowSpaces: false,
          items: ({ query }) => {
            const q = query.toLowerCase();
            return getItems().filter((it) =>
              (it.title + (it.keywords ?? "")).toLowerCase().includes(q)
            );
          },
          command: ({ editor, range, props: item }: any) => {
            (item as SlashItem).onSelect({ editor, range });
          },
          render: () => {
            let root: ReturnType<typeof createRoot> | null = null;
            let container: HTMLDivElement | null = null;
            let keyHandler: ((e: KeyboardEvent) => boolean) | null = null;

            const close = () => {
              keyHandler = null;
              root?.unmount();
              root = null;
              container?.remove();
              container = null;
            };

            return {
              onStart: (props: any) => {
                container = document.createElement("div");
                document.body.appendChild(container);
                root = createRoot(container);
                root.render(
                  <SlashMenuList
                    items={props.items}
                    command={props.command}
                    clientRect={props.clientRect}
                    registerKeyHandler={(h) => (keyHandler = h)}
                  />
                );
              },
              onUpdate: (props: any) => {
                root?.render(
                  <SlashMenuList
                    items={props.items}
                    command={props.command}
                    clientRect={props.clientRect}
                    registerKeyHandler={(h) => (keyHandler = h)}
                  />
                );
              },
              onKeyDown: ({ event }: any) => keyHandler?.(event) ?? false,
              onExit: () => close(),
            };
          },
        }),
      ];
    },
  });
}

function SlashMenuList({
  items,
  command,
  clientRect,
  registerKeyHandler,
}: {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  clientRect: () => DOMRect | undefined;
  registerKeyHandler: (h: ((e: KeyboardEvent) => boolean) | null) => void;
}) {
  const [index, setIndex] = useState(0);

  registerKeyHandler((e) => {
    if (e.key === "ArrowDown") {
      setIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return true;
    }
    if (e.key === "ArrowUp") {
      setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return true;
    }
    if (e.key === "Enter") {
      if (items[index]) command(items[index]);
      return true;
    }
    return false;
  });

  const rect = clientRect?.();
  const style: React.CSSProperties = rect
    ? {
        left: Math.min(rect.left, window.innerWidth - 240),
        top: Math.min(rect.bottom + 6, window.innerHeight - 40 - items.length * 52),
      }
    : { visibility: "hidden" };

  if (!items.length) return null;

  return (
    <div className="slash-menu" style={style}>
      {items.map((it, i) => (
        <button
          key={it.title}
          className={`slash-item ${i === index ? "slash-item-active" : ""}`}
          onMouseEnter={() => setIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // 不让编辑器失焦
            command(it);
          }}
        >
          <span className="slash-icon">{it.icon}</span>
          <span className="slash-text">
            <span className="slash-title">{it.title}</span>
            <span className="slash-desc">{it.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
