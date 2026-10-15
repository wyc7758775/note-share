// Home 大纲的 TipTap 扩展集：
//   OutlineItem   —— TaskItem 变体（blockId 属性 + Workflowy 圆点 NodeView + ^id 序列化）
//   OutlineStructure —— zoom/折叠/搜索的节点可见性（node decoration 隐藏），位置随事务映射
//   OutlineKeys   —— Alt+↑↓ 移动条目、Ctrl+Enter 完成、Esc 逐级退出
//   OutlineTags   —— #tag 行内高亮
// 可见性方案：整个文档始终是同一棵 ProseMirror 树，zoom/搜索/折叠只是把
// 不相关的 taskItem（或其正文段落）加 display:none 装饰——命令、撤销、拖拽
// 都工作在真实文档上，无需切片回填。
import { Extension, InputRule, type Editor } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-task-item";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { OutlineItemView } from "./OutlineItemView";
import { isDateText, monthOfText } from "./homeViews";

/** 大纲节点拖拽的 dataTransfer 类型（Home 内重排 / 侧栏搜索行共用） */
export const NODE_MIME = "application/x-noteshare-home-node";

// ---------------- zoom / 折叠 / 搜索 ----------------

export interface OutlinePluginState {
  zoomPos: number | null;
  collapsed: number[];
  query: string | null;
  /** Ctrl+O：隐藏已完成条目（Workflowy 同款） */
  hideCompleted: boolean;
  decos: DecorationSet;
  /** 查询/缩放/隐藏完成模式下的可见条目位置集（null = 全部可见）；NodeView 据此算 outline-hidden */
  visible: Set<number> | null;
  /** 缩放目标的祖先条目位置集（NodeView 据此算 outline-ancestor） */
  zoomAncestors: Set<number>;
  /** 条目菜单（⋯）打开的目标条目位置（NodeView 据此算 outline-menu-hl 整块高亮） */
  hlPos: number | null;
}

export const outlineStructureKey = new PluginKey<OutlinePluginState>("outlineStructure");
const OUTLINE_META = "outlineStructure:set";
/** 结构变化事务的 meta 键：NodeView 监听它自行重渲染（tiptap 在"仅 decoration 变"时不重渲染 React 节点视图） */
export const OUTLINE_META_KEY = OUTLINE_META;

/** item 起始位置随事务映射；映射后不再是 taskItem 起点则返回 null（被删/被并） */
function mapItemPos(tr: Transaction, pos: number): number | null {
  const mapped = tr.mapping.map(pos, -1);
  try {
    const after = tr.doc.resolve(mapped).nodeAfter;
    return after?.type.name === "taskItem" ? mapped : null;
  } catch {
    return null;
  }
}

/** 条目的删除区间：它是所在列表唯一子级、且该列表是嵌套列表时，整表一起删。
 *  只删最后一项会留下空 taskList，违反 content: "taskItem+" 约束，
 *  PM 的 fitter 会在空列表里回填一个默认空条目——"删完多出空节点"的来源。
 *  顶层列表是文档骨架：删最后一项保留 PM 的回填（大纲至少留一条，官方同款）。 */
export function itemDeleteRange(doc: PMNode, pos: number): { from: number; to: number } {
  const node = doc.nodeAt(pos);
  const $ = doc.resolve(pos);
  const parent = $.parent;
  if (
    node &&
    parent.type.name === "taskList" &&
    parent.childCount === 1 &&
    $.depth >= 2 &&
    $.node($.depth - 1).type.name === "taskItem"
  ) {
    const listFrom = pos - 1; // 列表 open token
    return { from: listFrom, to: listFrom + parent.nodeSize };
  }
  return { from: pos, to: pos + (node?.nodeSize ?? 0) };
}

/** 条目被删除/移动时修正缩放状态，meta 必须骑在同一事务上：
 *  - 纯删除（newNodeStart=null）：缩放根在被删区间内 → 落回被删条目的父级
 *    （否则映射会漂到邻居条目上，视图跳到无关节点）
 *  - 移动（newNodeStart=节点在最终文档的新起点）：缩放根跟节点走 */
export function fixZoomOnRemoval(
  tr: Transaction,
  state: EditorState,
  pos: number,
  size: number,
  newNodeStart: number | null
): void {
  const z = outlineStructureKey.getState(state)?.zoomPos ?? null;
  if (z == null || z < pos || z >= pos + size) return;
  if (newNodeStart != null) {
    tr.setMeta(OUTLINE_META, { zoomPos: newNodeStart + (z - pos) });
    return;
  }
  const $ = state.doc.resolve(pos);
  for (let d = $.depth - 1; d > 0; d--) {
    if ($.node(d).type.name === "taskItem") {
      tr.setMeta(OUTLINE_META, { zoomPos: $.before(d) });
      return;
    }
  }
  tr.setMeta(OUTLINE_META, { zoomPos: null });
}

function itemTitle(node: PMNode): string {
  const first = node.childCount ? node.child(0) : null;
  const text = first?.textContent ?? "";
  return text.split("\n")[0]?.trim() || "…";
}

/** 条目自身文本（首段，不含嵌套子树——textContent 会带出全部后代，搜索匹配必须用它） */
function itemOwnText(node: PMNode): string {
  const first = node.childCount ? node.child(0) : null;
  return first?.textContent ?? "";
}

/** 结构计算：可见集 + 缩放祖先集（NodeView 据此派生类名）+ 段落隐藏装饰。
 *  taskItem 上不放 node 装饰——PM 的 updateOuterDeco 会整体重写 class 属性，
 *  与 React NodeView 的 className 相互覆盖；条目可见性全部走 React 状态派生。 */
function computeStructure(
  doc: PMNode,
  s: Omit<OutlinePluginState, "decos" | "visible" | "zoomAncestors">
): Pick<OutlinePluginState, "decos" | "visible" | "zoomAncestors"> {
  const decos: Decoration[] = [];
  const hasQuery = !!s.query;

  /** 应用"隐藏已完成"：从可见集中剔除已完成条目（可见集为 null 时先收集全部） */
  const applyHideCompleted = (visible: Set<number> | null, keepRoot = -1): Set<number> | null => {
    if (!s.hideCompleted) return visible;
    const base = visible ?? new Set<number>();
    if (!visible) {
      doc.descendants((node, pos) => {
        if (node.type.name === "taskItem") base.add(pos);
        return true;
      });
    }
    doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && node.attrs.checked && pos !== keepRoot) {
        base.delete(pos);
      }
      return true;
    });
    return base;
  };

  if (hasQuery) {
    // 搜索模式：自身首段命中 + 命中项的祖先链可见，其余整条隐藏（折叠态自动展开）
    const needle = (s.query ?? "").toLowerCase();
    const visible = new Set<number>();
    doc.descendants((node, pos) => {
      if (node.type.name !== "taskItem") return true;
      if (itemOwnText(node).toLowerCase().includes(needle)) {
        visible.add(pos);
        const $ = doc.resolve(pos + 1);
        for (let d = $.depth; d > 0; d--) {
          if ($.node(d).type.name === "taskItem") visible.add($.before(d));
        }
      }
      return true;
    });
    return { decos: DecorationSet.empty, visible: applyHideCompleted(visible), zoomAncestors: new Set() };
  }

  if (s.zoomPos != null) {
    // 缩放模式：目标 + 后代可见；祖先只留壳；其余整条隐藏
    const z = s.zoomPos;
    const target = doc.nodeAt(z);
    if (!target || target.type.name !== "taskItem") {
      return { decos: DecorationSet.empty, visible: null, zoomAncestors: new Set() };
    }
    const visible = new Set<number>([z]);
    target.descendants((c, p) => {
      if (c.type.name === "taskItem") visible.add(z + 1 + p);
      return true;
    });
    const zoomAncestors = new Set<number>();
    const $z = doc.resolve(z + 1);
    for (let d = $z.depth - 1; d > 0; d--) {
      if ($z.node(d).type.name === "taskItem") zoomAncestors.add($z.before(d));
    }
    // 祖先壳的首段（正文）隐藏——段落无自定义节点视图，PM 渲染并可靠应用装饰类
    for (const apos of zoomAncestors) {
      const item = doc.nodeAt(apos);
      if (!item) continue;
      const first = item.childCount ? item.child(0) : null;
      if (first?.type.name === "paragraph") {
        const ppos = apos + 1;
        decos.push(Decoration.node(ppos, ppos + first.nodeSize, { class: "outline-hidden" }));
      }
    }
    return {
      decos: DecorationSet.create(doc, decos),
      visible: applyHideCompleted(visible, z),
      zoomAncestors,
    };
  }

  return { decos: DecorationSet.empty, visible: applyHideCompleted(null), zoomAncestors: new Set() };
}

