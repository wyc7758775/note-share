// 界面设置（语言 / 主题）：Context + localStorage 持久化。
// t(key, vars) 支持模板变量替换 {name}；主题 "system" 跟随系统并监听变化。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";
export type Theme = "light" | "dark" | "system";
type Vars = Record<string, string | number>;

const zh: Record<string, string> = {
  // ---- 通用 ----
  cancel: "取消",
  close: "关闭",
  closeEsc: "关闭（Esc）",
  rename: "重命名",
  delete: "删除",
  trash: "移入回收站",
  newNote: "新建笔记",
  newFolder: "新建文件夹",
  untitled: "无标题",
  untitledNote: "未命名笔记",
  downloadFailed: "下载失败",
  prevImage: "上一张（←）",
  nextImage: "下一张（→）",
  readFail: "读取笔记失败",

  // ---- 侧栏 ----
  tabFiles: "文件",
  tabSearch: "搜索",
  searchPlaceholder: "搜索标题与全文…",
  noResults: "没有找到「{q}」",
  newFolderPlaceholder: "新文件夹名称，回车创建",
  vaultSwitchTip: "点击切换笔记仓库文件夹",
  vaultWebTip: "浏览器模式：启动时用 VAULT_DIR 环境变量指定仓库",
  settings: "设置",

  // ---- 编辑器顶栏 / 菜单 ----
  collapseSidebar: "收起左侧栏",
  expandSidebar: "展开左侧栏",
  navBack: "上一页",
  navForward: "下一页",
  more: "更多操作",
  lockReading: "锁定阅读（{mod}）",
  unlockEdit: "解锁编辑（{mod}）",
  publishExportMenu: "发布 / 导出…",
  deleteNote: "删除笔记…",
  confirmTrash: "确认移入回收站",
  saveErrorHint: "保存失败（重试 {mod}S）",
  backToNote: "← 返回笔记",
  editorPlaceholder: "开始写点什么…（# 标题 · 1. 列表 · - [ ] 待办 · ``` 代码）",
  tagsPlaceholder: "标签，用逗号分隔",

  // ---- 正文右键菜单 ----
  cut: "剪切",
  copy: "复制",
  paste: "粘贴",
  selectAll: "全选",
  undo: "撤销",
  redo: "重做",
  bold: "加粗",
  italic: "斜体",
  strike: "删除线",
  inlineCode: "行内代码",
  codeBlock: "代码块",
  blockquote: "引用",
  taskList: "待办清单",
  divider: "分隔线",

  // ---- 图片 / 画板 ----
  viewLarge: "查看大图",
  downloadImage: "下载图片",
  deleteImage: "删除图片",
  editCanvas: "编辑画板",
  deleteCanvasBlock: "删除画板块",
  deleteCanvasKeep: "删除画板块（文件保留在 attachments）",
  downloadPng: "下载预览图",
  imgTitleEdit: "单击选中（可拖角缩放，Delete 删除）· 双击查看大图",
  imgTitleLock: "双击查看大图",
  sceneTitle: "画板",
  autosaveOn: "实时保存已开启",
  autosaving: "自动保存中…",
  autosaveRetry: "保存失败，仍在重试",
  emptyCanvas: "空画板",
  emptyCanvasHint: "空画板 · 点击开始绘制（会自动保存为 .excalidraw 文件）",
  canvasReadyHint: "画板已有内容 · 点击编辑生成预览图",
  sceneLoading: "画板加载中…",
  sceneAlt: "excalidraw 画板",

  // ---- 斜杠命令 ----
  slImage: "图片",
  slImageDesc: "上传本地图片插入笔记",
  slCanvas: "画板",
  slCanvasDesc: "插入 Excalidraw 手绘图",
  slTask: "待办清单",
  slTaskDesc: "可勾选的任务列表",
  slCode: "代码块",
  slCodeDesc: "带语法高亮",
  slQuote: "引用",
  slQuoteDesc: "摘录或批注",
  slHr: "分隔线",
  slHrDesc: "章节之间的水平线",
  slH1: "一级标题",
  slH1Desc: "大标题",
  slH2: "二级标题",
  slH2Desc: "中标题",

  // ---- 文件树 ----
  newNoteHere: "在此新建笔记",
  trashLabel: "删除（移入回收站）",
  confirmAgain: "再次点击确认移入回收站",
  open: "打开",
  viewAsset: "查看图片",
  clickToView: "点击查看图片",
  clickToEdit: "点击在右侧编辑画板",
  clickCanvas: "点击查看画板",
  wikilinkMissingTip: "笔记不存在 · 点击创建",
  wikilinkMissingCard: "笔记不存在 · 点击创建",

  // ---- 空状态 / 首启 ----
  emptyHint: "左侧选择一篇笔记，或",
  noVaultHint: "还没有选择笔记库文件夹",
  pickVaultBtn: "选择文件夹（可用已有的 Obsidian 库）",

  // ---- 发布 / 导出 ----
  publishTitle: "发布 / 导出",
  exportHtmlTitle: "导出单文件 HTML",
  exportHtmlDesc: "图片全部内嵌成一个 .html 文件，微信/网盘发给别人，双击就能看",
  exportNow: "立即导出",
  exporting: "导出中…",
  exportedTo: "已导出到 {path}",
  exportedDownload: "已下载 {name}（单文件，图片已内嵌，双击即可打开）",
  exportFail: "导出失败，请看控制台",
  pubServerTitle: "发布到我的服务器",
  pubServerDesc: "文章会传到你部署的发布服务上，任何人通过链接访问（server/publish-server.mjs）",
  serverPlaceholder: "服务器地址，如 http://123.45.67.89:8787",
  tokenPlaceholder: "访问令牌 Token（服务器环境变量 TOKEN）",
  linkPath: "链接路径",
  shuffle: "换一个",
  shuffleTip: "随机生成",
  copied: "已复制",
  copyLink: "复制链接",
  pubOverwrite: "同一 slug 重复发布会覆盖更新",
  publish: "发布",
  publishing: "发布中…",
  pubOk: "发布成功！",
  pubNeedServer: "请先填写服务器地址",
  pubNeedSlug: "请填写路径名 slug",
  pubFail: "发布失败：{msg}",

  // ---- 设置弹窗 ----
  settingsLanguage: "界面语言",
  settingsTheme: "主题",
  themeLight: "明亮",
  themeDark: "黑色",
  themeSystem: "跟随系统",
};

