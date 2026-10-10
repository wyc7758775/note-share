// Workspace（工作台聚合）：多栏布局——每栏持有一个编辑会话（笔记路径）。
// 栏是视图会话单元（与 EditingSession 一一对应），笔记域（名录/事件）不受影响。
// 行为：单击在活动栏打开、Ctrl+点击开新栏（上限 3，满了替换最右栏）、关闭、聚焦。

import type { EventBus } from "./events";

export const MAX_PANES = 3;

export interface Pane {
  id: number;
  path: string | null; // null = 空栏（欢迎页）
  /** 栏宽（像素）；未设置 = 平分剩余空间 */
  width?: number;
}

export class Workspace {
  private panes: Pane[] = [{ id: 1, path: null }];
  private activeId = 1;
  private nextId = 2;
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(private bus: EventBus) {}

  get all(): readonly Pane[] {
    return this.panes;
  }
  get active(): Pane {
    return this.panes.find((p) => p.id === this.activeId) ?? this.panes[0];
  }

  /** 单击：在活动栏打开 */
  openInActive(path: string) {
    if (this.active.path === path) return;
    this.active.path = path;
    this.bump();
  }

  /** Ctrl+点击：新栏打开；达上限时替换最右栏 */
  openInNewPane(path: string) {
    if (this.panes.length >= MAX_PANES) {
      const last = this.panes[this.panes.length - 1];
      last.path = path;
      this.activeId = last.id;
    } else {
      const pane: Pane = { id: this.nextId++, path };
      this.panes.push(pane);
      this.activeId = pane.id;
      this.bus.emit({ type: "paneOpened", paneId: pane.id, path });
    }
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
      this.panes[0].path = null;
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

  /** 笔记被删除：持有它的栏清空为空栏 */
  clearPath(path: string) {
    let changed = false;
    for (const p of this.panes) {
      if (p.path === path) {
        p.path = null;
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  /** 笔记重命名/移动：栏内路径跟随 */
  relocate(from: string, to: string) {
    let changed = false;
    for (const p of this.panes) {
      if (p.path === from) {
        p.path = to;
        changed = true;
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
