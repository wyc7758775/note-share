// EditingSession（编辑会话聚合）：编辑模式、阅读位置记忆、待落盘快照。
// 生命周期与编辑器视图一致；"锁定中"是会话状态而非笔记属性。
// 阅读位置按笔记路径记忆在内存（刷新页面即清空），领域事件驱动迁移与清理。

import type { EventBus } from "./events";

export type SessionMode = "editing" | "locked";

export class ReadingPositions {
  private map = new Map<string, number>();

  constructor(bus: EventBus) {
    bus.on(["noteRenamed", "noteTrashed"], (e) => {
      if (e.type === "noteRenamed") {
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

  toggleLock() {
    this.mode = this.mode === "editing" ? "locked" : "editing";
    return this.mode;
  }

  get locked() {
    return this.mode === "locked";
  }
}