const en: Record<string, string> = {
  cancel: "Cancel",
  close: "Close",
  closeEsc: "Close (Esc)",
  rename: "Rename",
  delete: "Delete",
  trash: "Move to trash",
  newNote: "New note",
  newFolder: "New folder",
  untitled: "Untitled",
  untitledNote: "Untitled note",
  downloadFailed: "Download failed",
  prevImage: "Previous (←)",
  nextImage: "Next (→)",
  readFail: "Failed to load note",

  tabFiles: "Files",
  tabSearch: "Search",
  searchPlaceholder: "Search titles & full text…",
  noResults: "No results for \"{q}\"",
  newFolderPlaceholder: "Folder name, press Enter to create",
  vaultSwitchTip: "Click to switch vault folder",
  vaultWebTip: "Browser mode: set the VAULT_DIR env var to choose the vault",
  settings: "Settings",

  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  navBack: "Back",
  navForward: "Forward",
  more: "More actions",
  lockReading: "Lock for reading ({mod})",
  unlockEdit: "Unlock editing ({mod})",
  publishExportMenu: "Publish / Export…",
  deleteNote: "Delete note…",
  confirmTrash: "Move to trash?",
  saveErrorHint: "Save failed (retry {mod}S)",
  backToNote: "← Back to note",
  editorPlaceholder: "Start writing… (# heading · 1. list · - [ ] todo · ``` code)",
  tagsPlaceholder: "Tags, comma-separated",

  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
  undo: "Undo",
  redo: "Redo",
  bold: "Bold",
  italic: "Italic",
  strike: "Strikethrough",
  inlineCode: "Inline code",
  codeBlock: "Code block",
  blockquote: "Quote",
  taskList: "Task list",
  divider: "Divider",

  viewLarge: "View large",
  downloadImage: "Download image",
  deleteImage: "Delete image",
  editCanvas: "Edit canvas",
  deleteCanvasBlock: "Delete canvas block",
  deleteCanvasKeep: "Delete block (file kept in attachments)",
  downloadPng: "Download PNG",
  imgTitleEdit: "Click to select · drag corner to resize · double-click to view",
  imgTitleLock: "Double-click to view",
  sceneTitle: "Canvas",
  autosaveOn: "Autosave on",
  autosaving: "Saving…",
  autosaveRetry: "Save failed, retrying",
  emptyCanvas: "Empty canvas",
  emptyCanvasHint: "Click to start drawing (auto-saved as .excalidraw)",
  canvasReadyHint: "Has content · click to edit",
  sceneLoading: "Loading canvas…",
  sceneAlt: "excalidraw canvas",

  slImage: "Image",
  slImageDesc: "Upload a local image",
  slCanvas: "Canvas",
  slCanvasDesc: "Insert an Excalidraw drawing",
  slTask: "Task list",
  slTaskDesc: "Checkable task list",
  slCode: "Code block",
  slCodeDesc: "With syntax highlighting",
  slQuote: "Quote",
  slQuoteDesc: "Excerpt or annotation",
  slHr: "Divider",
  slHrDesc: "Horizontal rule between sections",
  slH1: "Heading 1",
  slH1Desc: "Large heading",
  slH2: "Heading 2",
  slH2Desc: "Medium heading",

  newNoteHere: "New note here",
  trashLabel: "Delete (move to trash)",
  confirmAgain: "Click again to move to trash",
  open: "Open",
  viewAsset: "View image",
  clickToView: "Click to view",
  clickToEdit: "Click to edit canvas",
  clickCanvas: "View canvas",
  wikilinkMissingTip: "Note doesn't exist · Click to create",
  wikilinkMissingCard: "Note doesn't exist · Click to create",

  emptyHint: "Pick a note on the left, or",
  noVaultHint: "No note vault folder selected yet",
  pickVaultBtn: "Choose Folder (an existing Obsidian vault works)",

  publishTitle: "Publish / Export",
  exportHtmlTitle: "Export single-file HTML",
  exportHtmlDesc: "All images embedded into one .html file — send it via chat or cloud drive, double-click to open",
  exportNow: "Export now",
  exporting: "Exporting…",
  exportedTo: "Exported to {path}",
  exportedDownload: "Downloaded {name} (single file with embedded images)",
  exportFail: "Export failed — see console",
  pubServerTitle: "Publish to my server",
  pubServerDesc: "Uploads the article to your publish server; anyone with the link can read it (server/publish-server.mjs)",
  serverPlaceholder: "Server URL, e.g. http://123.45.67.89:8787",
  tokenPlaceholder: "Access token (server env TOKEN)",
  linkPath: "Path",
  shuffle: "Shuffle",
  shuffleTip: "Random",
  copied: "Copied",
  copyLink: "Copy link",
  pubOverwrite: "Publishing the same slug overwrites the page",
  publish: "Publish",
  publishing: "Publishing…",
  pubOk: "Published!",
  pubNeedServer: "Server URL is required",
  pubNeedSlug: "Slug is required",
  pubFail: "Publish failed: {msg}",

  settingsLanguage: "Language",
  settingsTheme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
};