function outlineStructurePlugin() {
  return new Plugin<OutlinePluginState>({
    key: outlineStructureKey,
    state: {
      init: (_, state): OutlinePluginState => {
        const base = {
          zoomPos: null,
          collapsed: [] as number[],
          query: null,
          hideCompleted: false,
          hlPos: null as number | null,
        };
        return { ...base, ...computeStructure(state.doc, base) };
      },
      apply(tr, prev): OutlinePluginState {
        const meta = tr.getMeta(OUTLINE_META) as
          | Partial<Omit<OutlinePluginState, "decos" | "visible" | "zoomAncestors">>
          | undefined;
        let base: Omit<OutlinePluginState, "decos" | "visible" | "zoomAncestors"> | null = null;
        if (tr.docChanged) {
          base = {
            zoomPos: prev.zoomPos != null ? mapItemPos(tr, prev.zoomPos) : null,
            collapsed: [
              ...new Set(
                prev.collapsed
                  .map((p) => mapItemPos(tr, p))
                  .filter((p): p is number => p != null)
              ),
            ],
            query: prev.query,
            hideCompleted: prev.hideCompleted,
            hlPos: prev.hlPos != null ? mapItemPos(tr, prev.hlPos) : null,
          };
        }
        if (meta) base = { ...(base ?? prev), ...meta };
        if (!base) return prev;
        return { ...base, ...computeStructure(tr.doc, base) };
      },
    },
    props: {
      decorations(state) {
        return outlineStructureKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
  });
}

export const OutlineStructure = Extension.create({
  name: "outlineStructure",
  addProseMirrorPlugins() {
    return [outlineStructurePlugin()];
  },
});

// ---------------- 控制器（HomeView / NodeView 共用的命令入口） ----------------

export interface OutlineCrumb {
  pos: number | null; // null = 根
  text: string;
}

export interface OutlineController {
  zoomTo(pos: number | null): void;
  zoomOut(): void;
  zoomToAddress(address: number[]): boolean;
  zoomToBlockId(id: string): boolean;
  toggleCollapse(pos: number): void;
  setQuery(q: string | null): void;
  collapseAll(): void;
  expandAll(): void;
  setHideCompleted(v: boolean): void;
  toggleHideCompleted(): void;
  isHideCompleted(): boolean;
  /** 条目菜单（⋯）目标高亮：菜单打开期间该条目整块（含展开子树）亮起 */
  setHighlight(pos: number | null): void;
  crumbs(): OutlineCrumb[];
}

export function createOutlineController(editor: Editor): OutlineController {
  const setMeta = (patch: Partial<Omit<OutlinePluginState, "decos">>) => {
    const tr = editor.state.tr.setMeta(OUTLINE_META, patch);
    editor.view.dispatch(tr);
  };
  const st = () => outlineStructureKey.getState(editor.state);

  return {
    zoomTo(pos) {
      setMeta({ zoomPos: pos, query: null });
    },
    zoomOut() {
      const z = st()?.zoomPos;
      if (z == null) return;
      // resolve(z+1) 进入目标条目内部；从这里往上找父级条目
      const $ = editor.state.doc.resolve(z + 1);
      for (let d = $.depth - 1; d > 0; d--) {
        if ($.node(d).type.name === "taskItem") {
          setMeta({ zoomPos: $.before(d) });
          return;
        }
      }
      setMeta({ zoomPos: null });
    },
    zoomToAddress(address) {
      const pos = itemPosAtAddress(editor.state.doc, address);
      if (pos == null) return false;
      setMeta({ zoomPos: pos, query: null });
      return true;
    },
    zoomToBlockId(id) {
      let hit: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (hit != null) return false;
        if (node.type.name === "taskItem" && node.attrs.blockId === id) {
          hit = pos;
          return false;
        }
        return true;
      });
      if (hit == null) return false;
      setMeta({ zoomPos: hit, query: null });
      return true;
    },
    toggleCollapse(pos) {
      const cur = st()?.collapsed ?? [];
      setMeta({
        collapsed: cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos],
      });
    },
    setQuery(q) {
      const needle = q?.trim().toLowerCase() || "";
      setMeta({ query: needle ? needle : null });
    },
    collapseAll() {
      const all: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "taskItem" && hasNestedList(node)) all.push(pos);
        return true;
      });
      setMeta({ collapsed: all });
    },
    expandAll() {
      setMeta({ collapsed: [] });
    },
    setHideCompleted(v) {
      setMeta({ hideCompleted: v });
    },
    toggleHideCompleted() {
      setMeta({ hideCompleted: !st()?.hideCompleted });
    },
    isHideCompleted() {
      return !!st()?.hideCompleted;
    },
    setHighlight(pos) {
      if (st()?.hlPos === pos) return;
      setMeta({ hlPos: pos });
    },
    crumbs() {
      const z = st()?.zoomPos ?? null;
      if (z == null) return [{ pos: null, text: "Workflowy" }];
      // resolve(z+1) 进入目标条目内部（resolve(z) 停在列表层，取不到条目祖先链）
      const $ = editor.state.doc.resolve(z + 1);
      const out: OutlineCrumb[] = [{ pos: null, text: "Workflowy" }];
      for (let d = 1; d <= $.depth; d++) {
        const n = $.node(d);
        if (n.type.name === "taskItem") out.push({ pos: $.before(d), text: itemTitle(n) });
      }
      return out;
    },
  };
}

/** Home 编辑器全局唯一（标签全局去重）；NodeView 经此拿控制器 */
let activeController: OutlineController | null = null;
export function setActiveOutlineController(c: OutlineController | null) {
  activeController = c;
}
export function getActiveOutlineController(): OutlineController | null {
  return activeController;
}

/** item 里的嵌套列表及其在 item 内的偏移（没有则 null） */
function nestedListOf(item: PMNode): { node: PMNode; off: number } | null {
  let off = 0;
  for (let i = 0; i < item.childCount; i++) {
    const n = item.child(i);
    if (n.type.name === "taskList") return { node: n, off };
    off += n.nodeSize;
  }
  return null;
}

function hasNestedList(node: PMNode): boolean {
  return nestedListOf(node) != null;
}

// ---------------- 地址 / 位置换算 ----------------

/** 包含 pos 的 taskItem 起始位置；不在任何条目内返回 null */
export function itemPosAround(doc: PMNode, pos: number): number | null {
  const $ = doc.resolve(pos);
  for (let d = $.depth; d > 0; d--) {
    if ($.node(d).type.name === "taskItem") return $.before(d);
  }
  return null;
}

/** 包含 pos 的条目的树地址（各层子下标） */
export function itemAddressAt(doc: PMNode, pos: number): number[] | null {
  let $ = doc.resolve(pos);
  // pos 恰是条目起点时祖先链不含自身（会误取父条目地址）：下探一步进条目内部
  if ($.nodeAfter?.type.name === "taskItem") $ = doc.resolve(pos + 1);
  for (let d = $.depth; d > 0; d--) {
    if ($.node(d).type.name === "taskItem") {
      const out: number[] = [];
      for (let e = d; e >= 1; e--) {
        if ($.node(e).type.name === "taskItem") out.unshift($.index(e - 1));
      }
      return out;
    }
  }
  return null;
}

/** 树地址 → 条目起始位置（与 outline/parse 的地址语义一致：按 taskItem 子下标下钻） */
export function itemPosAtAddress(doc: PMNode, address: number[]): number | null {
  let cur: PMNode | null = null;
  let curPos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const n = doc.child(i);
    if (n.type.name === "taskList") {
      cur = n;
      curPos = 0; // doc 内容从 0 起
      break;
    }
  }
  if (!cur) return null;
  for (let i = 0; i < address.length; i++) {
    const item = cur.maybeChild(address[i]);
    if (!item) return null;
    let childOff = 0;
    for (let k = 0; k < address[i]; k++) childOff += cur.child(k).nodeSize;
    const itemPos = curPos + 1 + childOff;
    if (i === address.length - 1) return itemPos;
    const nested = nestedListOf(item);
    if (!nested) return null;
    cur = nested.node;
    // itemPos 是条目自身位置，+1 越过 open token 才进内容区，再加 off 到嵌套列表
    curPos = itemPos + 1 + nested.off;
  }
  return null;
}

// ---------------- 键位与命令（对齐 Workflowy 官方快捷键表，Windows/Linux 桌面口径） ----------------

