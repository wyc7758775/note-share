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

export interface Backend {
  mode: "tauri" | "web";
  getVaultName(): Promise<string>;
  /** 弹出系统对话框选择 vault 文件夹（仅桌面模式；web 模式返回 null） */
  pickVault(): Promise<string | null>;
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
  saveAsset(name: string, base64: string): Promise<{ path: string }>;
  readAssetBase64(path: string): Promise<AssetData>;
  /** 保存导出文件到用户选择的位置（桌面模式弹对话框；web 模式返回 null 由前端自行下载） */
  saveTextFile(defaultName: string, content: string): Promise<string | null>;
  /** 下载二进制（图片等）到本地：桌面模式弹保存对话框，web 模式由前端自行下载后返回 null */
  saveBinaryFile(defaultName: string, base64: string): Promise<string | null>;
}
