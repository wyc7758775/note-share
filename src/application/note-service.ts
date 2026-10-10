// NoteService（应用服务）：笔记用例的唯一写路径——创建/重命名/回收/发布。
// 只有这里调用 backend 写接口；完成后发领域事件，投影（名录/文件树/阅读位置）自行订阅更新。

import { backend } from "../backend";
import type { EventBus } from "../domain/events";
import { Note } from "../domain/note";
import { sanitizeFileName } from "../lib/files";

export class NoteService {
  constructor(private bus: EventBus) {}

  /** 创建笔记（默认在当前笔记的同级目录），发 noteCreated */
  async create(name: string, folder = ""): Promise<string | null> {
    const safe = sanitizeFileName(name);
    if (!safe) return null;
    const path = await backend.createNote(folder, safe);
    this.bus.emit(Note.created(safe, path));
    return path;
  }

  /** 重命名（标题即文件名），发 noteRenamed；返回新路径 */
  async rename(oldPath: string, newTitle: string): Promise<string | null> {
    const safe = sanitizeFileName(newTitle);
    if (!safe) return null;
    const newPath = await backend.renamePath(oldPath, `${safe}.md`);
    this.bus.emit({
      type: "noteRenamed",
      from: oldPath,
      to: newPath,
      name: safe,
    });
    return newPath;
  }

  /** 移入回收站，发 noteTrashed */
  async trash(path: string): Promise<void> {
    await backend.deletePath(path);
    this.bus.emit({ type: "noteTrashed", path });
  }

  /** 请求当前编辑器立即保存（发布前等场景） */
  requestSave() {
    this.bus.emit({ type: "saveRequested" });
  }

  /** 发布到服务器：上传文章 HTML，成功后发 notePublished */
  async publish(args: {
    path: string;
    base: string;
    token: string;
    slug: string;
    title: string;
    html: string;
    tags: string[];
    date: string;
  }): Promise<{ url: string }> {
    const res = await fetch(`${args.base}/api/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        slug: args.slug,
        title: args.title,
        html: args.html,
        tags: args.tags,
        date: args.date,
      }),
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    }
    const data = (await res.json()) as { url: string };
    this.bus.emit({ type: "notePublished", path: args.path, slug: args.slug });
    return data;
  }
}
