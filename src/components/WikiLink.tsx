// [[笔记名]] 双链节点：编辑器里渲染为可点击链接（不显示括号原文本），点击跳转目标笔记。
// 磁盘格式保持 Obsidian 的 [[名字]]；进出编辑器走 forEditor/forSave 的链接伪装互转。
import { Node, mergeAttributes } from "@tiptap/core";
import { safeDecode } from "../lib/markdown";

/** forEditor 把 [[x]] 伪装成 markdown 链接时用的 href 前缀 */
export const WIKILINK_PREFIX = "noteshare-wikilink:";

/** 跳转到某篇笔记的事件（detail = vault 相对路径） */
export const OPEN_NOTE_EVENT = "noteshare:open-note";
export function emitOpenNote(path: string) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_EVENT, { detail: path }));
}

export const Wikilink = Node.create({
  name: "wikilink",
  inline: true,
  group: "inline",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => safeDecode(el.getAttribute("href")?.slice(WIKILINK_PREFIX.length) ?? el.textContent ?? ""),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `a[href^="${WIKILINK_PREFIX}"]`,
        getAttrs: (el) => ({ name: safeDecode((el as HTMLElement).getAttribute("href")!.slice(WIKILINK_PREFIX.length)) }),
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, {
        class: "wikilink",
        "data-name": node.attrs.name,
      }),
      node.attrs.name,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`[[${node.attrs.name}]]`);
        },
        parse: {},
      },
    };
  },
});
