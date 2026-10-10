// Workspace（工作台聚合）：布局树 + 多栏 + 每栏一组标签页（Tab）。
// 布局是递归的行/列树（与 Obsidian 一致）：叶子是栏（Pane，一组标签），
// row = 左右并排，col = 上下堆叠；栏数无上限，可任意嵌套拆分。
// 行为：单击在活动栏当前标签打开、Ctrl+点击开新标签、Ctrl+Shift+点击在右侧拆新栏；
// 拖拽标签到栏的左/右/上/下边缘拆分新栏、到中央加入该栏标签列表、到标签条插入指定位置。
// 路径的删除/重命名联动（clearPath/relocate）作用于所有栏的所有标签。

import type { EventBus } from "./events";

export interface Tab {
  id: number;
  path: string; // 笔记（.md）或画板（.excalidraw）
}

export interface Pane {
  id: number;
  tabs: Tab[];
  activeTabId: number | null;
}

export type SplitSide = "left" | "right" | "top" | "bottom";
/** 拖拽落区：四边 = 在该侧拆分新栏，center = 加入该栏标签列表 */
export type DropZone = SplitSide | "center";

export type OpenMode = "replace" | "newTab" | "newPane";

interface PaneNode {
  kind: "pane";
  id: number; // 树节点 id（React key / 寻址用）
  paneId: number;
  size: number; // flex-grow 权重（兄弟间分配）
}
interface RowNode {
  kind: "row";
  id: number;
  children: LayoutNode[];
  size: number;
}
interface ColNode {
  kind: "col";
  id: number;
  children: LayoutNode[];
  size: number;
}
export type LayoutNode = PaneNode | RowNode | ColNode;

export class Workspace {
  private panes = new Map<number, Pane>();
  private root: LayoutNode;
  private activePaneId: number;
  private nextPaneId = 2;
  private nextTabId = 1;
  private nextNodeId = 1;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(private bus: EventBus) {
    const pane: Pane = { id: 1, tabs: [], activeTabId: null };
    this.panes.set(1, pane);
    this.root = { kind: "pane", id: this.nextNodeId++, paneId: 1, size: 1 };
    this.activePaneId = 1;
  }

  get layout(): LayoutNode {
    return this.root;
  }
  get active(): Pane {
    return this.panes.get(this.activePaneId) ?? this.firstPane();
  }
  get activePath(): string | null {
    return this.tabOf(this.active)?.path ?? null;
  }
  /** 树顺序的所有栏 */
  get paneList(): Pane[] {
    const out: Pane[] = [];
    const walk = (n: LayoutNode) => {
      if (n.kind === "pane") {
        const p = this.panes.get(n.paneId);
        if (p) out.push(p);
      } else n.children.forEach(walk);
    };
    walk(this.root);
    return out;
  }
  paneOf(id: number): Pane | undefined {
    return this.panes.get(id);
  }

  private firstPane(): Pane {
    const first = this.paneList[0];
    if (first) return first;
    // 不应发生（栏只会清空不会被删光）；兜底重建单栏
    const pane: Pane = { id: this.nextPaneId++, tabs: [], activeTabId: null };
    this.panes.set(pane.id, pane);
    this.root = { kind: "pane", id: this.nextNodeId++, paneId: pane.id, size: 1 };
    this.activePaneId = pane.id;
    return pane;
  }
  private tabOf(pane: Pane): Tab | undefined {
    return pane.tabs.find((t) => t.id === pane.activeTabId);
  }

  // ---- 打开 ----

  /** replace = 活动栏当前标签换内容（空栏则新开标签）；
   *  newTab = 活动栏追加标签并激活（已有同路径标签则只激活它）；
   *  newPane = 在活动栏右侧拆分新栏打开。 */
  open(path: string, mode: OpenMode = "replace") {
    if (mode === "newPane") {
      const paneId = this.splitPane(this.activePaneId, "right");
      this.openInPane(paneId, path, "newTab");
      return;
    }
    this.openInPane(this.activePaneId, path, mode);
  }

  private openInPane(paneId: number, path: string, mode: "replace" | "newTab") {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    if (mode === "newTab") {
      const exist = pane.tabs.find((t) => t.path === path);
      if (exist) {
        if (pane.activeTabId === exist.id && this.activePaneId === paneId) return; // 无变化
        pane.activeTabId = exist.id;
        this.activePaneId = paneId;
        this.bump();
        return;
      }
      const tab: Tab = { id: this.nextTabId++, path };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      this.activePaneId = paneId;
      this.bump();
      return;
    }
    const cur = this.tabOf(pane);
    if (!cur) {
      const tab: Tab = { id: this.nextTabId++, path };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      this.activePaneId = paneId;
      this.bump();
      return;
    }
    if (cur.path === path) return;
    cur.path = path;
    this.activePaneId = paneId;
    this.bump();
  }

