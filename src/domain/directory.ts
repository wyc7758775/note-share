// NoteDirectory（笔记名录）：name → path 的单一事实来源。
// 订阅领域事件自动维护索引；wikilink 的存在性检测（resolved/dangling）、
// "[[" 菜单的候选列表、双链点击跳转，全部问它，不再各自维护名单。

import { backend, type TreeNode } from "../backend";
import type { EventBus } from "./events";

export type RefResolution =
  | { kind: "resolved"; path: string }
  | { kind: "dangling" };

export interface DirEntry {
  name: string; // 不含 .md
  path: string;
}

export class NoteDirectory {
  private entries: DirEntry[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private off: (() => void) | null = null;

  constructor(private bus: EventBus) {}

  /** 订阅领域事件并从文件树初始化（App 顶层调用一次） */
  async init() {
    if (this.off) return;
    this.off = this.bus.on(["noteCreated", "noteRenamed", "noteMoved", "noteTrashed"], (e) => {
      if (e.type === "noteCreated") {
        this.entries.push({ name: e.name, path: e.path });
      } else if (e.type === "noteRenamed" || e.type === "noteMoved") {
        const hit = this.entries.find((n) => n.path === e.from);
        if (hit) {
          hit.path = e.to;
          hit.name = e.name;
        } else {
          this.entries.push({ name: e.name, path: e.to });
        }
      } else if (e.type === "noteTrashed") {
        this.entries = this.entries.filter((n) => n.path !== e.path);
      }
      this.bump();
    });
    await this.reload();
  }

  /** 从文件树全量重建（启动/切仓库时） */
  async reload() {
    const flat: DirEntry[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.kind === "note") flat.push({ name: n.name.replace(/\.md$/i, ""), path: n.path });
        else if (n.kind === "folder") walk(n.children ?? []);
      }
    };
    walk(await backend.tree());
    this.entries = flat;
    this.bump();
  }

  /** wikilink 名字解析：存在则给路径，不存在则待创建 */
  resolve(name: string): RefResolution {
    const hit = this.entries.find((n) => n.name === name);
    return hit ? { kind: "resolved", path: hit.path } : { kind: "dangling" };
  }

  all(): DirEntry[] {
    return this.entries;
  }

  /** React 订阅（useSyncExternalStore） */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  dispose() {
    this.off?.();
    this.off = null;
  }
}
