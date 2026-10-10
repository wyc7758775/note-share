// EditingSession（编辑会话聚合）：编辑模式、阅读位置记忆、待落盘快照。
// "锁定中"是会话状态而非笔记属性；会话由 SessionBook 按路径全局登记，
// 多栏打开同一笔记共享锁定状态（toggle 经事件广播，标签条菜单/快捷键统一走这里）。
// 阅读位置按笔记路径记忆在内存（刷新页面即清空），领域事件驱动迁移与清理。

import type { EventBus } from "./events";

export type SessionMode = "editing" | "locked";

export class ReadingPositions {
  private map = new Map<string, number>();

  constructor(bus: EventBus) {
    bus.on(["noteRenamed", "noteMoved", "noteTrashed"], (e) => {
      if (e.type === "noteRenamed" || e.type === "noteMoved") {
        const v = this.map.get(e.from);
        if (v !== undefined) {
          this.map.set(e.to, v);
          this.map.delete(e.from);
        }
      } else if (e.type === "noteTrashed") {
        this.map.delete(e.path);
      }
    });
  }

  remember(path: string, top: number) {
    if (top > 0) this.map.set(path, top);
    else this.map.delete(path);
  }

  recall(path: string): number {
    return this.map.get(path) ?? 0;
  }
}

export class EditingSession {
  mode: SessionMode = "editing";
  /** 编辑事件发生瞬间的 markdown 快照（编辑器销毁后兜底落盘用） */
  pendingMarkdown: string | null = null;

  constructor(
    readonly notePath: string,
    readonly positions: ReadingPositions
  ) {}

  get locked() {
    return this.mode === "locked";
  }
}

/** 会话登记簿：按笔记路径全局持有会话；锁定切换发 lockToggled 事件 */
export class SessionBook {
  private map = new Map<string, EditingSession>();

  constructor(private bus: EventBus, private positions: ReadingPositions) {
    bus.on(["noteRenamed", "noteMoved", "noteTrashed"], (e) => {
      if (e.type === "noteRenamed" || e.type === "noteMoved") {
        const s = this.map.get(e.from);
        if (s) {
          this.map.delete(e.from);
          this.map.set(e.to, s);
        }
      } else if (e.type === "noteTrashed") {
        this.map.delete(e.path);
      }
    });
  }

  get(path: string): EditingSession {
    let s = this.map.get(path);
    if (!s) {
      s = new EditingSession(path, this.positions);
      this.map.set(path, s);
    }
    return s;
  }

  mode(path: string): SessionMode {
    return this.get(path).mode;
  }

  /** 锁定/解锁（唯一入口），广播 lockToggled */
  toggle(path: string): SessionMode {
    const s = this.get(path);
    s.mode = s.mode === "editing" ? "locked" : "editing";
    this.bus.emit({ type: "lockToggled", path, mode: s.mode });
    return s.mode;
  }
}