const dicts: Record<Lang, Record<string, string>> = { zh, en };

interface Settings {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** 主题已解析：当前是否暗色（system 跟随时实时变化） */
  dark: boolean;
  t: (key: string, vars?: Vars) => string;
}

const Ctx = createContext<Settings>(null!);

/** 在 React 外取翻译（menu 的 render 回调等非组件环境） */
export function translate(lang: Lang, key: string, vars?: Vars) {
  let s = dicts[lang][key] ?? zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** 在 React 外读当前语言（Provider 会把它同步到 <html lang>） */
export function currentLang(): Lang {
  return document.documentElement.lang === "en" ? "en" : "zh";
}

export function useSettings() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSettings must be used inside SettingsProvider");
  return s;
}

const THEMES: Theme[] = ["light", "dark", "system"];

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() =>
    localStorage.getItem("noteshare.lang") === "en" ? "en" : "zh"
  );
  const [theme, setTheme] = useState<Theme>(() => {
    const v = localStorage.getItem("noteshare.theme") as Theme | null;
    return v && THEMES.includes(v) ? v : "system";
  });
  const [dark, setDark] = useState(() =>
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );

  useEffect(() => {
    localStorage.setItem("noteshare.lang", lang);
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  }, [lang]);

  useEffect(() => {
    localStorage.setItem("noteshare.theme", theme);
    const apply = () => {
      const d = theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
      setDark(d);
      document.documentElement.dataset.theme = d ? "dark" : "light";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const t = useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang]);

  return (
    <Ctx.Provider value={{ lang, setLang, theme, setTheme, dark, t }}>{children}</Ctx.Provider>
  );
}
