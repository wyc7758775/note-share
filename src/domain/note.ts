// Note 聚合：笔记的业务规则与领域事件构造。
// 磁盘是持久层，聚合负责"改什么、发什么事件"；IO 由 NoteService 编排。

import type { NoteCreated, NoteRenamed, NoteTrashed } from "./events";

export interface NoteState {
  path: string;
  title: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  slug?: string;
}

export const TRASH_DIR = ".trash";

export function noteName(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
}

export const Note = {
  /** 重命名规则：标题转安全文件名；同名目录下由持久层保证唯一（服务层处理撞名） */
  rename(state: NoteState, newTitle: string): NoteRenamed {
    return {
      type: "noteRenamed",
      from: state.path,
      to: "", // 实际新路径由服务层落盘后回填
      name: newTitle.replace(/\.md$/i, ""),
    };
  },

  /** 移入回收站（软删除） */
  trash(state: NoteState): NoteTrashed {
    return { type: "noteTrashed", path: state.path };
  },

  created(name: string, path: string): NoteCreated {
    return { type: "noteCreated", name, path };
  },

  isPublished(state: NoteState): boolean {
    return !!state.publishedAt;
  },
};