/** 光标所在条目的 {depth, start, node}；不在条目内返回 null */
function currentItem(editor: Editor): { depth: number; start: number; node: PMNode } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "taskItem") {
      return { depth: d, start: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}

/** Alt+Shift+↑/↓：条目（含子树）在同级内上下移动 */
function moveItemCommand(editor: Editor, dir: 1 | -1): boolean {
  const { state } = editor;
  const hit = currentItem(editor);
  if (!hit || hit.depth < 1) return false;
  const $from = state.selection.$from;
  const { depth, node } = hit;
  const start = hit.start;
  const end = start + node.nodeSize;
  const parent = $from.node(depth - 1); // taskList
  const index = $from.index(depth - 1);
  const tr = state.tr;
  if (dir < 0) {
    if (index === 0) return true; // 已在顶端：吞掉按键（Workflowy 同款）
    const prev = parent.child(index - 1);
    tr.delete(start, end);
    tr.insert(start - prev.nodeSize, node);
    fixZoomOnRemoval(tr, state, start, node.nodeSize, start - prev.nodeSize);
  } else {
    if (index >= parent.childCount - 1) return true;
    const next = parent.child(index + 1);
    tr.delete(start, end);
    // 删除后下一个兄弟滑到 start，要排它后面：插在 start + 兄弟长度
    tr.insert(start + next.nodeSize, node);
    fixZoomOnRemoval(tr, state, start, node.nodeSize, start + next.nodeSize);
  }
  const sel = TextSelection.near(tr.doc.resolve(tr.mapping.map($from.pos)));
  tr.setSelection(sel);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Enter：切换当前条目完成态 */
function toggleDoneCommand(editor: Editor): boolean {
  const hit = currentItem(editor);
  if (!hit) return false;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(hit.start, undefined, {
      ...hit.node.attrs,
      checked: !hit.node.attrs.checked,
    })
  );
  return true;
}

/** Ctrl+↑ / Ctrl+↓ / Ctrl+Space：折叠 / 展开 / 切换（作用于光标条目） */
function collapseCommand(editor: Editor, mode: "collapse" | "expand" | "toggle"): boolean {
  const ctl = getActiveOutlineController();
  const hit = currentItem(editor);
  if (!ctl || !hit) return false;
  if (!nestedListOf(hit.node)) return false; // 无子级不可折叠
  const st = outlineStructureKey.getState(editor.state);
  const collapsed = st?.collapsed ?? [];
  const is = collapsed.includes(hit.start);
  if (mode === "toggle") ctl.toggleCollapse(hit.start);
  else if (mode === "collapse" && !is) ctl.toggleCollapse(hit.start);
  else if (mode === "expand" && is) ctl.toggleCollapse(hit.start);
  return true;
}

/** Shift+Enter：在条目首段时新增备注（条目内第二个段落）；备注内则是软换行（走默认） */
function addNoteCommand(editor: Editor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  // 光标所在段落的父节点须是 taskItem，且当前段是它的第一个子块
  if ($from.depth < 2) return false;
  const paraDepth = $from.depth;
  const parentDepth = paraDepth - 1;
  if ($from.node(parentDepth).type.name !== "taskItem") return false;
  if ($from.index(parentDepth) !== 0) return false; // 已是备注/其他块 → 默认软换行
  const insertAt = $from.after(paraDepth);
  const tr = state.tr;
  tr.insert(insertAt, state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Alt+Shift+D：复制当前条目（含子树）到紧随其后 */
function duplicateCommand(editor: Editor): boolean {
  const hit = currentItem(editor);
  if (!hit) return false;
  const tr = editor.state.tr;
  const copy = hit.node;
  tr.insert(hit.start + hit.node.nodeSize, copy);
  const sel = TextSelection.near(tr.doc.resolve(hit.start + hit.node.nodeSize + 2));
  tr.setSelection(sel);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Ctrl+Shift+Backspace：删除当前条目（含子树） */
/** 删除等结构性变化的"上移收缩"动效（FLIP）：dispatch 前记下可见条目位置，
 *  dispatch 后把被顶上来的条目做反向位移再过渡回 0，视觉上平滑收拢 */
export function withFlip(editor: Editor, run: () => void) {
  withFlipView(editor.view, run);
}

export function withFlipView(view: EditorView, run: () => void) {
  const root = view.dom;
  const before = new Map<Element, number>();
  for (const li of root.querySelectorAll<HTMLElement>(".outline-item")) {
    if (li.offsetParent) before.set(li, li.getBoundingClientRect().top);
  }
  run();
  requestAnimationFrame(() => {
    for (const [el, oldTop] of before) {
      if (!el.isConnected) continue;
      const dy = oldTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) continue;
      const li = el as HTMLElement;
      li.style.transition = "none";
      li.style.transform = `translateY(${dy}px)`;
      void li.getBoundingClientRect(); // 强制回流，让反向位移先生效
      li.style.transition = "transform 0.18s ease";
      li.style.transform = "";
      li.addEventListener(
        "transitionend",
        () => {
          li.style.transition = "";
          li.style.transform = "";
        },
        { once: true }
      );
    }
  });
}

function deleteItemCommand(editor: Editor): boolean {
  const hit = currentItem(editor);
  if (!hit) return false;
  const { $from } = editor.state.selection;
  const tr = editor.state.tr;
  const range = itemDeleteRange(editor.state.doc, hit.start);
  tr.delete(range.from, range.to);
  fixZoomOnRemoval(tr, editor.state, hit.start, hit.node.nodeSize, null);
  const sel = TextSelection.near(tr.doc.resolve(tr.mapping.map($from.pos)));
  tr.setSelection(sel);
  withFlip(editor, () => editor.view.dispatch(tr.scrollIntoView()));
  return true;
}

/** 新建条目后的滚动定位：落在视口中部——离顶部留足上下文空间（编辑视角友好） */
function scrollCaretToCenter(editor: Editor) {
  const { head } = editor.state.selection;
  const at = editor.view.domAtPos(head);
  const el = at.node.nodeType === 1 ? (at.node as Element) : at.node.parentElement;
  el?.scrollIntoView({ block: "center" });
}

/** 点击空白处：顶层末尾追加空条目并聚焦 */
function appendItemCommand(editor: Editor): boolean {
  const { state } = editor;
  const schema = state.schema;
  const item = schema.nodes.taskItem.create(null, schema.nodes.paragraph.create());
  const st = outlineStructureKey.getState(state);
  const tr = state.tr;

  // 缩放态：新条目归属当前缩放层级（zoom 目标的子列表末尾），与 Workflowy 一致
  if (st?.zoomPos != null) {
    const target = state.doc.nodeAt(st.zoomPos);
    if (target?.type.name === "taskItem") {
      const nested = nestedListOf(target);
      if (nested) {
        const insertAt = st.zoomPos + 1 + nested.off + nested.node.nodeSize - 1;
        tr.insert(insertAt, item);
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)));
      } else {
        const insertAt = st.zoomPos + 1 + target.content.size;
        tr.insert(insertAt, schema.nodes.taskList.create(null, item));
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 3)));
      }
      editor.view.dispatch(tr);
      scrollCaretToCenter(editor);
      return true;
    }
  }

  let lastListStart = -1;
  let lastListSize = 0;
  let off = 0;
  for (let i = 0; i < state.doc.childCount; i++) {
    const n = state.doc.child(i);
    if (n.type.name === "taskList") {
      lastListStart = off;
      lastListSize = n.nodeSize;
    }
    off += n.nodeSize;
  }
  if (lastListStart >= 0) {
    const insertAt = lastListStart + lastListSize - 1; // 列表内容末尾（闭合前）
    tr.insert(insertAt, item);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 2)));
  } else {
    tr.insert(0, schema.nodes.taskList.create(null, item));
    tr.setSelection(TextSelection.near(tr.doc.resolve(3)));
  }
  editor.view.dispatch(tr);
  scrollCaretToCenter(editor);
  return true;
}

/** 光标是否在缩放目标条目自身的首段里（zoom 页标题） */
function caretInZoomTitle(editor: Editor): boolean {
  const st = outlineStructureKey.getState(editor.state);
  if (st?.zoomPos == null) return false;
  const $ = editor.state.selection.$from;
  for (let d = $.depth; d > 0; d--) {
    if ($.node(d).type.name !== "taskItem") continue;
    return $.before(d) === st.zoomPos && $.index(d) === 0;
  }
  return false;
}

