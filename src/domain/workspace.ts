// Workspace（工作台聚合）：多栏布局，每栏持有一组标签页（Tab）。
// 栏是布局单元，标签是会话单元——标签可装笔记（.md）或画板（.excalidraw）。
// 行为：单击在活动栏当前标签打开、Ctrl+点击开新标签、Ctrl+Shift+点击开新栏
//（上限 3 栏，满了替换最右栏）、关闭标签/栏、聚焦、拖宽。
// 路径的删除/重命名联动（clearPath/relocate）作用于所有栏的所有标签。

import type { EventBus } from "./events";

export const MAX_PANES = 3;

export interface Tab {
  id: number;
  path: string; // 笔记（.md）或画板（.excalidraw）
}

export interface Pane {
  id: number;
  tabs: Tab[];
  activeTabId: number | null;
  /** 栏宽（像素）；未设置 = 平分剩余空间 */
  width?: number;
}

export type OpenMode = "replace" | "newTab" | "newPane";

export class Workspace {
  private panes: Pane[] = [{ id: 1, tabs: [], activeTabId: null }];
  private activeId = 1;
  private nextPaneId = 2;
  private nextTabId = 1;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(private bus: EventBus) {}

  get all(): readonly Pane[] {
    return this.panes;
  }
  get active(): Pane {
    return this.panes.find((p) => p.id === this.activeId) ?? this.panes[0];
  }
  /** 活动栏激活标签的路径；空栏为 null */
  get activePath(): string | null {
    return this.tabOf(this.active)?.path ?? null;
  }

  private tabOf(pane: Pane): Tab | undefined {
    return pane.tabs.find((t) => t.id === pane.activeTabId);
  }

  /** 打开：replace = 活动栏当前标签换内容（空栏则新开标签）；
   *  newTab = 活动栏追加标签并激活（已有同路径标签则只激活它）；
   *  newPane = 新栏打开（达上限替换最右栏）。 */
  open(path: string, mode: OpenMode = "replace") {
    if (mode === "newPane") {
      if (this.panes.length >= MAX_PANES) {
        const last = this.panes[this.panes.length - 1];
        const tab: Tab = { id: this.nextTabId++, path };
        last.tabs = [tab];
        last.activeTabId = tab.id;
        this.activeId = last.id;
      } else {
        const tab: Tab = { id: this.nextTabId++, path };
        const pane: Pane = { id: this.nextPaneId++, tabs: [tab], activeTabId: tab.id };
        this.panes.push(pane);
        this.activeId = pane.id;
        this.bus.emit({ type: "paneOpened", paneId: pane.id, path });
      }
      this.bump();
      return;
    }
    const pane = this.active;
    if (mode === "newTab") {
      const exist = pane.tabs.find((t) => t.path === path);
      if (exist) {
        if (pane.activeTabId !== exist.id) {
          pane.activeTabId = exist.id;
          this.bump();
        }
        return;
      }
      const tab: Tab = { id: this.nextTabId++, path };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      this.bump();
      return;
    }
    // replace
    const cur = this.tabOf(pane);
    if (!cur) {
      const tab: Tab = { id: this.nextTabId++, path };
      pane.tabs.push(tab);
      pane.activeTabId = tab.id;
      this.bump();
      return;
    }
    if (cur.path === path) return;
    cur.path = path;
    this.bump();
  }

  /** 激活栏内标签 */
  activateTab(paneId: number, tabId: number) {
    const pane = this.panes.find((p) => p.id === paneId);
    if (!pane || pane.activeTabId === tabId) return;
    if (!pane.tabs.some((t) => t.id === tabId)) return;
    pane.activeTabId = tabId;
    this.bump();
  }

  /** 关闭标签：删掉的是激活标签时相邻标签顶上；最后一个标签删完栏变空栏（保留布局） */
  closeTab(paneId: number, tabId: number) {
    const pane = this.panes.find((p) => p.id === paneId);
    if (!pane) return;
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    pane.tabs.splice(idx, 1);
    if (pane.activeTabId === tabId) {
      const next = pane.tabs[idx] ?? pane.tabs[idx - 1];
      pane.activeTabId = next?.id ?? null;
    }
    this.bump();
  }

  /** 拖拽标签：栏内重排或跨栏移动；toIndex 按移除后的目标栏计算。
   *  移动的标签在目标栏激活，目标栏成为活动栏；源栏失去激活标签时相邻顶上。 */
  moveTab(fromPaneId: number, tabId: number, toPaneId: number, toIndex: number) {
    const from = this.panes.find((p) => p.id === fromPaneId);
    const to = this.panes.find((p) => p.id === toPaneId);
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
    this.activeId = to.id;
    this.bump();
  }

  /** 调整栏宽（拖动分隔线）；低于最小宽度会被忽略 */
  setSize(id: number, width: number) {
    const pane = this.panes.find((p) => p.id === id);
    if (!pane || width < 240) return;
    pane.width = Math.round(width);
    this.bump();
  }

  /** 聚焦某栏（点击栏内任意处） */
  focus(id: number) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.bump();
  }

  /** 关闭栏：仅剩一栏时清空为空栏而不是移除 */
  close(id: number) {
    const idx = this.panes.findIndex((p) => p.id === id);
    if (idx < 0) return;
    if (this.panes.length === 1) {
      this.panes[0].tabs = [];
      this.panes[0].activeTabId = null;
      this.bump();
      return;
    }
    this.panes.splice(idx, 1);
    if (this.activeId === id) {
      this.activeId = this.panes[Math.min(idx, this.panes.length - 1)].id;
    }
    this.bus.emit({ type: "paneClosed", paneId: id });
    this.bump();
  }

  /** 笔记/画板被删除：持有它的标签关闭（相邻标签顶上） */
  clearPath(path: string) {
    let changed = false;
    for (const pane of this.panes) {
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
    if (changed) this.bump();
  }

  /** 笔记/画板重命名或移动：所有标签的路径跟随 */
  relocate(from: string, to: string) {
    let changed = false;
    for (const pane of this.panes) {
      for (const tab of pane.tabs) {
        if (tab.path === from) {
          tab.path = to;
          changed = true;
        }
      }
    }
    if (changed) this.bump();
  }

  /** React 订阅 */
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
