# 主题 Token 清单（语义变量规范）

> 主题 = 一组语义 token 的命名映射，由外观服务以 `--x` 内联注入 `<html>`，CSS 文件只保留本表作为 fallback。
> 自定义主题 = 覆盖本表任意子集；内置预设方案 = 预先调好的一整套（见文末「内置预设方案」）。
>
> **权威在 `src/domain/theme-tokens.ts`**（运行时真正生效的值从这里注入），`src/styles.css` 里的
> `:root` / `html[data-theme="dark"]` 是**无 JS 回退**，必须与之同值；本表是整理视图。改 token 三处同步。

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

## 主题方案（Phase 2，已实现）

```ts
// 领域（domain/preferences.ts）：
interface CustomTheme { id: string; name: string; base: "light" | "dark"; tokens: ThemeTokens }
interface ThemeScheme { base: "light" | "dark"; tokens: ThemeTokens }  // 预设与自定义的统一形状
findScheme(id, customThemes)  // 预设 ∪ 自定义；未知 id → undefined（回退内置主题）
// PreferencesConfig：themeId: string | null（null = 内置）+ customThemes: CustomTheme[]
// 服务（application/preferences-service.ts）：
//   apply() = 内置主题表 ∪ 方案 tokens（base 与当前亮/暗一致才生效）→ 以 --x 内联注入 <html>；
//   accent 独立偏好最后注入（方案 token 覆盖不了 accent）。
// UI（components/ThemeManager.tsx）：内置/预设/自定义选择、新建、重命名、删除、复制 JSON、粘贴导入。
// 边界：token 数 ≤100/主题、值长 ≤800、key 必须 --xxx 格式；非法字段领域归一化剔除。
```

## 内置预设方案（PRESETS）

预设是**代码里的静态事实**（`domain/theme-tokens.ts` 的 `PRESETS`），与用户的 `customThemes`
（用户数据，存 localStorage）分开存：预设删不掉、随版本升级、可 review；自定义主题改得动但要自己维护。

| id | 名称 | base | tokens 表 | 说明 |
|---|---|---|---|---|
| `preset-solarized` | Solarized 深青 | dark | `SOLARIZED_DARK` | 深青底 + 暖橙点缀，源自 Solarized 规范色 |
| `preset-paper` | 纸张 | light | `PAPER_LIGHT` | 米白纸底 + 靛蓝点缀，小标签放宽字距 |

规则：

- **id 是保留字**：必须匹配 `sanitizeThemeId` 的字符集（字母/数字/下划线/连字符，≤48），所以用
  `preset-solarized` 而不是 `preset:solarized`（冒号会被过滤）。自定义主题与预设重名会被领域丢弃。
- **方案自带 base**：点选预设时 UI 顺手把亮/暗模式切到它的 base（否则暗色方案在亮色模式下
  "点了没反应"）。之后用户手动切到别的模式，方案自动退回内置主题（沿用既有「当前模式不生效」语义，不加锁）。
- **不含 `--accent`**：强调色是用户偏好，服务层最后注入，任何方案都覆盖不了它。
- **对比度基线**：内置暗色 ink/soft/faint = 14.09 / 7.02 / 3.69；Solarized 忠实版只有
  4.75 / 3.37 / 2.79（正文刚过 AA、弱文字偏糊），所以预设把三级文字明度抬到 9.44 / 6.66 / 4.00。
  想还原 Solarized 原味：把 `SOLARIZED_DARK` 里 `--ink` / `--ink-soft` / `--ink-faint`
  换回 `#839496` / `#657b83` / `#586e75` 三行即可。
- 纸张主题的"纸感"来自**卡片与纸底几乎同色（1.06:1）+ 1px 暖边 + 几乎无阴影**；
  把卡片提亮或加重阴影，立刻退化成普通浅色主题。

新增一套预设 = 往 `PRESETS` 数组里加一项 + i18n 两个 key（`nameKey` / `descKey`），门禁会自动校验。

## 字体与字距 token

字体不随亮暗变化，所以定义在 `styles.css` 的**非主题常量 `:root` 块**（第二个），
不进 `BUILTIN_LIGHT / BUILTIN_DARK`，也就不受"主题色必须有暗色覆盖"的约束：

| Token | 默认 | 语义 |
|---|---|---|
| `--font-ui` | 系统 UI 栈（-apple-system / Segoe UI / 苹方 / 微软雅黑 / Noto Sans SC） | 界面、大纲正文 |
| `--font-serif` | Noto Serif SC → 思源宋体 → Songti SC → SimSun → Georgia | 笔记标题、`.serif` |
| `--font-mono` | ui-monospace / SFMono / Menlo / Consolas / JetBrains Mono | 代码块与行内代码 |
| `--track-label` | `0` | 小标签字距（设置分区标题、提示行、标签条字）；纸张主题设 `0.1em` |

方案要覆盖它们，只需在 tokens 里写同名 key —— 白名单见 `domain/theme-tokens.ts` 的
`SCHEME_EXTRA_TOKENS`。门禁会校验两件事：方案只许覆盖白名单内的非主题 token；且每个白名单 token
必须在 `styles.css` 有定义（防"白名单里写了拼错的变量名"）。

**已知限制：仓库不打包任何字体文件**（`public/` 下无 fonts）。`--font-serif` 第一顺位
`Noto Serif SC` 只在系统装了思源宋体时生效，否则逐级降级到 Songti SC / SimSun / Georgia ——
也就是同一份笔记在装了字体和没装字体的机器上标题字形不同。跨平台一致的唯一办法是自带 woff2
（拉丁几十 KB，中文全量 5–10MB），本轮未做。