export const OutlineKeys = Extension.create({
  name: "outlineKeys",
  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      // ---- 导航 ----
      "Alt-.": () => {
        const hit = currentItem(editor);
        if (!hit) return false;
        getActiveOutlineController()?.zoomTo(hit.start);
        return true;
      },
      "Alt-,": () => {
        getActiveOutlineController()?.zoomOut();
        return true;
      },
      // ---- 编辑与移动 ----
      "Mod-Enter": () => toggleDoneCommand(editor),
      "Shift-Enter": () => addNoteCommand(editor),
      // 缩放页标题内 Enter：新建子条目（同级在缩放态被隐藏，默认 split 会跑到顶层）
      Enter: () => {
        if (!caretInZoomTitle(editor)) return false;
        return appendItemCommand(editor);
      },
      // 空条目上爽快删除整行（其余交回默认合并行为）
      Backspace: () => backspaceCommand(editor),
      "Alt-Shift-ArrowUp": () => moveItemCommand(editor, -1),
      "Alt-Shift-ArrowDown": () => moveItemCommand(editor, 1),
      "Alt-Shift-d": () => duplicateCommand(editor),
      "Mod-Shift-Backspace": () => deleteItemCommand(editor),
      // ---- 折叠展开 ----
      "Mod-ArrowUp": () => collapseCommand(editor, "collapse"),
      "Mod-ArrowDown": () => collapseCommand(editor, "expand"),
      "Mod-Space": () => collapseCommand(editor, "toggle"),
      // ---- 搜索退出 ----
      Escape: () => {
        const ctl = getActiveOutlineController();
        if (!ctl) return false;
        const st = outlineStructureKey.getState(editor.state);
        if (st?.query) {
          ctl.setQuery("");
          return true;
        }
        return false;
      },
    };
  },
});

/** 与应用全局快捷键冲突的键（Ctrl+O 全局是聚焦搜索，Workflowy 里是"隐藏已完成"）：
 *  在编辑器内拦截并阻断冒泡，优先给大纲语义 */
