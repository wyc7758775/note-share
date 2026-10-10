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

/** 单行 markdown 清理（去标题/引用/列表/链接前缀），供预览展示 */
export function previewLine(l: string): string {
  return l
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*]\s*(\[[ xX]\]\s*)?/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^!\[\[|\[\[/, "")
    .trim();
}

/** 从笔记正文生成预览：前 N 行非空内容（markdown 前缀已清理） */
export function previewLines(body: string, count: number, maxChars = 80): string[] {
  const out: string[] = [];
  for (const l0 of body.split("\n")) {
    const l = previewLine(l0);
    if (!l || l === "---" || l.startsWith("```")) continue;
    out.push(l.slice(0, maxChars));
    if (out.length >= count) break;
  }
  return out;
}
