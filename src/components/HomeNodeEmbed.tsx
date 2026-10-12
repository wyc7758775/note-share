// Home 节点嵌入（笔记正文里的实时子树卡片）：
// 磁盘格式 ![[Home#^块id]]，进出编辑器经 markdown.ts 伪装成 img 互转。
// NodeView 订阅 OutlineStore：Home 里改动实时同步；节点被删显示缺失态。
// 点击头部跳转 Home 并缩放到该节点。
import type { ReactNode } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useDomain, useOutlineVersion } from "../domain/provider";
import { currentLang, translate } from "../i18n";
import { HOME_EMBED_PREFIX } from "../lib/markdown";
import { requestOpenHome, requestZoomHome } from "../outline/home-bus";
import type { OutlineNode } from "../outline/parse";

export const HomeEmbed = Node.create({
  name: "homeEmbed",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("src")?.startsWith(HOME_EMBED_PREFIX)
            ? element.getAttribute("src")!.slice(HOME_EMBED_PREFIX.length)
            : null,
      },
    };
  },

  parseHTML() {
    // 优先级高于 CustomImage 的通用 img 规则
    return [{ tag: `img[src^="${HOME_EMBED_PREFIX}"]`, priority: 60 }];
  },

  renderHTML({ node }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, {
        src: HOME_EMBED_PREFIX + (node.attrs.ref ?? ""),
        alt: "Home",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(HomeEmbedView);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`![[Home#^${node.attrs.ref ?? ""}]]`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** 子树 → 只读嵌套列表（树直渲，不经 markdown：勾选框/层级/删除线都自己控制） */
function renderOutlineTree(node: OutlineNode): ReactNode {
  const [head, ...rest] = node.text.split("\n");
  return (
    <li key={node.address.join("/")}>
      <span className={`home-embed-line${node.done ? " is-done" : ""}`}>
        <span className={`home-embed-box${node.done ? " on" : ""}`} />
        {head}
        {rest.length > 0 && <span className="home-embed-more"> …</span>}
      </span>
      {node.children.length > 0 && (
        <ul>{node.children.map((c) => renderOutlineTree(c))}</ul>
      )}
    </li>
  );
}

function HomeEmbedView({ node, selected }: NodeViewProps) {
  const { outline } = useDomain();
  useOutlineVersion(); // Home 任何变化实时刷新嵌入内容
  const ref = (node.attrs.ref as string | null) ?? null;
  const sub = ref ? outline.nodeById(ref) : null;
  const crumb = ref ? outline.breadcrumbById(ref) : null;

  if (!ref || !sub) {
    return (
      <NodeViewWrapper className={`home-embed is-missing${selected ? " is-selected" : ""}`}>
        <span className="text-faint">{translate(currentLang(), "homeEmbedMissing")}</span>
        <code className="home-embed-ref">![[Home#^{ref ?? "…"}]]</code>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={`home-embed${selected ? " is-selected" : ""}`}>
      <div className="home-embed-head" contentEditable={false}>
        <span className="home-embed-path" title={(crumb ?? ["Home"]).join(" / ")}>
          {(crumb ?? ["Home"]).join(" / ")}
        </span>
        <button
          className="home-embed-open"
          onClick={() => {
            requestOpenHome();
            requestZoomHome({ blockId: ref });
          }}
        >
          {translate(currentLang(), "homeEmbedOpen")}
        </button>
      </div>
      <ul className="home-embed-body" contentEditable={false}>
        {renderOutlineTree(sub)}
      </ul>
    </NodeViewWrapper>
  );
}
