// 大纲条目的 NodeView（Workflowy 交互规格）：
// - 行左：折叠箭头（仅父条目，叠在缩进空间里，25% 透明度、悬停行时全亮、展开时旋转 90°）
// - 圆点：18px 命中区 + 7px 圆点；整行悬停时淡入（0.2s）；点击 = 缩放进入；拖动 = 移动子树
// - 折叠条目的圆点常显并带灰色 halo（Workflowy 的折叠提示）
// - 行尾 ⋯：悬停显示，点开条目菜单（完成/缩放/复制引用/转为笔记/删除）
// - 备注 = 条目内第 2+ 个段落（13px 灰，样式在 CSS）
import { useEffect, useReducer } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useDomain } from "../../domain/provider";
import { useSettings } from "../../i18n";
import { backend } from "../../backend";
import { subtreeMarkdown } from "../../outline/parse";
import { showContextMenu } from "../ContextMenu";
import { emitOpenNote } from "../WikiLink";
import {
  NODE_MIME,
  OUTLINE_META_KEY,
  collectOutlineTags,
  getActiveOutlineController,
  itemAddressAt,
  itemHasTag,
  outlineStructureKey,
  toggleTagCommand,
  withFlip,
} from "./outlineKit";

export function OutlineItemView({ node, getPos, editor }: NodeViewProps) {
  const { outline, notes } = useDomain();
  const { t } = useSettings();
  const done = !!node.attrs.checked;
  // tiptap 在"仅 decoration 变"时不重渲染 React 节点视图：
  // 监听结构事务（zoom/折叠/搜索）与文档变化（itemPos 失效）自行重渲染
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const onTr = (props: { transaction: { getMeta: (k: string) => unknown; docChanged: boolean } }) => {
      const tr = props.transaction;
      if (tr.getMeta(OUTLINE_META_KEY) || tr.docChanged) forceUpdate();
    };
    editor.on("transaction", onTr as never);
    return () => {
      editor.off("transaction", onTr as never);
    };
  }, [editor]);

  const itemPos = typeof getPos === "function" ? (getPos() as number | undefined) : undefined;
  const pos = typeof itemPos === "number" ? itemPos : null;
  const st = outlineStructureKey.getState(editor.state);
  const collapsedNow = pos != null && !!st?.collapsed.includes(pos);
  const hasChildren = (() => {
    let hit = false;
    node.forEach((c) => {
      if (c.type.name === "taskList") hit = true;
    });
    return hit;
  })();

  const classes = ["outline-item"];
  if (done) classes.push("is-done");
  if (st && pos != null) {
    if (collapsedNow) classes.push("outline-collapsed-item");
    if (st.zoomPos === pos) classes.push("outline-zoom-root");
    if (st.zoomAncestors.has(pos)) classes.push("outline-ancestor");
    // 缩放态祖先保留壳显示（首段由插件装饰隐藏）；其余不在可见集的条目整条隐藏
    if (st.visible && !st.visible.has(pos) && !st.zoomAncestors.has(pos))
      classes.push("outline-hidden");
    // ⋯ 菜单打开：目标条目整块（含展开子树）高亮
    if (st.hlPos === pos) classes.push("outline-menu-hl");
  }

  const address = () => (pos == null ? null : itemAddressAt(editor.state.doc, pos));

  const openMenu = (e: React.MouseEvent, x?: number, y?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const ctl = getActiveOutlineController();
    // Workflowy：菜单打开期间该条目 + 当前展开的子树整块高亮，关闭即熄灭。
    // 先弹菜单（内部先销毁上一个菜单、触发其清高亮回调），再点亮本行，避免误清新高亮
    showContextMenu(
      x ?? e.clientX,
      y ?? e.clientY,
      [
      {
        label: t(done ? "homeMarkUndo" : "homeMarkDone"),
        onClick: () => {
          if (pos == null) return;
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !done })
          );
        },
      },
      {
        label: t("homeZoomHere"),
        disabled: pos == null,
        onClick: () => ctl?.zoomTo(pos ?? null),
      },
      { separator: true },
      {
        label: t("homeCopyRef"),
        onClick: () => {
          const a = address();
          if (!a) return;
          void outline.ensureBlockId(a).then((id) => {
            if (id) void navigator.clipboard.writeText(`[[Home#^${id}]]`);
          });
        },
      },
      {
        label: t("homeToNote"),
        onClick: () => {
          const a = address();
          if (!a) return;
          void (async () => {
            await outline.flush();
            const sub = outline.subtreeAt(a);
            if (!sub) return;
            const title = (sub.text.split("\n")[0] ?? "").trim().slice(0, 40) || t("untitledNote");
            const path = await notes.create(title);
            if (!path) return;
            await backend.writeNote(path, subtreeMarkdown(sub));
            emitOpenNote(path, { newTab: true });
          })();
        },
      },
      { separator: true },
      {
        label: t("homeDeleteItem"),
        danger: true,
        onClick: () => {
          if (pos == null) return;
          withFlip(editor, () =>
            editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize))
          );
        },
      },
      // tag 选择区（Workflowy Turn into）：列出大纲已用的 #tag，勾选即时加上/去掉
      ...(pos == null
        ? []
        : (() => {
            const tags = collectOutlineTags(editor);
            return tags.length
              ? [
                  { separator: true as const },
                  ...tags.map((tg) => ({
                    label: `#${tg}`,
                    checked: itemHasTag(node, tg),
                    keepOpen: true as const,
                    onClick: () => toggleTagCommand(editor, pos, tg),
                  })),
                ]
              : [];
          })()),
      ],
      () => ctl?.setHighlight(null)
    );
    if (pos != null) ctl?.setHighlight(pos);
  };

  return (
    <NodeViewWrapper as="li" className={classes.join(" ")}>
      <button
        className="outline-item-menu"
        contentEditable={false}
        data-tip={t("more")}
        onClick={openMenu}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3.4" cy="8" r="1.35" />
          <circle cx="8" cy="8" r="1.35" />
          <circle cx="12.6" cy="8" r="1.35" />
        </svg>
      </button>
      {hasChildren && (
        <button
          className="outline-arrow"
          contentEditable={false}
          data-tip={t("homeToggleCollapse")}
          onClick={(e) => {
            e.preventDefault();
            if (pos != null) getActiveOutlineController()?.toggleCollapse(pos);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M13.75 9.57a.5.5 0 0 1 0 .87l-5.25 3.03a.5.5 0 0 1-.75-.43V7.97a.5.5 0 0 1 .75-.43l5.25 3.03z" />
          </svg>
        </button>
      )}
      <span
        className="outline-bullet"
        contentEditable={false}
        draggable
        data-tip={t("homeZoomHere")}
        onDragStart={(e) => {
          if (pos == null) return;
          // 空条目不参与拖放：拖空壳、或把子级塞进空壳，都只会制造无意义的嵌套空层
          if (!node.textContent.trim()) {
            e.preventDefault();
            return;
          }
          // 同带树地址：除了大纲内部重排（pos），还能跨视图拖进笔记成嵌入（address）
          e.dataTransfer.setData(
            NODE_MIME,
            JSON.stringify({ source: "home", pos, address: address() ?? undefined })
          );
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={(e) => {
          e.preventDefault();
          if (pos != null) getActiveOutlineController()?.zoomTo(pos);
        }}
        onContextMenu={openMenu}
      >
        <span className="outline-bullet-halo">
          <span className="outline-bullet-dot" />
        </span>
      </span>
      <NodeViewContent className="outline-content" />
    </NodeViewWrapper>
  );
}
