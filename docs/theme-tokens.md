# 主题 Token 清单（语义变量规范）

> 为「自定义主题」（Preferences 域 Phase 2）做准备。目标：把 `:root` / `html[data-theme="dark"]`
> 两套硬编码变量重构为**主题 = 一组语义 token 的命名映射**，由外观服务以 `--x` 内联注入 `<html>`，
> CSS 文件只保留本表作为 fallback。自定义主题 = 覆盖本表任意子集，缺省 token 回退基础主题。
>
> 值列自 `src/styles.css`（亮 / 暗）。**权威在 styles.css**，本表是整理视图，改 token 需同步此处。

## 分组

### A. 基础画布（背景与层次）

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--paper` | `#ffffff` | `#1a1817` | 内容画布底色（编辑器、标签激活态、卡片底） |
| `--paper-side` | `#f6f6f6` | `#272221` | 侧栏/标签条等"边栏"底色 |
| `--surface` | `#ffffff` | `#292524` | 浮层表面（弹窗、菜单） |
| `--surface-hover` | `rgb(0 0 0 / 0.05)` | `rgb(255 255 255 / 0.06)` | 悬停底色 |

### B. 文字

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--ink` | `#292524` | `#e7e5e4` | 主文字 |
| `--ink-soft` | `#78716c` | `#a8a29e` | 次级文字 |
| `--ink-faint` | `#a8a29e` | `#78716c` | 弱文字/占位符 |

### C. 线条

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--line` | `#e4e4e4` | `#37312f` | 常规分隔线 |
| `--line-strong` | `#d6d3d1` | `#44403c` | 强调分隔线 |

### D. 强调色

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--accent` | 主题色配置（默认 `#b45309`） | `#d97706` | 强调色（运行时内联注入） |
| `--accent-rgb` | `180 83 9` | `217 119 6` | 强调色 RGB 三元组（派生透明度用） |
| `--active-bg` | `rgb(var(--accent-rgb) / 0.12)` | `/ 0.18` | 选中项底色 |
| `--active-bg-hover` | `rgb(var(--accent-rgb) / 0.18)` | `/ 0.26` | 选中项悬停底色 |
| `--search-hit-bg` | `#fff3a3` | `rgb(250 204 21 / 0.22)` | 搜索命中高亮 |

### E. 按钮（实心/描边）

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--btn-bg` | `#292524` | `#e7e5e4` | 主按钮底 |
| `--btn-bg-hover` | `#44403c` | `#d6d3d1` | 主按钮悬停 |
| `--btn-fg` | `#fafaf9` | `#1c1917` | 主按钮文字 |

### F. 代码

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--code-bg` | `#eee9e2` | `rgb(255 255 255 / 0.08)` | 行内代码底 |
| `--code-fg` | `#7c2d12` | `#e0af68` | 行内代码字色 |
| `--code-block-bg` | `#1c1917` | `#232020` | 代码块底 |
| `--code-block-border` | `transparent` | `var(--line)` | 代码块边线 |

### G. 状态/提示

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--danger-bg` | `#fef2f2` | `rgb(220 38 38 / 0.15)` | 错误/危险底 |
| `--tip-bg` | `#1c1917` | `#3f3a37` | tooltip 底 |
| `--tip-fg` | `#fafaf9` | `#fafaf9` | tooltip 字 |
| `--shadow-card` | `0 8px 28px rgb(0 0 0 / 0.13)` | `/ 0.45` | 卡片阴影 |
| `--note-ph` | `"备注…"` | `"备注…"` | Home 备注占位文案（按语言内联覆盖） |

### H. Workflowy 派生（Home 大纲专用，全部由基础 token 派生）

| Token | 亮 | 暗 | 语义 |
|---|---|---|---|
| `--wf-text` | `var(--ink)` | 同 | 条目文字 |
| `--wf-sub` | `var(--ink-soft)` | 同 | 条目次级 |
| `--wf-note` | `var(--ink-soft)` | 同 | 备注文字 |
| `--wf-bg` | `var(--paper)` | 同 | 面板底 |
| `--wf-bg2` | `var(--surface-hover)` | 同 | 条目悬停底 |
| `--wf-bg3` | `var(--line)` | 同 | 拖拽落点线 |
| `--wf-chip-base` | `#f3f4f4` | `rgb(255 255 255 / 0.05)` | 日历底格 |
| `--wf-chip-cur` | `#dce0e2` | `rgb(255 255 255 / 0.16)` | 今天格 |
| `--wf-chip-today` | `#dce0e2` | 同 | 今天格 |
| `--wf-date-chip` | `#dce0e2` | 同 | 日期 chip |
| `--wf-date-chip-hover` | `#d0d5d8` | `rgb(255 255 255 / 0.24)` | 日期 chip 悬停 |
| `--wf-top-circle` | `#dce0e2` | `rgb(255 255 255 / 0.12)` | 面包屑圆底 |
| `--wf-top-icon` | `#a0a5a9` | `#a8a29e` | 面包屑图标 |
| `--wf-top-sep` | `#5b6166` | `#d6d3d1` | 面包屑分隔箭头 |
| `--wf-top-crumb` | `#8b9094` | `#a8a29e` | 面包屑文字 |

### I. 尺寸/图标（随界面字号 rem 缩放）

| Token | 值 | 语义 |
|---|---|---|
| `--tabbar-h` | `2.533rem`（=38px@15） | 标签条高度 |
| `--icon-size-xs` | `0.8rem` | 图标 12 |
| `--icon-size-sm` | `0.867rem` | 图标 13 |
| `--icon-size-md` | `0.933rem` | 图标 14 |
| `--icon-size-lg` | `1.067rem` | 图标 16 |
| `--icon-stroke` | `1.4` | 图标描边基准 |

## 未来主题接口（Phase 2 已实现）

```ts
// 领域（domain/preferences.ts）：
interface CustomTheme { id: string; name: string; base: "light" | "dark"; tokens: ThemeTokens }
// PreferencesConfig 增加：themeId: string | null（null = 内置）+ customThemes: CustomTheme[]
// 服务（application/preferences-service.ts）：
//   apply() = 内置主题表（domain/theme-tokens.ts）∪ 匹配 base 的自定义 tokens → 以 --x 内联注入 <html>；
//   accent 独立偏好最后注入（自定义 token 覆盖不了 accent）。
// UI（components/ThemeManager.tsx）：内置/自定义选择、新建、重命名、删除、复制 JSON、粘贴导入。
// 边界：token 数 ≤100/主题、值长 ≤800、key 必须 --xxx 格式；非法字段领域归一化剔除。
```
