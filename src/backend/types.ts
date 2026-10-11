// 后端契约：前端所有文件操作都走这套接口。
// 同一套契约有两个实现：
//   - tauri.ts  ：打包成桌面应用后，通过 Tauri invoke 调 Rust
//   - web.ts    ：浏览器开发/测试模式下，走 /api 调 scripts/dev-server.mjs
// 路径一律使用 vault 相对路径、正斜杠分隔。

export type NodeKind = "folder" | "note" | "asset" | "other";

export interface TreeNode {
  name: string;
  path: string;
  kind: NodeKind;
  children?: TreeNode[];
}

export interface NoteRaw {
  path: string;
  raw: string; // 完整文件内容，含 frontmatter
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface SavedScene {
  scenePath: string;
  pngPath: string;
}

export interface AssetData {
  base64: string;
  mime: string;
}

/** 注册表里的一个仓库（exists = 目录仍可访问，缺失的 UI 上标灰） */
export interface VaultInfo {
  id: string;
  name: string;
  path: string; // 绝对路径；web 模式为 VAULT_DIR
  lastOpenedAt: number; // unix 秒
  exists: boolean;
}

export interface VaultList {
  vaults: VaultInfo[];
  active: string | null; // 上次打开的仓库路径（列表按 lastOpenedAt 取最新）
}

export interface Backend {
  mode: "tauri" | "web";
  /** 仓库注册表（桌面端权威在应用配置目录 vaults.json；web 模式恒为 VAULT_DIR 单条） */
  listVaults(): Promise<VaultList>;
  /** 打开（登记并激活）一个仓库文件夹，返回最新引用；目录不存在时报错 */
  openVault(path: string): Promise<VaultInfo>;
  /** 在 parent 下新建仓库文件夹（含 .noteshare 清单）并激活 */
  createVault(parent: string, name: string): Promise<VaultInfo>;
  /** 仅从注册表移除，不碰磁盘 */
  removeVault(path: string): Promise<void>;
  /** 弹系统对话框选一个文件夹（只选路径不打开；web 模式返回 null） */
  pickFolder(): Promise<string | null>;
  tree(): Promise<TreeNode[]>;
  readNote(path: string): Promise<NoteRaw>;
  writeNote(path: string, raw: string): Promise<void>;
  /** 在指定文件夹下新建笔记，返回最终路径（重名自动加序号） */
  createNote(folder: string, title: string): Promise<string>;
  createFolder(parent: string, name: string): Promise<string>;
  /** 同一文件夹内重命名（含改标题） */
  renamePath(from: string, newName: string): Promise<string>;
  /** 移动到指定文件夹（目录树拖拽）；撞名自动加序号 */
  movePath(from: string, toFolder: string): Promise<string>;
  /** 移入 vault 内 .trash/（Obsidian 同款回收站约定） */
  deletePath(path: string): Promise<void>;
  search(q: string): Promise<SearchHit[]>;
  readScene(path: string): Promise<string>; // excalidraw 场景 JSON 原文
  saveScene(
    name: string | null,
    sceneJson: string,
    pngBase64: string | null,
    folder?: string
  ): Promise<SavedScene>;
  /** 新建空白白板（Obsidian 式 .canvas JSON），返回最终路径；folder 为空 = vault 根 */
  createCanvas(folder?: string, name?: string): Promise<string>;
  saveAsset(name: string, base64: string): Promise<{ path: string }>;
  readAssetBase64(path: string): Promise<AssetData>;
  /** 保存导出文件到用户选择的位置（桌面模式弹对话框；web 模式返回 null 由前端自行下载） */
  saveTextFile(defaultName: string, content: string): Promise<string | null>;
  /** 下载二进制（图片等）到本地：桌面模式弹保存对话框，web 模式由前端自行下载后返回 null */
  saveBinaryFile(defaultName: string, base64: string): Promise<string | null>;
}