export const OutlineConflictKeys = Extension.create({
  name: "outlineConflictKeys",
  addOptions() {
    return {
      onToggleHideCompleted: () => {},
    };
  },
  addProseMirrorPlugins() {
    const onToggleHideCompleted = this.options.onToggleHideCompleted;
    return [
      new Plugin({
        key: new PluginKey("outlineConflictKeys"),
        props: {
          handleKeyDown(_view: unknown, event: KeyboardEvent) {
            if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "o") {
              event.stopPropagation();
              event.preventDefault();
              onToggleHideCompleted();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** 点击空白新建条目（由 HomeView 挂到编辑器容器上调用） */
export { appendItemCommand };

/** Backspace 爽快删除（Workflowy）：空条目（无文字无备注）直接删整行——
 *  有子级时子级上提替代本条；光标并到前一条末尾。其余场景交回默认行为 */
function backspaceCommand(editor: Editor): boolean {
  const { state } = editor;
  const { selection } = state;
  if (!selection.empty) return false;
  const $ = selection.$from;
  for (let d = $.depth; d > 0; d--) {
    if ($.node(d).type.name !== "taskItem") continue;
    // 光标在本条目自身首段的文字开头
    if ($.index(d) !== 0 || $.parentOffset !== 0) return false;
    const itemPos = $.before(d);
    const item = state.doc.nodeAt(itemPos);
    if (!item || item.childCount === 0) return false;
    const first = item.child(0);
    if (first.type.name !== "paragraph" || first.textContent !== "") return false;
    if (item.childCount > 1 && item.child(1).type.name === "paragraph") return false; // 有备注
    const nested = nestedListOf(item);
    const tr = state.tr;
    if (nested) {
      // 子级上提：子列表的条目顶替本条位置
      const slice = nested.node.slice(0, nested.node.content.size);
      tr.replace(itemPos, itemPos + item.nodeSize, slice);
      tr.setSelection(TextSelection.near(tr.doc.resolve(itemPos + 3), -1));
    } else {
      const range = itemDeleteRange(state.doc, itemPos);
      tr.delete(range.from, range.to);
      fixZoomOnRemoval(tr, state, itemPos, item.nodeSize, null);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, itemPos - 1)), -1));
    }
    withFlip(editor, () => editor.view.dispatch(tr));
    return true;
  }
  return false;
}

// ---------------- #tag 高亮 ----------------

function tagDecos(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  const re = /(^|\s)(#[A-Za-z0-9\u4e00-\u9fff_-]+)/g;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text))) {
      const startOff = m.index + m[1].length;
      out.push(
        Decoration.inline(pos + startOff, pos + startOff + m[2].length, { class: "outline-tag" })
      );
    }
  });
  return DecorationSet.create(doc, out);
}

export const OutlineTags = Extension.create({
  name: "outlineTags",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("outlineTags"),
        state: {
          init: (_, { doc }) => tagDecos(doc),
          apply: (tr, old) => (tr.docChanged ? tagDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ---------------- 相对日装饰（官方 Friendly day names：Today, / Tomorrow, / Yesterday, 前缀） ----------------

const REL_DAYS: { off: number; label: string }[] = [
  { off: -1, label: "Yesterday, " },
  { off: 0, label: "Today, " },
  { off: 1, label: "Tomorrow, " },
];

function relativeDayDecos(doc: PMNode): DecorationSet {
  const now = Date.now();
  const sets = REL_DAYS.map((r) => ({
    label: r.label,
    texts: new Set(dayCandidates(new Date(now + r.off * 86400000))),
  }));
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return true;
    const bare = bareOwnText(node);
    const hit = sets.find((s) => s.texts.has(bare));
    if (hit) {
      const first = node.childCount ? node.child(0) : null;
      if (first?.type.name === "paragraph") {
        out.push(
          Decoration.widget(
            pos + 2,
            () => {
              const span = document.createElement("span");
              span.className = "outline-date-prefix";
              span.textContent = hit.label;
              span.contentEditable = "false";
              return span;
            },
            { side: -1, ignoreSelection: true }
          )
        );
      }
    }
    return true;
  });
  return out.length ? DecorationSet.create(doc, out) : DecorationSet.empty;
}

export const OutlineDates = Extension.create({
  name: "outlineDates",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("outlineDates"),
        state: {
          init: (_, { doc }) => relativeDayDecos(doc),
          apply: (tr, old) => (tr.docChanged ? relativeDayDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// ---------------- Calendar ribbon 宿主（官方顺序：标题在下、日期条在标题下方、正文再下） ----------------

let ribbonHostEl: HTMLDivElement | null = null;
/** 当前挂载在文档流里的 ribbon 宿主（HomeToday portal 目标）；不在 DOM 返回 null */
export function getRibbonHost(): HTMLDivElement | null {
  return ribbonHostEl && ribbonHostEl.isConnected ? ribbonHostEl : null;
}

const RIBBON_HOST_KEY = new PluginKey<{ zoomPos: number | null; decos: DecorationSet }>(
  "outlineRibbonHost"
);

function ribbonHostDecos(doc: PMNode, zoomPos: number | null): DecorationSet {
  if (zoomPos == null) return DecorationSet.empty;
  const item = doc.nodeAt(zoomPos);
  if (!item || item.type.name !== "taskItem") return DecorationSet.empty;
  const first = item.childCount ? item.child(0) : null;
  if (first?.type.name !== "paragraph") return DecorationSet.empty;
  const own = first.textContent.trim();
  const today = new Date();
  let hit = monthOfText(own) != null;
  for (let off = 0; off < 800 && !hit; off++) {
    for (const sign of off === 0 ? [0] : [-1, 1]) {
      if (isDateText(own, new Date(today.getTime() + sign * off * 86400000))) {
        hit = true;
        break;
      }
    }
  }
  if (!hit) return DecorationSet.empty;
  return DecorationSet.create(doc, [
    Decoration.widget(zoomPos + 1 + first.nodeSize, () => {
      if (!ribbonHostEl || !ribbonHostEl.isConnected) {
        ribbonHostEl = document.createElement("div");
        ribbonHostEl.className = "wf-ribbon-host";
      }
      return ribbonHostEl;
    }),
  ]);
}

export const OutlineRibbonHost = Extension.create({
  name: "outlineRibbonHost",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: RIBBON_HOST_KEY,
        state: {
          init: (): { zoomPos: number | null; decos: DecorationSet } => ({
            zoomPos: null,
            decos: DecorationSet.empty,
          }),
          apply(tr, prev) {
            const meta = tr.getMeta(OUTLINE_META) as { zoomPos?: number | null } | undefined;
            let zoomPos = prev.zoomPos;
            if (meta && "zoomPos" in meta) zoomPos = meta.zoomPos ?? null;
            else if (tr.docChanged && zoomPos != null) zoomPos = mapItemPos(tr, zoomPos);
            if (!meta && !tr.docChanged) return prev;
            return { zoomPos, decos: ribbonHostDecos(tr.doc, zoomPos) };
          },
        },
        props: {
          decorations(state) {
            return RIBBON_HOST_KEY.getState(state)?.decos ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// ---------------- #tag 自动补全（官方同款：输入 #/续打时弹历史标签建议） ----------------

interface TagSuggestState {
  /** 光标前已输入的 #xxx 起点（文档绝对位置）与文本 */
  from: number;
  typed: string;
  items: string[];
  active: number;
}

const TAG_SUGGEST_KEY = new PluginKey<TagSuggestState | null>("outlineTagSuggest");

/** 光标前是否正输入 #tag（返回 # 起始位置与已打字） */
function typingTagBefore($from: ResolvedPos): { from: number; typed: string } | null {
  const parent = $from.parent;
  const textBefore = parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const m = /(^|\s)#([A-Za-z0-9\u4e00-\u9fff_-]*)$/.exec(textBefore);
  if (!m) return null;
  // # 起点的文档位置：parentOffset 减去匹配段长度
  return { from: $from.pos - m[2].length - 1, typed: m[2] };
}

function updateSuggest(editor: Editor, tr: Transaction): TagSuggestState | null {
  const { selection } = tr;
  if (!selection.empty) return null;
  const hit = typingTagBefore(tr.doc.resolve(selection.from));
  if (!hit) return null;
  const items = collectOutlineTags(editor)
    .filter((t) => t.startsWith(hit.typed) && t !== hit.typed)
    .slice(0, 8);
  if (!items.length) return null;
  return { from: hit.from, typed: hit.typed, items, active: 0 };
}

/** 浮层 DOM 单例（不走 React：跟手、随事务高频刷新） */
let suggestEl: HTMLDivElement | null = null;
function renderSuggest(view: EditorView, st: TagSuggestState | null) {
  if (!st) {
    suggestEl?.removeAttribute("data-show");
    return;
  }
  if (!suggestEl || !suggestEl.isConnected) {
    suggestEl = document.createElement("div");
    suggestEl.className = "outline-tag-suggest";
    suggestEl.setAttribute("contenteditable", "false");
    document.body.appendChild(suggestEl);
    suggestEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const idx = Number((e.target as HTMLElement).closest("[data-idx]")?.getAttribute("data-idx") ?? -1);
      if (idx >= 0) insertSuggestion(view, idx);
    });
  }
  suggestEl.innerHTML = st.items
    .map((t, i) => `<div class="outline-tag-item${i === st.active ? " is-on" : ""}" data-idx="${i}">#${t}</div>`)
    .join("");
  suggestEl.setAttribute("data-show", "1");
  const coords = view.coordsAtPos(st.from, -1);
  const hostR = view.dom.getBoundingClientRect();
  suggestEl.style.left = `${Math.min(coords.left, hostR.right - 180)}px`;
  suggestEl.style.top = `${coords.bottom + 4}px`;
}

function insertSuggestion(view: EditorView, idx: number) {
  const st = TAG_SUGGEST_KEY.getState(view.state);
  if (!st) return;
  const tag = st.items[idx];
  if (!tag) return;
  view.dispatch(
    view.state.tr
      .insertText(`#${tag} `, st.from, st.from + st.typed.length + 1)
      .scrollIntoView()
  );
  view.focus();
}

export const OutlineTagSuggest = Extension.create({
  name: "outlineTagSuggest",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: TAG_SUGGEST_KEY,
        view: () => ({
          update: (view) => renderSuggest(view, TAG_SUGGEST_KEY.getState(view.state) ?? null),
          destroy: () => suggestEl?.removeAttribute("data-show"),
        }),
        state: {
          init: (): TagSuggestState | null => null,
          apply(tr, old) {
            // 键盘 ↑↓ 的选中项更新走 meta（无文档/选区变化）
            const meta = tr.getMeta(TAG_SUGGEST_KEY) as TagSuggestState | null | undefined;
            if (meta !== undefined) return meta;
            if (tr.docChanged || tr.selectionSet) return updateSuggest(editor, tr);
            return old;
          },
        },
        props: {
          handleKeyDown(view, event) {
            const st = TAG_SUGGEST_KEY.getState(view.state);
            if (!st) return false;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const dir = event.key === "ArrowDown" ? 1 : -1;
              view.dispatch(
                view.state.tr.setMeta(TAG_SUGGEST_KEY, {
                  ...st,
                  active: (st.active + dir + st.items.length) % st.items.length,
                })
              );
              return true;
            }
            if (event.key === "Enter") {
              insertSuggestion(view, st.active);
              return true;
            }
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(TAG_SUGGEST_KEY, null));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

// ---------------- 每日笔记 / 日历结构（官方 📆 Calendar/年/月/日 模板） ----------------

const DAY_WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bareOwnText(node: PMNode): string {
  let own = "";
  node.forEach((c) => {
    if (c.type.name === "paragraph" && !own) own = c.textContent;
  });
  return own.replace(/^\ufeff+/, "").replace(/\ufeff+$/, "").trim();
}

/** 某天的候选标题集合（官方格式 + 常见手写变体） */
export function dayCandidates(d: Date): string[] {
  const wd = DAY_WD[d.getDay()];
  const mon = DAY_MON[d.getMonth()];
  const dd = d.getDate();
  return [
    `${wd}, ${mon} ${dd}`, // 官方模板格式（Sat, Oct 12）
    `${mon} ${dd}`, // Oct 12
    `${d.getMonth() + 1}月${dd}日`,
    `${dd}日`,
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
  ];
}

/** 严格解析官方日期标题（"Tue, Oct 13"），失败返回 null（排序插入用） */
function parseDayTitle(text: string): Date | null {
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/.exec(text);
  if (!m) return null;
  return new Date(2026, DAY_MON.indexOf(m[2]), Number(m[3])); // 年份由父级决定，仅用于同月内排序
}

/** 在全文档找某天的日期条目，返回条目位置 */
export function findDayAt(editor: Editor, d: Date): number | null {
  const candidates = new Set(dayCandidates(d));
  let hit: number | null = null;
  editor.state.doc.descendants((n, p) => {
    if (hit != null) return false;
    if (n.type.name !== "taskItem") return true;
    if (candidates.has(bareOwnText(n))) {
      hit = p;
      return false;
    }
    return true;
  });
  return hit;
}

export function findDayTarget(editor: Editor, offsetDays: number): number | null {
  return findDayAt(editor, new Date(Date.now() + offsetDays * 86400000));
}

/** "今天"入口：在大纲里找今天的日期条目；找不到返回 null（回根视图）。 */
export function findTodayTarget(editor: Editor): number | null {
  return findDayTarget(editor, 0);
}

/** 在指定父条目（或其嵌套列表）末尾追加子条目，返回是否成功 */
function appendChildItem(editor: Editor, parentPos: number | null, text: string): boolean {
  const schema = editor.state.schema;
  const item = schema.nodes.taskItem.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
  const tr = editor.state.tr;
  if (parentPos == null) {
    // 顶层列表末尾
    let listEnd = editor.state.doc.content.size;
    editor.state.doc.forEach((n, off) => {
      if (n.type.name === "taskList") listEnd = Math.min(listEnd, off + n.nodeSize - 1);
    });
    tr.insert(listEnd, item);
  } else {
    const parent = editor.state.doc.nodeAt(parentPos);
    if (!parent) return false;
    const nested = nestedListOf(parent);
    if (nested) {
      tr.insert(parentPos + 1 + nested.off + nested.node.nodeSize - 1, item);
    } else {
      tr.insert(parentPos + parent.nodeSize - 1, schema.nodes.taskList.create(null, item));
    }
  }
  editor.view.dispatch(tr);
  return true;
}

/** 在父条目子级里按序插入子条目：cmp 比较"新条目应排在某子条目之前"，全部为否则末尾追加 */
function insertChildSorted(
  editor: Editor,
  parentPos: number,
  text: string,
  childDate: (childText: string) => number | null,
  newKey: number
): void {
  const parent = editor.state.doc.nodeAt(parentPos);
  if (!parent) return;
  const nested = nestedListOf(parent);
  if (!nested) {
    appendChildItem(editor, parentPos, text);
    return;
  }
  const listAbs = parentPos + 1 + nested.off;
  let off = 0;
  let insertAt: number | null = null;
  nested.node.forEach((child) => {
    if (insertAt != null) return;
    if (child.type.name === "taskItem") {
      const key = childDate(bareOwnText(child));
      if (key != null && key > newKey) insertAt = listAbs + 1 + off;
    }
    off += child.nodeSize;
  });
  if (insertAt == null) {
    appendChildItem(editor, parentPos, text);
    return;
  }
  const schema = editor.state.schema;
  const item = schema.nodes.taskItem.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
  editor.view.dispatch(editor.state.tr.insert(insertAt, item));
}

/** 找 Own 文本命中集合的首个条目 */
function findItemByOwnText(editor: Editor, texts: string[]): number | null {
  const set = new Set(texts);
  let hit: number | null = null;
  editor.state.doc.descendants((n, p) => {
    if (hit != null) return false;
    if (n.type.name === "taskItem" && set.has(bareOwnText(n))) {
      hit = p;
      return false;
    }
    return true;
  });
  return hit;
}

/** 官方结构常量：根条目 "📆 Calendar" */
export const CALENDAR_ITEM_TEXT = "📆 Calendar";

/** 年份条目下的月份条目标题（Oct） */
function monthItemText(month: number): string {
  return DAY_MON[month];
}

/** 找月份条目：优先在年份条目子级，其次全文档（兼容旧结构）。 */
export function findMonthTarget(editor: Editor, year: number, month: number): number | null {
  const yearPos = findItemByOwnText(editor, [`${year}`, `${year}年`]);
  const want = monthItemText(month);
  if (yearPos != null) {
    const yearNode = editor.state.doc.nodeAt(yearPos);
    const nested = yearNode ? nestedListOf(yearNode) : null;
    if (nested) {
      // 子条目绝对位置 = 列表起点 + 1（open token）+ 内容偏移
      const listAbs = yearPos + 1 + nested.off;
      let hit: number | null = null;
      let off = 0;
      nested.node.forEach((child) => {
        if (hit != null) return;
        if (child.type.name === "taskItem" && bareOwnText(child) === want) hit = listAbs + 1 + off;
        off += child.nodeSize;
      });
      if (hit != null) return hit;
    }
  }
  return findItemByOwnText(editor, [want]);
}

/** 确保 📆 Calendar > 年 > 月 链存在（已存在的不动），返回月份条目位置。 */
export function ensureMonthTarget(editor: Editor, year: number, month: number): number | null {
  const found = findMonthTarget(editor, year, month);
  if (found != null && editor.state.doc.nodeAt(found)) return found;
  // 逐级补链：Calendar → 年 → 月
  let calPos = findItemByOwnText(editor, [CALENDAR_ITEM_TEXT]);
  if (calPos == null || !editor.state.doc.nodeAt(calPos)) {
    appendChildItem(editor, null, CALENDAR_ITEM_TEXT);
    calPos = findItemByOwnText(editor, [CALENDAR_ITEM_TEXT]);
  }
  if (calPos == null) return null;
  let yearPos = findItemByOwnText(editor, [`${year}`, `${year}年`]);
  if (yearPos == null || !editor.state.doc.nodeAt(yearPos)) {
    // 年份升序插入到 Calendar 子级
    insertChildSorted(editor, calPos, `${year}`, (t) => {
      const m = /^(\d{4})年?$/.exec(t);
      return m ? Number(m[1]) : null;
    }, year);
    yearPos = findItemByOwnText(editor, [`${year}`, `${year}年`]);
  }
  if (yearPos == null) return null;
  insertChildSorted(editor, yearPos, monthItemText(month), (t) => {
    const i = DAY_MON.indexOf(t);
    return i >= 0 ? i : null;
  }, month);
  return findMonthTarget(editor, year, month);
}

/** 某天的每日笔记条目：没有就按官方结构（Calendar/年/月/日）创建并按日期顺序插入。
 *  已存在于别处的日期条目（旧文档顶层等）直接复用，不重复建。 */
export function ensureDayAt(editor: Editor, d: Date): number | null {
  const found = findDayAt(editor, d);
  if (found != null && editor.state.doc.nodeAt(found)) return found;
  const monthPos = ensureMonthTarget(editor, d.getFullYear(), d.getMonth());
  const title = `${DAY_WD[d.getDay()]}, ${DAY_MON[d.getMonth()]} ${d.getDate()}`;
  if (monthPos == null) {
    appendChildItem(editor, null, title);
  } else {
    // 同月内按日期升序（解析不了的子条目原地不动，新条目插到首个更晚日期之前）
    insertChildSorted(editor, monthPos, title, (t) => {
      const p = parseDayTitle(t);
      if (!p) return null;
      // parseDayTitle 的年份占位是 2026；跨月比较用 (月, 日) 组合键
      return p.getMonth() * 100 + p.getDate();
    }, d.getMonth() * 100 + d.getDate());
  }
  return findDayAt(editor, d);
}

export function ensureDayTarget(editor: Editor, offsetDays: number): number | null {
  return ensureDayAt(editor, new Date(Date.now() + offsetDays * 86400000));
}

/** 今天的每日笔记条目：没有就自动创建（官方"每天自动生成当日笔记"语义）。 */
export function ensureTodayTarget(editor: Editor): number | null {
  return ensureDayTarget(editor, 0);
}

/** 当前 zoom 的节点是否以看板布局打开（看板是节点属性，非全局状态；根视图恒列表） */
/** 设置节点的看板布局属性（写入文档 → Home.md 持久化，刷新不丢）。
 *  看板是内联渲染的：开了 board 的条目在大纲流里就地展开成列。 */
export function setNodeBoard(editor: Editor, pos: number, on: boolean) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "taskItem") return;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, board: on })
  );
}

/** 删除条目（含子树）：唯一子级整列表删（防空壳回填），缩放根被删落回父级 */
export function deleteItemAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "taskItem") return false;
  const range = itemDeleteRange(editor.state.doc, pos);
  const tr = editor.state.tr.delete(range.from, range.to);
  fixZoomOnRemoval(tr, editor.state, pos, node.nodeSize, null);
  editor.view.dispatch(tr);
  return true;
}

/** 把条目整体移动为某父条目的末位子级（看板换列 / Move to today 共用） */
export function moveItemUnder(editor: Editor, fromPos: number, parentPos: number): boolean {
  const doc = editor.state.doc;
  const node = doc.nodeAt(fromPos);
  const parent = doc.nodeAt(parentPos);
  if (!node || node.type.name !== "taskItem" || !parent || parent.type.name !== "taskItem") return false;
  if (fromPos >= parentPos && fromPos < parentPos + parent.nodeSize) return false; // 已在其内
  const nested = nestedListOf(parent);
  const schema = editor.state.schema;
  const tr = editor.state.tr;
  const range = itemDeleteRange(doc, fromPos);
  tr.delete(range.from, range.to);
  const insertAt = nested
    ? tr.mapping.map(parentPos + 1 + nested.off + nested.node.nodeSize - 1)
    : tr.mapping.map(parentPos + parent.nodeSize - 1);
  tr.insert(insertAt, nested ? node : schema.nodes.taskList.create(null, node));
  // 缩放根在被移动子树内：跟到新位置（包装了新列表时节点起点 +1）
  fixZoomOnRemoval(tr, editor.state, fromPos, node.nodeSize, nested ? insertAt : insertAt + 1);
  withFlip(editor, () => editor.view.dispatch(tr));
  return true;
}

/** 大纲里已使用的全部 #tag（去重排序；用于 ⋯ 菜单勾选） */
export function collectOutlineTags(editor: Editor): string[] {  const seen = new Set<string>();
  const re = /(^|\s)(#[A-Za-z0-9\u4e00-\u9fff_-]+)/g;
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    let m: RegExpExecArray | null;
    while ((m = re.exec(node.text))) seen.add(m[2].slice(1));
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** 条目自身首段是否已带某 tag */
export function itemHasTag(item: PMNode, tag: string): boolean {
  const first = item.childCount ? item.child(0) : null;
  if (!first) return false;
  const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s)`);
  return re.test(first.textContent);
}

/** 给条目加上/去掉 #tag（改首段文字；追加位置在行尾 ^blockId 之前，保住引用锚） */
export function toggleTagCommand(editor: Editor, itemPos: number, tag: string): boolean {
  const item = editor.state.doc.nodeAt(itemPos);
  if (!item || item.type.name !== "taskItem" || !item.childCount) return false;
  const para = item.child(0);
  if (para.type.name !== "paragraph") return false;
  const paraContentStart = itemPos + 2; // item 开标签 1 + para 开标签 1
  const has = itemHasTag(item, tag);
  const tagEsc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let tr: Transaction | null = null;

  // 首段的 inline 子节点里定位（text 可能因 mark 被切成多段）
  let off = 0;
  for (let i = 0; i < para.childCount && !tr; i++) {
    const child = para.child(i);
    if (!child.isText || !child.text) {
      off += child.nodeSize;
      continue;
    }
    if (has) {
      const m = child.text.match(new RegExp(`(\\s)#${tagEsc}(?=$|\\s)`));
      if (m) {
        const at = paraContentStart + off + (m.index ?? 0);
        tr = editor.state.tr.delete(at, at + m[0].length);
      }
    } else if (i === para.childCount - 1) {
      const idm = child.text.match(/\s\^[\w-]+$/); // 行尾块引用锚
      const insertAt = paraContentStart + off + (idm ? idm.index ?? 0 : child.text.length);
      tr = editor.state.tr.insertText(` #${tag}`, insertAt);
    }
    off += child.text.length;
  }
  if (!tr) {
    if (has) return false; // 有 tag 却没删成（不在首段，防御）
    // 首段没有任何 text 子节点（空段落）：直接插入
    tr = editor.state.tr.insertText(` #${tag}`, paraContentStart);
  }
  editor.view.dispatch(tr);
  return true;
}

// ---------------- Home 内拖拽落点 ----------------

export interface HomeDropResult {
  ok: boolean;
}

// 拖拽源高亮：挂在源条目 li 上（盒子天然罩住其子树 = "拖的这个节点和它的子节点"）；
// resolveOutlineDropTarget 同时用它过滤落点——拖到自己或自己的子节点里没有意义，
// 过程中就不给落点提示（松手也不会动）
let dragSrcEl: HTMLElement | null = null;
export function markDragSrcHl(li: Element | null) {
  clearDragSrcHl();
  if (li instanceof HTMLElement) {
    li.classList.add("outline-drag-src");
    dragSrcEl = li;
  }
}
export function clearDragSrcHl() {
  dragSrcEl?.classList.remove("outline-drag-src");
  dragSrcEl = null;
}

/** 拖拽跟随影像：官方同款 18px 小圆点（替代浏览器默认的整行半透明拖影，
 *  默认拖影遮挡视线且跟随卡顿，是"不好拖"的主要来源之一）。惰性建屏外单例。 */
let dragPreviewEl: HTMLElement | null = null;
export function applyDragPreview(dt: DataTransfer) {
  try {
    if (!dragPreviewEl || !dragPreviewEl.isConnected) {
      dragPreviewEl = document.createElement("div");
      dragPreviewEl.className = "outline-drag-dot";
      document.body.appendChild(dragPreviewEl);
    }
    dt.setDragImage(dragPreviewEl, 9, 9);
  } catch {
    /* 旧浏览器无 setDragImage 时用默认拖影 */
  }
}

/** 拖放落点判定（dragover 提示与 drop 执行共用同一函数，所见即所落）。
 *  与 Workflowy 官方 demo 同款：目标行 = 事件命中的 outline-item（closest 取最深行），
 *  行高 25%/50%/25% 三分——上带插到目标前、下带插到目标后、中间成为目标的第一个子级。
 *  自适应增强：鼠标按在自己（或自己子树）区域内不给任何落点（demo 只在 drop 时防，体验差） */
export interface OutlineDropTarget {
  mode: "top" | "bottom" | "child";
  pos: number;
  row: HTMLElement;
  rect: DOMRect;
}

export function resolveOutlineDropTarget(
  view: EditorView,
  event: { target: EventTarget | null; clientY: number }
): OutlineDropTarget | null {
  // 鼠标还按在自己（或自己的子树）区域内：任何落点都没有意义，直接不提示
  if (dragSrcEl) {
    const sr = dragSrcEl.getBoundingClientRect();
    if (event.clientY >= sr.top && event.clientY <= sr.bottom) return null;
  }
  const itemEl = (event.target as HTMLElement | null)?.closest?.(".outline-item") as
    | HTMLElement
    | null;
  if (!itemEl || itemEl === dragSrcEl || dragSrcEl?.contains(itemEl)) return null;
  // zoom 隐藏行/祖先壳/折叠子树（display:none）都不作为落点
  if (itemEl.classList.contains("outline-hidden") || itemEl.classList.contains("outline-ancestor")) return null;
  if (!itemEl.offsetParent) return null;
  const doc = view.state.doc;
  const pos = itemPosAround(doc, view.posAtDOM(itemEl, 0));
  if (pos == null) return null;
  const rect = itemEl.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const threshold = rect.height * 0.25;
  // 中带 = 成为目标的第一个子级；空条目不做子级容器，降级为后插
  const firstP = itemEl.querySelector(":scope > .outline-content > div > p");
  const mode: OutlineDropTarget["mode"] =
    y < threshold ? "top" : y > rect.height - threshold ? "bottom" : firstP && firstP.textContent.trim() ? "child" : "bottom";
  return { mode, pos, row: itemEl, rect };
}

/** Home 编辑器内放下被拖动的条目（target 来自 resolveOutlineDropTarget） */
export function applyHomeNodeDrop(
  view: EditorView,
  payload: { pos?: number; address?: number[] },
  target: OutlineDropTarget
): boolean {
  const { state } = view;
  const doc = state.doc;
  // 位置优先用树地址重解析：拖拽窗口内文档不变、地址是结构语义，
  // 而 React NodeView 的 getPos 在极端时序下可能过期（视图错位余波）；
  // 解析结果必须是 taskItem 才可信，否则回落 dragstart 记录的 pos
  let fromPos: number | null = null;
  if (Array.isArray(payload.address)) {
    const byAddr = itemPosAtAddress(doc, payload.address);
    if (byAddr != null && doc.nodeAt(byAddr)?.type.name === "taskItem") fromPos = byAddr;
  }
  if (fromPos == null && typeof payload.pos === "number") {
    if (doc.nodeAt(payload.pos)?.type.name === "taskItem") fromPos = payload.pos;
  }
  if (fromPos == null) return true;
  const node = doc.nodeAt(fromPos);
  if (!node || node.type.name !== "taskItem") return true;

  const targetPos = target.pos;
  // 目标落在自己子树内（含自身）→ 放弃
  if (targetPos >= fromPos && targetPos < fromPos + node.nodeSize) return true;

  const schema = state.schema;
  let insertAt: number;
  let insertNode: PMNode = node;
  if (target.mode === "top") {
    // 插到目标条目之前（同级）
    insertAt = targetPos;
  } else if (target.mode === "bottom") {
    // 插到目标条目（整棵子树）之后（同级）
    const targetNode = doc.nodeAt(targetPos);
    if (!targetNode) return true;
    insertAt = targetPos + targetNode.nodeSize;
  } else {
    // child：成为目标的第一个子级（官方 demo 语义：unshift 到子列表头部；
    // 没有子列表就在 item 内容开头新建一层）
    const targetNode = doc.nodeAt(targetPos);
    if (!targetNode) return true;
    const nested = nestedListOf(targetNode);
    if (nested) {
      // item open(+1) + 列表偏移 + 列表 open(+1) = 子列表内容起点（第一个子级之前）
      insertAt = targetPos + 1 + nested.off + 1;
    } else {
      // 无子列表：新建一层，列表节点必须放在段落之后（item 内容末尾），
      // 放段落前会把子级渲染到父文字上方
      insertAt = targetPos + targetNode.nodeSize - 1;
      insertNode = schema.nodes.taskList.create(null, node);
    }
  }

  const tr = state.tr;
  // child 放置若命中折叠条目：记下目标，移动后顺手展开（否则内容进了隐藏列表，看起来像没反应）
  const collapsedNow = outlineStructureKey.getState(state)?.collapsed ?? [];
  const expandTarget =
    target.mode === "child" && collapsedNow.includes(targetPos) ? targetPos : null;
  const range = itemDeleteRange(doc, fromPos);
  tr.delete(range.from, range.to);
  const at = tr.mapping.map(insertAt);
  tr.insert(at, insertNode);
  // 缩放根在被拖动子树内：跟到新位置（child 无子列表时包了新列表，节点起点 +1）
  fixZoomOnRemoval(tr, state, fromPos, node.nodeSize, insertNode === node ? at : at + 1);
  const sel = TextSelection.near(tr.doc.resolve(tr.mapping.map(fromPos + 2)));
  tr.setSelection(sel);
  // FLIP 动效：行从旧位置平滑滑动到新位置
  withFlipView(view, () => view.dispatch(tr.scrollIntoView()));
  if (expandTarget != null) {
    // meta 单独一炮（docChanged 的基线映射会先把 collapsed 搬到新位置，这里再摘掉目标）
    const mapped = tr.mapping.map(expandTarget);
    const rest = (outlineStructureKey.getState(view.state)?.collapsed ?? []).filter(
      (p) => p !== mapped
    );
    if (rest.length !== (outlineStructureKey.getState(view.state)?.collapsed ?? []).length) {
      view.dispatch(view.state.tr.setMeta(OUTLINE_META, { collapsed: rest }));
    }
  }
  return true;
}

/** li 直属（不含嵌套列表）的第一个文本节点 */
function firstOwnTextNode(li: HTMLElement): Text | null {
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      return (n.parentElement as HTMLElement | null)?.closest("li") === li ? 1 : 2;
    },
  });
  const n = walker.nextNode();
  return n ? (n as Text) : null;
}

/** 顶层散段落自动收编为条目：Workflowy 里一切皆条目；
 *  空文档直接输入 / 删光列表后输入 / 旧文件散行都会产生顶层段落，这里实时包成 taskList */
export const OutlineNormalize = Extension.create({
  name: "outlineNormalize",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("outlineNormalize"),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null;
          const { schema } = state;
          let tr: Transaction | null = null;
          // 在同一事务里循环修复（append 链对返回事务不会再次迭代）：
          // 1) 相邻顶层 taskList 合并成一个（散段收编/粘贴会产生多列表碎片）
          // 2) 顶层散块收编为单条目 taskList
          for (;;) {
            const d: PMNode = (tr ?? state.tr).doc;
            let pos = 0;
            let acted = false;
            for (let i = 0; i < d.childCount; i++) {
              const node = d.child(i);
              const next = i + 1 < d.childCount ? d.child(i + 1) : null;
              if (node.type.name === "taskList" && next?.type.name === "taskList") {
                tr = (tr ?? state.tr).join(pos + node.nodeSize);
                acted = true;
                break;
              }
              if (node.type.name === "taskList" || !node.isBlock) {
                pos += node.nodeSize;
                continue;
              }
              const base: Transaction = tr ?? state.tr;
              // 原段落节点整体放进条目（直接用 node.content 是 inline 内容，类型不匹配）
              const item = schema.nodes.taskItem.create(null, node);
              tr = base.replaceWith(
                pos,
                pos + node.nodeSize,
                schema.nodes.taskList.create(null, item)
              );
              acted = true;
              break; // 重遍历（替换后位置已变）
            }
            if (!acted) break;
          }
          return tr;
        },
      }),
    ];
  },
});