  // ---- 拆分 / 关栏（布局树手术） ----

  /** 在 paneId 的指定侧拆分出新栏，返回新栏 id；新栏在布局中与原栏平分原尺寸 */
  splitPane(paneId: number, side: SplitSide): number {
    const newPane: Pane = { id: this.nextPaneId++, tabs: [], activeTabId: null };
    this.panes.set(newPane.id, newPane);
    const newNode: PaneNode = {
      kind: "pane",
      id: this.nextNodeId++,
      paneId: newPane.id,
      size: 1,
    };
    const found = this.findNodeByPane(this.root, paneId);
    if (!found) return newPane.id; // 不应发生
    const { node, replace } = found;
    const horizontal = side === "left" || side === "right";
    const before = side === "left" || side === "top";
    const parent = this.parentOf(this.root, node.id);

    if (parent && (parent.kind === "row") === horizontal) {
      // 同向容器：直接在目标旁插入，两者平分原尺寸
      const idx = parent.children.indexOf(node);
      node.size /= 2;
      newNode.size = node.size;
      parent.children.splice(before ? idx : idx + 1, 0, newNode);
    } else {
      // 异向（或目标是根）：把目标包进新的 row/col 容器
      const wrap: RowNode | ColNode = horizontal
        ? { kind: "row", id: this.nextNodeId++, children: [], size: node.size }
        : { kind: "col", id: this.nextNodeId++, children: [], size: node.size };
      wrap.children = before ? [newNode, node] : [node, newNode];
      node.size = 1;
      newNode.size = 1;
      replace(wrap);
    }
    this.activePaneId = newPane.id;
    this.bump();
    return newPane.id;
  }

  /** 关闭栏：从树中摘除；父容器只剩一个孩子时塌缩提升；只剩一栏时清空标签保留空栏 */
  close(id: number) {
    if (this.paneList.length <= 1) {
      const pane = this.panes.get(id);
      if (!pane) return;
      pane.tabs = [];
      pane.activeTabId = null;
      this.bump();
      return;
    }
    const found = this.findNodeByPane(this.root, id);
    if (!found) return;
    const { node, replace } = found;
    const parent = this.parentOf(this.root, node.id);
    if (!parent) {
      // 根被关（唯一栏关成空栏的分支已在上面处理；这里防御）
      this.panes.delete(id);
      this.firstPane();
      this.bump();
      return;
    }
    const idx = parent.children.indexOf(node);
    parent.children.splice(idx, 1);
    if (parent.children.length === 1) {
      const only = parent.children[0];
      only.size = parent.size; // 塌缩：唯一孩子顶替父容器
      this.replaceNode(parent.id, only);
    }
    this.panes.delete(id);
    if (this.activePaneId === id) {
      // 树顺序的下一栏顶上
      const list = this.paneList;
      this.activePaneId = list[Math.min(idx, list.length - 1)]?.id ?? this.firstPane().id;
    }
    this.bump();
  }

  /** 把 nodeId 为 targetId 的节点替换为 next（可能是根本身） */
  private replaceNode(targetId: number, next: LayoutNode) {
    if (this.root.id === targetId) {
      this.root = next;
      return;
    }
    replaceChild(this.root, targetId, next);
  }

  // ---- 标签操作 ----

  activateTab(paneId: number, tabId: number) {
    const pane = this.panes.get(paneId);
    if (!pane || pane.activeTabId === tabId) return;
    if (!pane.tabs.some((t) => t.id === tabId)) return;
    pane.activeTabId = tabId;
    this.activePaneId = paneId; // 点哪个栏的标签，哪个栏成为活动栏
    this.bump();
  }

