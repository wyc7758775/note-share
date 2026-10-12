// [[笔记名]] 双链节点：编辑器里渲染为可点击链接（不显示括号原文本），点击跳转目标笔记。
// 磁盘格式保持 Obsidian 的 [[名字]]；进出编辑器走 forEditor/forSave 的链接伪装互转。
// 目标笔记不存在时（被删）：渲染即检测并标记缺失样式，悬停提示"点击创建"，点击重建。
import { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { backend } from "../backend";
import { useSettings } from "../i18n";
import { parseNote } from "../lib/frontmatter";
import { previewLine } from "../domain/note";
import { safeDecode } from "../lib/markdown";
import { useDomain, useDirectoryVersion } from "../domain/provider";

/** forEditor 把 [[x]] 伪装成 markdown 链接时用的 href 前缀 */
export const WIKILINK_PREFIX = "noteshare-wikilink:";

/** 跳转到某篇笔记的事件；newTab = Ctrl/⌘+点击（当前栏新标签）、
 *  newPane = Ctrl+Shift+点击（新栏）；导航类交互，保留 window 事件 */
export const OPEN_NOTE_EVENT = "noteshare:open-note";
export function emitOpenNote(path: string, opts?: { newTab?: boolean; newPane?: boolean }) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTE_EVENT, { detail: { path, ...opts } }));
}

// ---- 悬停预览卡（前 4 行，带内存缓存；行清理复用领域层 previewLine） ----

const previewCache = new Map<string, string[]>();

export function WikiPreviewCard({
  name,
  path,
  top,
  left,
  missing,
}: {
  name: string;
  path: string | null;
  top: number;
  left: number;
  missing?: boolean;
}) {
  const { t } = useSettings();
  const [lines, setLines] = useState<string[] | null>(
    missing || !path ? [] : previewCache.get(path) ?? null
  );

  // 注意：early return 必须放在所有 hook 之后，否则 missing 状态变化时 hook 数量不一致
  useEffect(() => {
    if (lines || !path) return;
    let dead = false;
    void (async () => {
      const out: string[] = [];
      try {
        const { raw } = await backend.readNote(path);
        const { body } = parseNote(raw);
        for (const l0 of body.split("\n")) {
          const l = previewLine(l0);
          if (!l || l === "---" || l.startsWith("```")) continue;
          out.push(l);
          if (out.length >= 4) break;
        }
      } catch {
        /* 读不到就空卡 */
      }
      previewCache.set(path, out);
      if (!dead) setLines(out);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (missing) {
    return (
      <div
        className="wiki-preview"
        style={{ top, left: Math.max(8, Math.min(left, window.innerWidth - 330)) }}
      >
        <div className="wiki-preview-title">{name}</div>
        <div className="wiki-preview-line text-faint">{t("wikilinkMissingCard")}</div>
      </div>
    );
  }

  return (
    <div
      className="wiki-preview"
      style={{ top, left: Math.max(8, Math.min(left, window.innerWidth - 330)) }}
    >
      <div className="wiki-preview-title">{name}</div>
      {lines === null ? (
        <div className="wiki-preview-line text-faint">…</div>
      ) : lines.length ? (
        lines.map((l, i) => (
          <div key={i} className="wiki-preview-line">
            {l}
          </div>
        ))
      ) : (
        <div className="wiki-preview-line text-faint">（空）</div>
      )}
    </div>
  );
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

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView);
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

/** 节点视图：渲染初始化时即向名录解析目标存在性（名录变化时重检），缺失标记样式。
 *  悬停提示统一走预览卡（missing 态在卡内提示），不再另设 data-tip 气泡。 */
function WikiLinkView({ node }: any) {
  const { directory } = useDomain();
  useDirectoryVersion(); // 名录任何变化触发重渲染
  const name = String(node.attrs.name ?? "");
  // Home 节点引用（Home#^id）不走名录解析，永远视为有效
  const missing = !/^Home#\^/.test(name) && directory.resolve(name).kind === "dangling";
  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${missing ? "wikilink-missing" : ""}`}
      data-name={name}
      data-missing={missing ? "1" : undefined}
    >
      {name}
    </NodeViewWrapper>
  );
}