// ---------------- OutlineItem（TaskItem 变体） ----------------

export const OutlineItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blockId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.blockId ? { "data-block-id": attributes.blockId as string } : {},
      },
      // 该节点以看板布局打开（官方：Board 是节点自己的属性，存盘不丢）
      board: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-board") === "1",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.board ? { "data-board": "1" } : {},
      },
      // 待办条目（官方 todo：行首复选框取代圆点；输入 [] + 空格转换；存 ^todo 锚）
      todo: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-todo") === "1",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.todo ? { "data-todo": "1" } : {},
      },
    };
  },
  addInputRules() {
    return [
      // 官方 markdown 快捷：条目开头输入 "[] " → 转待办（未完成），"[x] " → 转待办（已完成）
      new InputRule({
        find: /^(\[( |x|X)?\])\s$/,
        handler: ({ state, range, match, chain }) => {
          const $ = state.doc.resolve(range.from);
          let itemPos: number | null = null;
          let attrs: Record<string, unknown> | null = null;
          for (let d = $.depth; d > 0; d--) {
            if ($.node(d).type.name === "taskItem") {
              itemPos = $.before(d);
              attrs = {
                ...$.node(d).attrs,
                todo: true,
                // [x]/[X] 空格 = 已完成；[] 空格 = 未完成
                checked: match[2] === "x" || match[2] === "X",
              };
              break;
            }
          }
          if (itemPos == null || attrs == null) return;
          // chain 单发派发：删除 "[] " 文本 + 打 todo 属性 + 光标放回文本起点
          // （不经 chain 的话 TipTap 事后自设选择，光标会漂走、续打字串行）
          chain()
            .command(({ tr }) => {
              tr.delete(range.from, range.to);
              tr.setNodeMarkup(itemPos as number, undefined, attrs as Record<string, unknown>);
              tr.setSelection(TextSelection.near(tr.doc.resolve(range.from)));
              return true;
            })
            .run();
        },
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(OutlineItemView);
  },
  addStorage() {
    return {
      markdown: {
        // 覆盖 tiptap-markdown 内置 taskItem 序列化：首段行尾补 ^blockId；
        // 后续段落（备注）前插空行——否则 markdown-it 会把续行并回首段（软换行），
        // 重载后备注就不再是独立段落
        serialize(state: any, node: any) {
          const check = node.attrs.checked ? "[x]" : "[ ]";
          state.write(`${check} `);
          if (node.childCount) {
            const first = node.child(0);
            if (first.type.name === "paragraph") {
              state.renderInline(first);
              if (node.attrs.blockId) state.write(` ^${node.attrs.blockId}`);
              if (node.attrs.board) state.write(" ^board");
              if (node.attrs.todo) state.write(" ^todo");
              state.ensureNewLine();
              for (let i = 1; i < node.childCount; i++) {
                const child = node.child(i);
                if (child.type.name === "paragraph") state.write("\n");
                state.render(child, node, i);
              }
            } else {
              state.renderContent(node);
            }
          }
        },
        parse: {
          // 三段：①内置行为（input→data-checked）②空条目兜底 ③行尾 ^id 提取
          updateDOM(element: HTMLElement) {
            element.querySelectorAll(".task-list-item").forEach((item) => {
              const li = item as HTMLElement;
              const input = li.querySelector("input");
              li.setAttribute("data-type", "taskItem");
              if (input) {
                li.setAttribute("data-checked", String((input as HTMLInputElement).checked));
                input.remove();
              }
            });
            // 内置 task 插件只认"[ ] xxx"（内容须带尾随空格），空条目"- [ ] "会落成
            // 普通列表：兜底把勾选框语法开头的普通 li 转成任务条目，父 ul 补 data-type
            element.querySelectorAll("li").forEach((item) => {
              const li = item as HTMLElement;
              if (li.getAttribute("data-type") === "taskItem") return;
              const first = firstOwnTextNode(li);
              const m = /^\[( |x|X)\]( |$)/.exec(first?.textContent ?? "");
              if (!first || !m) return;
              first.textContent = first.textContent!.slice(m[0].length);
              li.setAttribute("data-type", "taskItem");
              li.setAttribute("data-checked", m[1] === " " ? "false" : "true");
              li.closest("ul")?.setAttribute("data-type", "taskList");
            });
            element.querySelectorAll('li[data-type="taskItem"]').forEach((item) => {
              const li = item as HTMLElement;
              // ^id 只会写在首段行尾（序列化器如此输出）；
              // 有备注（第二段落）时 li 的"最后文本节点"是备注，必须在首段找
              const firstPara =
                (li.querySelector(":scope > p") as HTMLElement | null) ??
                (li.querySelector(":scope > div > p") as HTMLElement | null) ??
                li;
              const scope = firstPara === li ? li : firstPara;
              const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
                acceptNode(n: Node) {
                  return (n.parentElement as HTMLElement | null)?.closest("li") === li ? 1 : 2;
                },
              });
              let last: Text | null = null;
              let n: Node | null;
              while ((n = walker.nextNode())) last = n as Text;
              if (!last?.textContent) return;
              // 先剥行尾锚（序列化顺序：text ^id ^board ^todo——从最后一个剥起）
              const mt = /\s*\^todo\s*$/.exec(last.textContent);
              if (mt) {
                last.textContent = last.textContent.slice(0, mt.index);
                li.setAttribute("data-todo", "1");
              }
              const mb = /\s*\^board\s*$/.exec(last.textContent);
              if (mb) {
                last.textContent = last.textContent.slice(0, mb.index);
                li.setAttribute("data-board", "1");
              }
              const m = /\s*\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/.exec(last.textContent);
              if (m) {
                last.textContent = last.textContent.slice(0, m.index);
                li.setAttribute("data-block-id", m[1]);
              }
            });
          },
        },
      },
    };
  },
}).configure({ nested: true });
