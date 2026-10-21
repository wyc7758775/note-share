// 领域事件与类型化事件总线：替代散落的 window CustomEvent，
// UI 与投影（名录/文件树/阅读位置）只订阅事件，不互相调用。

export interface NoteCreated {
  type: "noteCreated";
  name: string; // 不含 .md
  path: string;
}
export interface NoteRenamed {
  type: "noteRenamed";
  from: string;
  to: string;
  name: string; // 新标题（不含 .md）
}
export interface NoteMoved {
  type: "noteMoved";
  from: string;
  to: string;
  name: string; // 标题不变（不含 .md）
}
export interface AssetMoved {
  type: "assetMoved";
  from: string;
  to: string; // 附件（图片/画板）移动，引用它的笔记已同步改写
}
export interface AssetCreated {
  type: "assetCreated";
  path: string; // 新建的附件（如手绘场景文件）
}
export interface NoteTrashed {
  type: "noteTrashed";
  path: string;
}
export interface NotePublished {
  type: "notePublished";
  path: string;
  slug: string;
}
/** 请求当前编辑器立即保存（发布面板等用） */
export interface SaveRequested {
  type: "saveRequested";
}
export interface PaneOpened {
  type: "paneOpened";
  paneId: number;
  path: string;
}
export interface PaneClosed {
  type: "paneClosed";
  paneId: number;
}
/** 画板场景已保存（PNG 预览已导出）；编辑器里的画板卡片据此刷新预览 */
export interface SceneSaved {
  type: "sceneSaved";
  path: string;
}
/** 笔记会话锁定状态切换（SessionBook.toggle 广播） */
export interface LockToggled {
  type: "lockToggled";
  path: string;
  mode: "editing" | "locked";
}
/** 偏好（语言/字号/主题/主题色）变更；载荷为完整 config（订阅方无需回查聚合） */
export interface PreferencesChanged {
  type: "preferencesChanged";
  config: import("./preferences").PreferencesConfig;
}

export type DomainEvent =
  | NoteCreated
  | NoteRenamed
  | NoteMoved
  | AssetMoved
  | AssetCreated
  | NoteTrashed
  | NotePublished
  | SaveRequested
  | PaneOpened
  | PaneClosed
  | SceneSaved
  | LockToggled
  | PreferencesChanged;
export type DomainEventType = DomainEvent["type"];

export class EventBus {
  private handlers = new Map<DomainEventType, Set<(e: DomainEvent) => void>>();

  on(types: DomainEventType | DomainEventType[], fn: (e: DomainEvent) => void): () => void {
    const list = Array.isArray(types) ? types : [types];
    const offs = list.map((t) => {
      let set = this.handlers.get(t);
      if (!set) this.handlers.set(t, (set = new Set()));
      set.add(fn);
      return () => set!.delete(fn);
    });
    return () => offs.forEach((off) => off());
  }

  emit(e: DomainEvent) {
    this.handlers.get(e.type)?.forEach((fn) => fn(e));
  }
}
