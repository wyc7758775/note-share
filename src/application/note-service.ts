// NoteService（应用服务）：笔记用例的唯一写路径——创建/重命名/回收/发布。
// 只有这里调用 backend 写接口；完成后发领域事件，投影（名录/文件树/阅读位置）自行订阅更新。

import { backend, type TreeNode } from "../backend";
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

  /** 移动笔记到指定文件夹（目录树拖拽）；标题不变，发 noteMoved（名录/阅读位置自动迁移） */
  async moveNote(path: string, toFolder: string): Promise<string | null> {
    const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
    const to = await backend.movePath(path, toFolder);
    this.bus.emit({ type: "noteMoved", from: path, to, name });
    return to;
  }

  /**
   * 移动附件（图片/画板）到指定文件夹：
   * - 画板（.excalidraw）的预览 PNG 成对跟随
   * - 扫描所有笔记，把引用该附件的路径（![[x]] 与 ![alt|w](x) 两种写法）同步改写为新路径
   * - 发 assetMoved
   */
  async moveAsset(path: string, toFolder: string): Promise<string | null> {
    const to = await backend.movePath(path, toFolder);
    // 画板预览 PNG 成对移动（引用极少但顺手同步）
    if (/\.excalidraw$/i.test(path)) {
      const pngFrom = path.replace(/\.excalidraw$/i, ".png");
      try {
        const movedPng = await backend.movePath(pngFrom, toFolder);
        await this.rewriteReferences(pngFrom, movedPng);
      } catch {
        /* 没有预览 PNG 就跳过 */
      }
    }
    await this.rewriteReferences(path, to);
    this.bus.emit({ type: "assetMoved", from: path, to });
    return to;
  }

  /** 把 vault 中所有笔记里对 oldPath 的引用（![[x]] 与 ![alt|w](x)）改写为 newPath */
  private async rewriteReferences(oldPath: string, newPath: string): Promise<void> {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`(!\\[\\[)${esc(oldPath)}(\\]\\])`, "g"),
      new RegExp(`(\\]\\()${esc(oldPath)}(\\s+"[^"]*"\\)|\\))`, "g"),
    ];
    const notes: string[] = [];
    const collect = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (n.kind === "note") notes.push(n.path);
        else if (n.kind === "folder" && n.children) collect(n.children);
      }
    };
    collect(await backend.tree());
    for (const notePath of notes) {
      try {
        const { raw } = await backend.readNote(notePath);
        let next = raw;
        for (const re of patterns) next = next.replace(re, `$1${newPath}$2`);
        if (next !== raw) await backend.writeNote(notePath, next);
      } catch {
        /* 读不了的跳过 */
      }
    }
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
