// 界面设置（语言 / 主题）：Context + localStorage 持久化。
// t(key, vars) 支持模板变量替换 {name}；主题 "system" 跟随系统并监听变化。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "zh" | "en";
export type Theme = "light" | "dark" | "system";
/** 主题色配置：亮色/暗色主题各自的强调色 */
export interface AccentColors {
  light: string;
  dark: string;
}
export const DEFAULT_ACCENT: AccentColors = { light: "#b45309", dark: "#d97706" };
type Vars = Record<string, string | number>;

function hexToRgbTriple(hex: string): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "180 83 9";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function readAccent(): AccentColors {
  try {
    const raw = JSON.parse(localStorage.getItem("noteshare.accent") ?? "null");
    if (raw && typeof raw.light === "string" && typeof raw.dark === "string") return raw;
  } catch {
    /* 用默认 */
  }
  return { ...DEFAULT_ACCENT };
}

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
  newScene: "新建手绘",
  pickNotePh: "搜索笔记…",
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
  vaults: "仓库",
  noVaultsYet: "还没有仓库，先新建或打开一个",
  newVault: "新建仓库",
  createVaultHint: "创建一个全新的仓库",
  openLocalVault: "打开本地仓库",
  openLocalHint: "选择一个已有文件夹作为仓库，可直接打开现成的 Obsidian 库",
  openLocalBtn: "选择文件夹",
  vaultNameLabel: "仓库名称",
  newVaultNamePh: "我的仓库",
  locationLabel: "位置",
  locationPh: "仓库的父文件夹",
  browse: "浏览",
  createVaultBtn: "创建仓库",
  vaultPathPh: "仓库文件夹路径，如 D:/notes",
  openPathBtn: "打开",
  manageVaults: "管理仓库…",
  removeVaultTip: "从列表移除（不删除磁盘文件）",
  vaultMissing: "路径不存在",
  backToVault: "返回",
  vaultWebTip: "浏览器模式：直接输入路径即可新建/打开仓库，数据格式与桌面端完全一致",
  settings: "设置",

  // ---- 编辑器顶栏 / 菜单 ----
  collapseSidebar: "收起左侧栏",
  expandSidebar: "展开左侧栏",
  navBack: "上一页",
  navForward: "下一页",
  closePane: "关闭分栏",
  closeTab: "关闭标签",
  newTabNote: "新建笔记标签",
  openInNewTab: "在新标签页打开",
  openInNewPane: "在新分栏打开",
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

  // ---- Home 大纲（Workflowy 式） ----
  homeOpenEntry: "Workflowy 大纲（Ctrl+Shift+H）",
  homeSearchPh: "筛选大纲…",
  homeExpandAll: "全部展开",
  homeCollapseAll: "全部折叠",
  homeEmptyHint: "记下第一条想法…（Enter 新行 · Tab 缩进 · 拖圆点整理）",
  homeToggleCollapse: "折叠 / 展开",
  homeMarkDone: "标记完成",
  homeMarkUndo: "取消完成",
  homeZoomHere: "缩放至此",
  homeCopyRef: "复制引用",
  homeToNote: "转为笔记",
  homeDeleteItem: "删除节点（含子级）",
  homeAddItem: "新建条目",
  homeNotePh: "备注…",
  homeHideDone: "隐藏 / 显示已完成（Ctrl+O）",
  homeToday: "今天",
  homeViewOutline: "大纲",
  homeViewBoard: "看板",
  homeViewToday: "今天",
  homeBoardEmpty: "在条目里加 #标签，即可在这里形成看板列",
  homeBoardEmptyNode: "当前层级没有子条目：先在大纲里给这个节点加子级，子级会成为看板列",
  homeBoardAdd: "新建卡片",
  homeBoardNewCol: "新列",
  homeBoardDrag: "拖动卡片",
  homeBoardView: "看板视图（此节点）",
  homeTurnBoard: "转为看板",
  homeTurnTodo: "转为待办",
  homeTurnPlain: "转为普通条目",
  homeTurnList: "转为列表",
  homeBackToList: "返回列表",
  homeMoveToday: "移到今天",
  homeMoveTomorrow: "移到明天",
  homeNewCard: "新条目",
  homeTodayEmpty: "今天还没有安排：给条目加 #today 标签，或用日历记录今天",
  homeTodayLocate: "在大纲中定位",
  homeCalMon: "一",
  homeCalTue: "二",
  homeCalWed: "三",
  homeCalThu: "四",
  homeCalFri: "五",
  homeCalSat: "六",
  homeCalSun: "日",
  homeNodes: "Workflowy 节点",
  homeDragHint: "拖到笔记里嵌入此节点，点击在大纲中定位",
  homeEmbedOpen: "在大纲中查看",
  homeEmbedMissing: "大纲节点已被删除或改动",

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
  retry: "重试",
  emptyCanvas: "空画板",
  emptyCanvasHint: "空画板 · 点击开始绘制（会自动保存为 .excalidraw 文件）",
  canvasReadyHint: "画板已有内容 · 点击编辑生成预览图",
  sceneLoading: "画板加载中…",
  sceneAlt: "excalidraw 画板",

  // ---- 白板（Obsidian 式 canvas） ----
  newCanvas: "新建白板",
  newCanvasPh: "白板名称，回车创建",
  clickToEditCanvas: "点击打开白板",
  wbSaveFailed: "自动保存失败",
  wbLoading: "白板加载中…",
  wbNote: "笔记",
  wbImage: "图片",
  wbText: "文本",
  wbAddNote: "添加笔记卡片（搜索，没有可直接创建）",
  wbAddImage: "添加图片卡片（vault 图片 / 上传）",
  wbAddText: "添加文本卡片",
  wbCreateNote: "创建笔记「{name}」",
  wbImagePh: "搜索图片…",
  wbUploadImage: "上传本地图片…",
  wbNoMatch: "没有匹配的笔记，回车直接创建",
  wbNoNotes: "库里还没有笔记",
  wbNoImages: "库里没有匹配的图片",
  wbFileMissing: "文件不存在或已删除",
  wbOpenNote: "打开笔记（Ctrl+点击在新栏打开）",
  wbRefreshCard: "刷新卡片内容",
  wbEdgeLabel: "标签…",
  wbTextPh: "输入文本…",
  wbTextEmpty: "空文本卡片 · 点击输入",
  wbBlock: "色块",
  wbAddBlock: "添加色块（居中文字，可换色）",
  wbBlockPh: "输入文字…",
  wbBlockCustom: "自定义颜色…",
  wbBlockColor: "换色",
  wbEmptyHint: "空白板 · 底部工具栏可插入 笔记 / 图片 / 文本卡片",

  // ---- 色块属性面板（Excalidraw 式） ----
  wbBg: "背景",
  wbTransparent: "透明",
  wbStroke: "边框",
  wbStrokeNone: "无边框",
  wbStrokeW: "边框宽度",
  wbThin: "细",
  wbMedium: "中",
  wbThick: "粗",
  wbStrokeStyle: "边框样式",
  wbSolid: "实线",
  wbDashed: "虚线",
  wbDotted: "点线",
  wbFill: "填充样式",
  wbFillSolid: "实心",
  wbHachure: "斜线",
  wbCross: "交叉",
  wbEdges: "边角",
  wbRound: "圆角",
  wbSharp: "直角",
  wbOpacity: "不透明度",
  wbFontSize: "字号",
  wbLayers: "图层",
  wbToFront: "置前",
  wbToBack: "置后",
  wbActions: "操作",
  wbDuplicate: "复制",
  wbDeleteShort: "删除",

  // ---- 斜杠命令 ----
  slImage: "图片",
  slImageDesc: "上传本地图片插入笔记",
  slCanvas: "画板",
  slCanvasDesc: "插入 Excalidraw 手绘图",
  slVoice: "语音",
  slVoiceDesc: "录一段语音，插入为可播放的块",

  // ---- 语音块 ----
  voiceArming: "正在开启麦克风…",
  voiceRec: "录音中",
  voiceStop: "停止",
  voiceProcessing: "正在保存…",
  voiceMicDenied: "无法访问麦克风，请在系统设置中允许后重试",
  voiceMicMissing: "未检测到可用的录音设备",
  voiceUnsupported: "当前环境不支持录音",
  voiceRecFail: "录音失败，请重试",
  voiceRetry: "重试",
  voicePlay: "播放",
  voicePause: "暂停",
  voiceSeek: "点击波形跳转进度",
  voiceDownload: "下载音频",
  voiceDelete: "删除语音块",
  voiceLoadFail: "音频加载失败",
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
  trashLabel: "删除",
  winMin: "最小化",
  winMax: "最大化",
  winRestore: "还原",
  winClose: "关闭",
  revealInFinder: "在 Finder 中显示",
  revealInExplorer: "在资源管理器中显示",
  confirmAgain: "再次点击确认移入回收站",
  open: "打开",
  viewAsset: "查看图片",
  clickToView: "点击查看图片",
  clickToEdit: "点击在右侧编辑画板",
  clickCanvas: "点击查看画板",

  // ---- PDF 阅读器 ----
  pdfLoading: "PDF 加载中…",
  pdfLoadFail: "PDF 加载失败",
  clickToReadPdf: "点击阅读 PDF（可转为 Markdown）",
  pdfZoomIn: "放大",
  pdfZoomOut: "缩小",
  pdfFitWidth: "适应宽度",
  pdfGoPage: "跳到指定页（回车）",
  pdfConvert: "转为 Markdown",
  pdfConverting: "转换中…",
  pdfConverted: "已生成 {name}",
  pdfConvertFail: "转换失败",
  pdfThumbs: "缩略图",
  pdfOutline: "目录",
  pdfNoOutline: "此 PDF 没有内嵌目录",

  // ---- OS 拖放导入 ----
  dropImportHint: "松开导入到 {folder}",
  dropImportFolderTip: "拖到左侧文件夹上可指定目录；.md 会作为笔记打开",
  dropImporting: "导入中…",
  dropImportDone: "已导入 {n} 个文件",
  dropImportFail: "导入失败，请重试",
  wikilinkMissingCard: "笔记不存在 · 点击创建",

  // ---- 空状态 / 首启 ----
  emptyHint: "左侧选择一篇笔记，或",

  // ---- 发布 / 导出 ----
  publishTitle: "发布 / 导出",
  exportHtmlTitle: "导出单文件 HTML",
  exportHtmlDesc: "图片全部内嵌成一个 .html 文件，微信/网盘发给别人，双击就能看",
  exportPdfTitle: "导出 PDF",
  exportPdfDesc: "A4 分页排版，图片、代码块原样保留，适合打印或存档",
  exportedPdfDownload: "已下载 {name}（A4 排版，可直接打印）",
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
  settingsAccent: "主题色",
  accentLight: "亮色主题",
  accentDark: "暗色主题",
  accentReset: "恢复默认",

  // ---- 版本与更新 ----
  versionSection: "版本与更新",
  versionClient: "客户端版本",
  versionHot: "热更新",
  versionHotNone: "未安装",
  versionHotRunning: "（运行中）",
  updateCheck: "检查更新",
  updateChecking: "检查中…",
  updateDownload: "下载更新",
  updateDownloading: "下载中…",
  updateInstalling: "安装中，即将重启…",
  updateUpToDate: "已是最新版本",
  updateAvailable: "有可用更新",
  updateHotApply: "应用热更新",
  updateHotClear: "清除热更新（回退到安装包内置资源）",
  updateError: "更新失败",
  updateMacManual: "此平台不支持自动更新，请前往 GitHub Releases 手动下载新版本",
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
  newScene: "New drawing",
  pickNotePh: "Search notes…",
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
  vaults: "Vaults",
  noVaultsYet: "No vaults yet — create or open one",
  newVault: "Create new vault",
  createVaultHint: "Create a new vault",
  openLocalVault: "Open folder as vault",
  openLocalHint: "Pick an existing folder as your vault; existing Obsidian vaults work directly",
  openLocalBtn: "Choose folder",
  vaultNameLabel: "Vault name",
  newVaultNamePh: "My vault",
  locationLabel: "Location",
  locationPh: "Parent folder of the vault",
  browse: "Browse",
  createVaultBtn: "Create vault",
  vaultPathPh: "Vault folder path, e.g. D:/notes",
  openPathBtn: "Open",
  manageVaults: "Manage vaults…",
  removeVaultTip: "Remove from list (files on disk stay)",
  vaultMissing: "Path missing",
  backToVault: "Back",
  vaultWebTip: "Browser mode: type a path to create/open vaults — same data format as the desktop app",
  settings: "Settings",

  collapseSidebar: "Collapse sidebar",
  expandSidebar: "Expand sidebar",
  navBack: "Back",
  navForward: "Forward",
  closePane: "Close pane",
  closeTab: "Close tab",
  newTabNote: "New note tab",
  openInNewTab: "Open in new tab",
  openInNewPane: "Open in new pane",
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

  // ---- Home outline (Workflowy-style) ----
  homeOpenEntry: "Workflowy outline (Ctrl+Shift+H)",
  homeSearchPh: "Filter outline…",
  homeExpandAll: "Expand all",
  homeCollapseAll: "Collapse all",
  homeEmptyHint: "Capture a thought… (Enter new line · Tab indent · drag the dot)",
  homeToggleCollapse: "Collapse / expand",
  homeMarkDone: "Mark done",
  homeMarkUndo: "Mark undone",
  homeZoomHere: "Zoom here",
  homeCopyRef: "Copy reference",
  homeToNote: "Convert to note",
  homeDeleteItem: "Delete node (with children)",
  homeNotePh: "Note…",
  homeAddItem: "Add item",
  homeHideDone: "Hide / show completed (Ctrl+O)",
  homeToday: "Today",
  homeViewOutline: "Outline",
  homeViewBoard: "Board",
  homeViewToday: "Today",
  homeBoardEmpty: "Add #tags to items to form board columns here",
  homeBoardEmptyNode: "No child items at this level: add children in the outline first — each becomes a board column",
  homeBoardAdd: "New card",
  homeBoardNewCol: "New column",
  homeBoardDrag: "Drag card",
  homeBoardView: "Board view (this node)",
  homeTurnBoard: "Turn into board",
  homeTurnList: "Turn into list",
  homeTurnTodo: "Turn into to-do",
  homeTurnPlain: "Turn into plain item",
  homeBackToList: "Back to list",
  homeMoveToday: "Move to today",
  homeMoveTomorrow: "Move to tomorrow",
  homeNewCard: "New item",
  homeTodayEmpty: "Nothing planned today: tag items with #today, or log the day in the calendar",
  homeTodayLocate: "Locate in outline",
  homeCalMon: "Mo",
  homeCalTue: "Tu",
  homeCalWed: "We",
  homeCalThu: "Th",
  homeCalFri: "Fr",
  homeCalSat: "Sa",
  homeCalSun: "Su",
  homeNodes: "Workflowy nodes",
  homeDragHint: "Drag into a note to embed; click to locate in the outline",
  homeEmbedOpen: "Open in the outline",
  homeEmbedMissing: "Outline node was deleted or changed",

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
  retry: "Retry",
  emptyCanvas: "Empty canvas",
  emptyCanvasHint: "Click to start drawing (auto-saved as .excalidraw)",
  canvasReadyHint: "Has content · click to edit",
  sceneLoading: "Loading canvas…",
  sceneAlt: "excalidraw canvas",

  // ---- Whiteboard (Obsidian-style canvas) ----
  newCanvas: "New whiteboard",
  newCanvasPh: "Whiteboard name, press Enter to create",
  clickToEditCanvas: "Click to open whiteboard",
  wbSaveFailed: "Autosave failed",
  wbLoading: "Loading whiteboard…",
  wbNote: "Note",
  wbImage: "Image",
  wbText: "Text",
  wbAddNote: "Add note card (search, create if missing)",
  wbAddImage: "Add image card (vault / upload)",
  wbAddText: "Add text card",
  wbCreateNote: "Create note \"{name}\"",
  wbImagePh: "Search images…",
  wbUploadImage: "Upload local image…",
  wbNoMatch: "No match — press Enter to create",
  wbNoNotes: "No notes in the vault yet",
  wbNoImages: "No matching images",
  wbFileMissing: "File missing or deleted",
  wbOpenNote: "Open note (Ctrl+click for new pane)",
  wbRefreshCard: "Refresh card",
  wbEdgeLabel: "Label…",
  wbTextPh: "Type text…",
  wbTextEmpty: "Empty text card · click to type",
  wbBlock: "Block",
  wbAddBlock: "Add color block (centered text)",
  wbBlockPh: "Type text…",
  wbBlockCustom: "Custom color…",
  wbBlockColor: "Color",
  wbEmptyHint: "Empty — use the toolbar to add note / image / text cards",

  // ---- Block property panel (Excalidraw-style) ----
  wbBg: "Background",
  wbTransparent: "Transparent",
  wbStroke: "Border",
  wbStrokeNone: "No border",
  wbStrokeW: "Border width",
  wbThin: "Thin",
  wbMedium: "Medium",
  wbThick: "Thick",
  wbStrokeStyle: "Border style",
  wbSolid: "Solid",
  wbDashed: "Dashed",
  wbDotted: "Dotted",
  wbFill: "Fill style",
  wbFillSolid: "Solid",
  wbHachure: "Hachure",
  wbCross: "Cross-hatch",
  wbEdges: "Corners",
  wbRound: "Round",
  wbSharp: "Sharp",
  wbOpacity: "Opacity",
  wbFontSize: "Font size",
  wbLayers: "Layers",
  wbToFront: "To front",
  wbToBack: "To back",
  wbActions: "Actions",
  wbDuplicate: "Duplicate",
  wbDeleteShort: "Delete",

  slImage: "Image",
  slImageDesc: "Upload a local image",
  slCanvas: "Canvas",
  slCanvasDesc: "Insert an Excalidraw drawing",
  slVoice: "Voice",
  slVoiceDesc: "Record a voice clip as a playable block",

  // ---- Voice block ----
  voiceArming: "Opening microphone…",
  voiceRec: "REC",
  voiceStop: "Stop",
  voiceProcessing: "Saving…",
  voiceMicDenied: "Microphone access denied. Allow it in system settings and retry",
  voiceMicMissing: "No microphone found",
  voiceUnsupported: "Recording is not supported here",
  voiceRecFail: "Recording failed, please retry",
  voiceRetry: "Retry",
  voicePlay: "Play",
  voicePause: "Pause",
  voiceSeek: "Click the waveform to seek",
  voiceDownload: "Download audio",
  voiceDelete: "Delete voice clip",
  voiceLoadFail: "Failed to load audio",
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
  trashLabel: "Delete",
  winMin: "Minimize",
  winMax: "Maximize",
  winRestore: "Restore",
  winClose: "Close",
  revealInFinder: "Reveal in Finder",
  revealInExplorer: "Show in File Explorer",
  confirmAgain: "Click again to move to trash",
  open: "Open",
  viewAsset: "View image",
  clickToView: "Click to view",
  clickToEdit: "Click to edit canvas",
  clickCanvas: "View canvas",

  // ---- PDF viewer ----
  pdfLoading: "Loading PDF…",
  pdfLoadFail: "Failed to load PDF",
  clickToReadPdf: "Click to read PDF (convertible to Markdown)",
  pdfZoomIn: "Zoom in",
  pdfZoomOut: "Zoom out",
  pdfFitWidth: "Fit width",
  pdfGoPage: "Go to page (Enter)",
  pdfConvert: "Convert to Markdown",
  pdfConverting: "Converting…",
  pdfConverted: "Created {name}",
  pdfConvertFail: "Conversion failed",
  pdfThumbs: "Thumbnails",
  pdfOutline: "Outline",
  pdfNoOutline: "This PDF has no embedded outline",

  // ---- OS drag & drop import ----
  dropImportHint: "Drop to import into {folder}",
  dropImportFolderTip: "Drop onto a folder in the sidebar to choose a target; .md opens as a note",
  dropImporting: "Importing…",
  dropImportDone: "Imported {n} file(s)",
  dropImportFail: "Import failed, please retry",
  wikilinkMissingCard: "Note doesn't exist · Click to create",

  emptyHint: "Pick a note on the left, or",

  publishTitle: "Publish / Export",
  exportHtmlTitle: "Export single-file HTML",
  exportHtmlDesc: "All images embedded into one .html file — send it via chat or cloud drive, double-click to open",
  exportPdfTitle: "Export PDF",
  exportPdfDesc: "A4 paginated layout, images and code blocks preserved — ready to print or archive",
  exportedPdfDownload: "Downloaded {name} (A4 layout, print-ready)",
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
  settingsAccent: "Accent color",
  accentLight: "Light theme",
  accentDark: "Dark theme",
  accentReset: "Reset",

  versionSection: "Version & updates",
  versionClient: "Client version",
  versionHot: "Hot update",
  versionHotNone: "None",
  versionHotRunning: " (running)",
  updateCheck: "Check for updates",
  updateChecking: "Checking…",
  updateDownload: "Download update",
  updateDownloading: "Downloading…",
  updateInstalling: "Installing, restarting soon…",
  updateUpToDate: "You're up to date",
  updateAvailable: "Update available",
  updateHotApply: "Apply hot update",
  updateHotClear: "Remove hot update (fall back to bundled assets)",
  updateError: "Update failed",
  updateMacManual: "Auto-update is unavailable on this platform; download new versions from GitHub Releases",
};

const dicts: Record<Lang, Record<string, string>> = { zh, en };

interface Settings {
  lang: Lang;
  setLang: (l: Lang) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** 主题色（亮/暗各自定义），即时生效并持久化 */
  accent: AccentColors;
  setAccent: (a: AccentColors) => void;
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
  const [accent, setAccentState] = useState<AccentColors>(readAccent);
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
      // 主题色按当前亮/暗取对应配置注入（CSS 内所有 accent 派生色随变量联动）
      const hex = d ? accent.dark : accent.light;
      document.documentElement.style.setProperty("--accent", hex);
      document.documentElement.style.setProperty("--accent-rgb", hexToRgbTriple(hex));
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, accent]);

  const setAccent = useCallback((a: AccentColors) => {
    localStorage.setItem("noteshare.accent", JSON.stringify(a));
    setAccentState(a);
  }, []);

  const t = useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang]);

  return (
    <Ctx.Provider value={{ lang, setLang, theme, setTheme, accent, setAccent, dark, t }}>
      {children}
    </Ctx.Provider>
  );
}
