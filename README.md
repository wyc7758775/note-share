# NoteShare — 个人笔记软件（Obsidian 兼容 · 可单篇发布分享）

[![Check](https://github.com/wyc7758775/note-share/actions/workflows/check.yml/badge.svg)](https://github.com/wyc7758775/note-share/actions/workflows/check.yml)
[![Release](https://github.com/wyc7758775/note-share/actions/workflows/release.yml/badge.svg)](https://github.com/wyc7758775/note-share/actions/workflows/release.yml)

一个本地优先的笔记应用：像 Obsidian 一样用**文件夹管理 Markdown 笔记**，用 **tiptap** 所见即所得地写作，随手画 **Excalidraw** 手绘板，然后**把某一篇笔记发布出去给人看**——导出单文件 HTML / A4 排版 PDF，或一键推到你自己的服务器生成分享链接。

```
┌─────────────┬──────────────────────────────┐
│ 文件树/搜索   │  标题（=文件名）               │
│ (vault)     │  标签 · 工具栏                 │
│             │  正文（tiptap 所见即所得）      │
│             │  [画板块] ← Excalidraw        │
│             │  右上角：发布 / 导出            │
└─────────────┴──────────────────────────────┘
```

## 核心特性

- **Obsidian 兼容**：笔记就是文件夹里的 `.md` 文件（YAML frontmatter），把同一个文件夹用 Obsidian 打开就是同一个库；删除的笔记进 `.trash/`（Obsidian 同款约定）
- **所见即所得**：tiptap 编辑器，工具栏齐全（标题/加粗/列表/待办/引用/代码块/链接/图片），拖图进来自动存入 `attachments/`
- **Excalidraw 画板**：插入画板直接画，保存为标准 `.excalidraw` 场景文件 + 自动导出 PNG 预览；Obsidian 的 Excalidraw 插件可直接编辑同一文件
- **Mermaid 图表**：`mermaid` 代码块在编辑器里实时预览（Pele 渲染，按需加载），导出 HTML / PDF / 发布时转成内联 SVG
- **PDF 阅读与转换**：vault 里的 `.pdf` 点击即读（pdfjs 连续滚动渲染、缩放/适宽/页码跳转），一键"转为 Markdown"——本地提取文本层并推断标题层级/列表/段落，生成带 frontmatter 的同名笔记
- **拖放导入**：从桌面/资源管理器（或其他笔记软件）把文件直接拖进窗口即导入当前仓库——`.md` 作为笔记自动打开，PDF/图片等入文件树；拖到左侧文件夹行可指定目录
- **单篇发布**：① 导出单文件 HTML（图片全部内嵌，微信发文件双击就看）② 导出 PDF（与 HTML 导出同一套阅读排版，A4 分页、中文/emoji 无字体问题，适合打印或存档） ③ 推送到自己的发布服务器生成链接（`/p/你的slug`）
- **自动保存**：停笔约 1 秒自动落盘，`Ctrl+S` 立即保存；改标题 = 自动重命名文件
- 全文搜索（标题 + 正文，中文无乱码）

## 技术栈

Tauri 2（Rust 桌面壳）· React 19 + TypeScript + Vite · Tailwind CSS 4 · tiptap 3 + tiptap-markdown · @excalidraw/excalidraw · Pele（Mermaid 渲染） · 零依赖 Node 发布服务器

## 快速开始（浏览器开发模式，无需 Rust）

```bash
npm install

# 终端 1：vault 文件后端（操作 ./devvault 文件夹）
npm run dev:server

# 终端 2：前端
npm run dev
```

打开 http://localhost:5188 。`devvault/` 里有示例笔记可直接玩；想换成自己的库：`VAULT_DIR=D:\你的Obsidian库 npm run dev:server`。

## 桌面版（Tauri）

需要先装工具链（一次性，约 2GB）：

1. **Rust**：到 https://rustup.rs 下载 `rustup-init.exe` 直接运行（默认 stable-msvc）
2. **MSVC 构建工具**：https://visualstudio.microsoft.com/visual-cpp-build-tools/ 勾选「使用 C++ 的桌面开发」
3. 重开终端验证：`cargo --version`

然后：

```bash
npm run tauri dev      # 开发调试窗口
npm run tauri build    # 出安装包（src-tauri/target/release/bundle/ 下）
```

桌面版首次打开会让你**选择笔记库文件夹**（直接选你现有的 Obsidian 库即可），路径会记住。

## 发布服务器部署

`server/publish-server.mjs` 是零依赖单文件服务，接收笔记端发布的文章并对外服务。

**Docker 方式（推荐）：**

```bash
cd server
# 编辑 docker-compose.yml 里的 TOKEN 为一个长随机串
docker compose up -d
# 文章数据持久化在 ./data
```

**裸机方式：**

```bash
cd server
TOKEN=换成长随机串 PORT=8788 node publish-server.mjs
```

然后在笔记应用里点「发布 / 导出」→ 填服务器地址（如 `http://你的IP:8788`）和 TOKEN → 发布，得到 `http://你的IP:8788/p/slug` 分享链接。同一 slug 重复发布 = 更新覆盖。

> 公网部署记得配 HTTPS（套 nginx/caddy），TOKEN 泄露任何人都能发文章。

## Obsidian 兼容性说明（诚实版）

| 内容 | 兼容情况 |
|---|---|
| Markdown 正文（标题/列表/加粗/代码/引用/待办） | ✅ 完全互通 |
| YAML frontmatter（tags/created/…） | ✅ 互通，未知字段保留 |
| 图片、`.excalidraw` 画板 | ✅ 互通（画板需 Obsidian 装 Excalidraw 插件） |
| `mermaid` 代码块 | ✅ 编辑器实时预览，导出为内联 SVG；Excalidraw 的「Mermaid 转画板」仍用 mermaid.js（需要可编辑元素，Pele 不提供） |
| `[[双链]]`、`![[嵌入]]`、callout | ⚠️ 文字保留不丢失，但本应用内**不可交互**，编辑后写回为普通文本 |
| `.obsidian/` 配置 | 不读取不改动 |

## 项目结构

```
src/                前端（React + tiptap + Excalidraw）
  backend/          后端抽象：tauri.ts（桌面）/ web.ts（浏览器开发）
  components/       编辑器、文件树、发布对话框、画板弹窗
  lib/              frontmatter / markdown 双向转换 / HTML 导出
scripts/
  dev-server.mjs    浏览器模式的 vault 文件后端
  make-icons.mjs    生成应用图标
  check-i18n.mjs    门禁：中英文案 key 对齐 / 引用不悬空
  check-theme.mjs   门禁：亮暗主题 CSS 变量成对
  sync-version.mjs  CI：tag 版本号同步进 package/tauri/Cargo
src-tauri/          Rust 桌面端（命令与 dev-server 一一对应）
server/             发布服务器（零依赖 Node + Docker）
devvault/           开发用示例笔记库
```

## 已知限制（v0.1）

- Obsidian 特有语法（双链/callout）在编辑器里不可交互（见上表）
- 没有移动端；桌面版依赖 WebView2（Win10/11 自带）
- 图片管理只有 `attachments/` 平铺，没有清理孤立文件的功能