  closeTab(paneId: number, tabId: number) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    pane.tabs.splice(idx, 1);
    if (pane.activeTabId === tabId) {
      const next = pane.tabs[idx] ?? pane.tabs[idx - 1];
      pane.activeTabId = next?.id ?? null;
    }
    // 关掉的是最后一个标签且不是唯一栏：整栏从布局移除（无需关栏按钮）
    if (pane.tabs.length === 0 && this.paneList.length > 1) {
      this.close(paneId);
      return;
    }
    this.bump();
  }

  /** 拖拽标签：栏内重排或跨栏移动；toIndex 按移除后的目标栏计算。
   *  移动的标签在目标栏激活，目标栏成为活动栏；源栏失去激活标签时相邻顶上，
   *  被搬空且不是唯一栏时整栏移除（拖唯一标签去拆分 = 挪栏位置）。 */
  moveTab(fromPaneId: number, tabId: number, toPaneId: number, toIndex: number) {
    const from = this.panes.get(fromPaneId);
    const to = this.panes.get(toPaneId);
    if (!from || !to) return;
    const idx = from.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const [tab] = from.tabs.splice(idx, 1);
    if (from !== to && from.activeTabId === tabId) {
      const next = from.tabs[Math.min(idx, from.tabs.length - 1)];
      from.activeTabId = next?.id ?? null;
    }
    to.tabs.splice(Math.max(0, Math.min(toIndex, to.tabs.length)), 0, tab);
    to.activeTabId = tab.id;
    this.activePaneId = toPaneId;
    if (from !== to && from.tabs.length === 0 && this.paneList.length > 1) {
      this.close(fromPaneId); // 源栏被搬空：移除（close 不动 activePaneId，目标栏保持活动）
      return;
    }
    this.bump();
  }

  // ---- 尺寸 / 聚焦 ----

  /** 拖动分隔线：把父容器 children[firstIndex] 与 [firstIndex+1] 的尺寸按 firstRatio 重新分配 */
  resize(parentId: number, firstIndex: number, firstRatio: number) {
    const parent = this.findNode(this.root, parentId);
    if (!parent || parent.kind === "pane") return;
    const a = parent.children[firstIndex];
    const b = parent.children[firstIndex + 1];
    if (!a || !b) return;
    const total = a.size + b.size;
    const r = Math.max(0.05, Math.min(0.95, firstRatio));
    a.size = total * r;
    b.size = total * (1 - r);
    this.bump();
  }

  focus(id: number) {
    if (this.activePaneId === id) return;
    this.activePaneId = id;
    this.bump();
  }

  // ---- 路径联动 ----

  /** 笔记/画板被删除：持有它的标签关闭（相邻标签顶上），被清空的栏一并移除 */
  clearPath(path: string) {
    let changed = false;
    for (const pane of this.panes.values()) {
      let gone = false;
      const idx = pane.tabs.findIndex((t) => t.path === path);
      if (idx < 0) continue;
      pane.tabs = pane.tabs.filter((t) => {
        if (t.path !== path) return true;
        if (t.id === pane.activeTabId) gone = true;
        return false;
      });
      if (gone) {
        const next = pane.tabs[Math.min(idx, pane.tabs.length - 1)];
        pane.activeTabId = next?.id ?? null;
      }
      changed = true;
    }
    if (changed) {
      this.removeEmptyPanes();
      this.bump();
    }
  }

  /** 移除所有空栏（布局里至少保留一栏） */
  private removeEmptyPanes() {
    while (this.paneList.length > 1) {
      const empty = this.paneList.find((p) => p.tabs.length === 0);
      if (!empty) break;
      this.close(empty.id);
    }
  }

  /** 笔记/画板重命名或移动：所有标签的路径跟随 */
  relocate(from: string, to: string) {
    let changed = false;
    for (const pane of this.panes.values()) {
      for (const tab of pane.tabs) {
        if (tab.path === from) {
          tab.path = to;
          changed = true;
        }
      }
    }
    if (changed) this.bump();
  }

  // ---- 树寻址 ----

  private findNode(root: LayoutNode, nodeId: number): LayoutNode | null {
    if (root.id === nodeId) return root;
    if (root.kind === "pane") return null;
    for (const c of root.children) {
      const hit = this.findNode(c, nodeId);
      if (hit) return hit;
    }
    return null;
  }

  /** 找 paneId 对应的叶子节点，replace 用于把该节点换成新节点（父容器内或根） */
  private findNodeByPane(
    root: LayoutNode,
    paneId: number
  ): { node: PaneNode; replace: (n: LayoutNode) => void } | null {
    const parent = this.parentOf(root, -1, paneId);
    if (parent) {
      const node = parent.children.find(
        (c): c is PaneNode => c.kind === "pane" && c.paneId === paneId
      );
      if (!node) return null;
      const idx = parent.children.indexOf(node);
      return {
        node,
        replace: (n) => {
          parent.children[idx] = n;
        },
      };
    }
    if (root.kind === "pane" && root.paneId === paneId) {
      return {
        node: root,
        replace: (n) => {
          this.root = n;
        },
      };
    }
    return null;
  }

  /** 按节点 id 找父容器（任何孩子，含叶子）；paneId >= 0 时改按叶子 paneId 找 */
  private parentOf(root: LayoutNode, nodeId: number, paneId = -1): RowNode | ColNode | null {
    if (root.kind === "pane") return null;
    for (const c of root.children) {
      if (paneId >= 0 && c.kind === "pane" && c.paneId === paneId) return root;
      if (c.id === nodeId) return root;
      const deep = this.parentOf(c, nodeId, paneId);
      if (deep) return deep;
    }
    return null;
  }

  // ---- React 订阅 ----

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

/** 在容器树里把 nodeId 为 targetId 的孩子替换为 next */
function replaceChild(node: LayoutNode, targetId: number, next: LayoutNode): boolean {
  if (node.kind === "pane") return false;
  const idx = node.children.findIndex((c) => c.id === targetId);
  if (idx >= 0) {
    node.children[idx] = next;
    return true;
  }
  return node.children.some((c) => replaceChild(c, targetId, next));
}
