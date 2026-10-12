// OutlineStore（Home 大纲聚合）：Home.md 的内存权威 + 解析索引 + 防抖保存。
// Home 标签全局去重，任意时刻至多一个编辑器实例：
//   - 编辑器 onUpdate → edit(md)：更新内存文本（搜索/嵌入实时跟随草稿）并防抖落盘；
//   - 文本层外部改写（引用懒挂 ^id）走 ensureBlockId：先 flush，再改文本，
//     然后经 syncToEditor 把新内容灌回已挂载的编辑器。
import { backend } from "../backend";
import {
  addressById,
  breadcrumbOf,
  flattenOutline,
  firstLine,
  genBlockId,
  nodeAtAddress,
  nodeById,
  parseOutline,
  assignBlockId,
  subtreeMarkdown,
  type OutlineNode,
} from "./parse";

/** Home 大纲文件：vault 根目录固定名，文件树隐藏、不可改名/移动/回收 */
export const HOME_PATH = "Home.md";

/** 空大纲的种子：第一条空条目（空文档里直接输入会落到顶层段落、脱离列表结构） */
const FIRST_ITEM = "- [ ] ";

export interface OutlineSearchRow {
  node: OutlineNode;
  /** 祖先文本（不含自身） */
  path: string[];
}

export type OutlineSaveState = "idle" | "saving" | "saved" | "error";

export class OutlineStore {
  private version = 0;
  private listeners = new Set<() => void>();
  private nodes: OutlineNode[] = [];
  private text = "";
  private loaded = false;
  private initP: Promise<void> | null = null;
  private saveTimer: number | null = null;
  private saving = false;
  private dirty = false;
  private saveState: OutlineSaveState = "idle";
  /** Home 编辑器挂载时注册：外部改写后把磁盘格式内容灌回编辑器 */
  private syncToEditor: ((diskMarkdown: string) => void) | null = null;

  /** 编辑器注册/注销内容同步回调（挂载注册、卸载传 null） */
  registerSync(fn: ((diskMarkdown: string) => void) | null) {
    this.syncToEditor = fn;
  }

  /** 首次使用时载入（幂等）；文件不存在则建空文件 */
  init(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.initP) return this.initP;
    this.initP = (async () => {
      try {
        const { raw } = await backend.readNote(HOME_PATH);
        this.text = raw;
      } catch {
        this.text = "";
        try {
          await backend.writeNote(HOME_PATH, FIRST_ITEM);
        } catch {
          /* 建不了就纯内存，之后保存会再试 */
        }
      }
      // 空文件（或被删光列表后的空段落）播种首个空条目，保证输入始终落在大纲结构里
      if (parseOutline(this.text).length === 0) this.text = FIRST_ITEM;
      this.loaded = true;
      this.reparse();
      this.bump();
    })();
    return this.initP;
  }

  /** 磁盘格式全文（未经 forEditor 转换） */
  get markdown(): string {
    return this.text;
  }
  getNodes(): OutlineNode[] {
    return this.nodes;
  }
  getSaveState(): OutlineSaveState {
    return this.saveState;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  /** 编辑器内容变化（md 为 forSave 后的磁盘格式） */
  edit(md: string) {
    if (md === this.text && !this.dirty) return;
    this.text = md;
    this.dirty = true;
    this.reparse();
    this.bump();
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(), 1200);
  }

  /** 立即落盘（切标签/卸载/外部改写前调用） */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty || this.saving) await this.persist();
  }

  private async persist() {
    if (this.saving) return;
    this.saving = true;
    this.saveState = "saving";
    this.bump();
    try {
      await backend.writeNote(HOME_PATH, this.text);
      this.dirty = false;
      this.saveState = "saved";
    } catch {
      this.saveState = "error";
    } finally {
      this.saving = false;
      this.bump();
    }
  }

  private reparse() {
    this.nodes = parseOutline(this.text);
  }

  /** 子串搜索（标题 + #tag 都在文本里）；上限 30 条 */
  search(q: string): OutlineSearchRow[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return flattenOutline(this.nodes)
      .filter((r) => r.node.text.toLowerCase().includes(needle))
      .slice(0, 30)
      .map((r) => ({ node: r.node, path: r.path }));
  }

  nodeById(id: string): OutlineNode | null {
    return nodeById(this.nodes, id);
  }

  /** 嵌入渲染：id → 子树 markdown；找不到返回 null（节点已删） */
  subtreeMarkdownById(id: string): string | null {
    const n = nodeById(this.nodes, id);
    return n ? subtreeMarkdown(n) : null;
  }

  /** id → 面包屑（祖先文本，含自身） */
  breadcrumbById(id: string): string[] | null {
    const n = nodeById(this.nodes, id);
    return n ? breadcrumbOf(n, this.nodes) : null;
  }

  addressById(id: string): number[] | null {
    return addressById(this.nodes, id);
  }

  nodeTextAtAddress(address: number[]): string | null {
    return firstLine(nodeAtAddress(this.nodes, address)?.text ?? "") || null;
  }

  /** 按地址取整棵子树（转为笔记等用） */
  subtreeAt(address: number[]): OutlineNode | null {
    return nodeAtAddress(this.nodes, address);
  }

  /** 给 address 处节点懒挂块 id（被引用前调用），返回 id；找不到返回 null */
  async ensureBlockId(address: number[]): Promise<string | null> {
    await this.flush();
    const node = nodeAtAddress(this.nodes, address);
    if (!node) return null;
    if (node.id) return node.id;
    const id = genBlockId();
    const next = assignBlockId(this.text, address, id);
    if (next === this.text) return node.id; // 已有 id（不该走到）
    this.text = next;
    this.dirty = false;
    try {
      await backend.writeNote(HOME_PATH, this.text);
      this.saveState = "saved";
    } catch {
      this.saveState = "error";
    }
    this.reparse();
    this.bump();
    this.syncToEditor?.(this.text);
    return id;
  }

  dispose() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.registerSync(null);
  }
}
