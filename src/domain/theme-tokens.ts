// 主题 token 规范（纯数据）：内置亮/暗两套语义变量全集 + 内置预设方案表。
// 自定义主题 = 覆盖基础主题任意子集；预设方案 = 预先调好的一整套（代码里的静态事实）。
// PreferencesService 把「基础主题 ∪ 方案 tokens」合并结果以 --x 内联注入 <html>，
// CSS 文件里的 :root / [data-theme=dark] 保留同值作为无 JS 回退。
// 权威以本文件为准（改这里需同步 styles.css 与 docs/theme-tokens.md）。
// 注：--accent / --accent-rgb 由偏好里的主题色独立注入（最后覆盖）；尺寸 token
// （--tabbar-h / --icon-size-* / --editor-font-size）不属于主题，不在此表。

export interface ThemeTokens {
  [key: string]: string;
}

export type ThemeBase = "light" | "dark";

/** Workflowy 派生 token：保留 var() 引用，自定义主题覆盖 --ink 等基础色时自动联动；
 *  直接覆盖 --wf-* 亦可。 */
const WF_REF: ThemeTokens = {
  "--wf-text": "var(--ink)",
  "--wf-sub": "var(--ink-soft)",
  "--wf-note": "var(--ink-soft)",
  "--wf-bg": "var(--paper)",
  "--wf-bg2": "var(--surface-hover)",
  "--wf-bg3": "var(--line)",
};

export const BUILTIN_LIGHT: ThemeTokens = {
  "--paper": "#ffffff",
  "--paper-side": "#f6f6f6",
  "--surface": "#ffffff",
  "--surface-hover": "rgb(0 0 0 / 0.05)",
  "--ink": "#292524",
  "--ink-soft": "#78716c",
  "--ink-faint": "#a8a29e",
  "--line": "#e4e4e4",
  "--line-strong": "#d6d3d1",
  "--active-bg": "rgb(var(--accent-rgb) / 0.12)",
  "--active-bg-hover": "rgb(var(--accent-rgb) / 0.18)",
  "--tabbar-bg": "color-mix(in srgb, var(--ink) 13%, var(--paper))",
  "--search-hit-bg": "#fff3a3",
  "--btn-bg": "#292524",
  "--btn-bg-hover": "#44403c",
  "--btn-fg": "#fafaf9",
  "--code-bg": "#eee9e2",
  "--code-fg": "#7c2d12",
  "--code-block-bg": "#1c1917",
  "--code-block-border": "transparent",
  "--danger-bg": "#fef2f2",
  "--tip-bg": "#1c1917",
  "--tip-fg": "#fafaf9",
  "--shadow-card": "0 8px 28px rgb(0 0 0 / 0.13)",
  "--note-ph": '"备注…"',
  ...WF_REF,
  "--wf-chip-base": "#f3f4f4",
  "--wf-chip-cur": "#dce0e2",
  "--wf-chip-today": "#dce0e2",
  "--wf-date-chip": "#dce0e2",
  "--wf-date-chip-hover": "#d0d5d8",
  "--wf-top-circle": "#dce0e2",
  "--wf-top-icon": "#a0a5a9",
  "--wf-top-sep": "#5b6166",
  "--wf-top-crumb": "#8b9094",
};

export const BUILTIN_DARK: ThemeTokens = {
  "--paper": "#1a1817",
  "--paper-side": "#272221",
  "--surface": "#292524",
  "--surface-hover": "rgb(255 255 255 / 0.06)",
  "--ink": "#e7e5e4",
  "--ink-soft": "#a8a29e",
  "--ink-faint": "#78716c",
  "--line": "#37312f",
  "--line-strong": "#44403c",
  "--active-bg": "rgb(var(--accent-rgb) / 0.18)",
  "--active-bg-hover": "rgb(var(--accent-rgb) / 0.26)",
  "--tabbar-bg": "color-mix(in srgb, var(--ink) 16%, var(--paper))",
  "--search-hit-bg": "rgb(250 204 21 / 0.22)",
  "--btn-bg": "#e7e5e4",
  "--btn-bg-hover": "#d6d3d1",
  "--btn-fg": "#1c1917",
  "--code-bg": "rgb(255 255 255 / 0.08)",
  "--code-fg": "#e0af68",
  "--code-block-bg": "#232020",
  "--code-block-border": "var(--line)",
  "--danger-bg": "rgb(220 38 38 / 0.15)",
  "--tip-bg": "#3f3a37",
  "--tip-fg": "#fafaf9",
  "--shadow-card": "0 8px 28px rgb(0 0 0 / 0.45)",
  "--note-ph": '"备注…"',
  ...WF_REF,
  "--wf-chip-base": "rgb(255 255 255 / 0.05)",
  "--wf-chip-cur": "rgb(255 255 255 / 0.16)",
  "--wf-chip-today": "rgb(255 255 255 / 0.16)",
  "--wf-date-chip": "rgb(255 255 255 / 0.16)",
  "--wf-date-chip-hover": "rgb(255 255 255 / 0.24)",
  "--wf-top-circle": "rgb(255 255 255 / 0.12)",
  "--wf-top-icon": "#a8a29e",
  "--wf-top-sep": "#d6d3d1",
  "--wf-top-crumb": "#a8a29e",
};

export function builtin(base: ThemeBase): ThemeTokens {
  return base === "dark" ? BUILTIN_DARK : BUILTIN_LIGHT;
}

/** 方案可覆盖的非主题色 token（字体/字距等常量，定义在 styles.css 的常量 :root 块）。
 *  预设与自定义主题都能改它们（换字体、放宽标签字距），门禁校验以此为准。 */
export const SCHEME_EXTRA_TOKENS = [
  "--font-ui",
  "--font-serif",
  "--font-mono",
  "--track-label",
] as const;

/** 内置预设方案：代码里的静态事实（进 git、随版本升级、可 review），
 *  与用户的 customThemes（用户数据）分开存 —— 删不掉的才是预设，改得动的才是自定义。
 *  id 必须落在 Preferences.sanitizeThemeId 允许的字符集（字母/数字/下划线/连字符）。
 *  nameKey / descKey 是 i18n key，展示名不放这里（中英各一份，跟语言切换）。 */
export interface ThemePreset {
  id: string;
  nameKey: string;
  descKey: string;
  /** 方案只在自己的 base 模式下生效（与当前亮/暗一致时） */
  base: ThemeBase;
  /** 相对基础主题的覆盖子集；不含 --accent（强调色是用户偏好，最后注入） */
  tokens: ThemeTokens;
}

/** Solarized Dark（源自 Ethan Schoonover 的 Solarized 规范色）：
 *  底色/分层/代码色全保规范值（#002b36 画布、#073642 表面、#2aa198 代码），
 *  只把三级文字明度抬到与内置暗色同档——忠实版正文仅 4.75:1、弱文字 2.79:1，
 *  在笔记正文里偏糊；本表实测 9.44 / 6.66 / 4.00。想还原原味，把这三行换回
 *  #839496 / #657b83 / #586e75 即可。 */
export const SOLARIZED_DARK: ThemeTokens = {
  "--paper": "#002b36",
  "--paper-side": "#00252e",
  "--surface": "#073642",
  "--surface-hover": "rgb(147 161 161 / 0.12)",
  "--ink": "#c5cfcf",
  "--ink-soft": "#9fb0b1",
  "--ink-faint": "#71888b",
  "--line": "#0e3d49",
  "--line-strong": "#14505e",
  "--active-bg": "rgb(var(--accent-rgb) / 0.22)",
  "--active-bg-hover": "rgb(var(--accent-rgb) / 0.32)",
  "--tabbar-bg": "color-mix(in srgb, var(--ink) 10%, var(--paper))",
  "--search-hit-bg": "rgb(181 137 0 / 0.30)",
  "--btn-bg": "#9fb0b1",
  "--btn-bg-hover": "#b2c0c0",
  "--btn-fg": "#002b36",
  "--code-bg": "rgb(147 161 161 / 0.12)",
  "--code-fg": "#2aa198",
  "--code-block-bg": "#00252e",
  "--code-block-border": "var(--line)",
  "--danger-bg": "rgb(220 50 47 / 0.18)",
  "--tip-bg": "#073642",
  "--tip-fg": "#eee8d5",
  "--shadow-card": "0 8px 28px rgb(0 0 0 / 0.5)",
  "--wf-chip-base": "rgb(147 161 161 / 0.08)",
  "--wf-chip-cur": "rgb(147 161 161 / 0.18)",
  "--wf-chip-today": "rgb(147 161 161 / 0.18)",
  "--wf-date-chip": "rgb(147 161 161 / 0.18)",
  "--wf-date-chip-hover": "rgb(147 161 161 / 0.26)",
  "--wf-top-circle": "rgb(147 161 161 / 0.15)",
  "--wf-top-icon": "#71888b",
  "--wf-top-sep": "#9fb0b1",
  "--wf-top-crumb": "#9fb0b1",
};

/** 纸张（米白纸底 + 靛蓝）：纸感的要点不是"更亮的卡片"，而是
 *  卡片与纸底几乎同色（1.06:1）+ 1px 暖边 + 几乎无阴影 + 大留白；
 *  再叠一层放宽的小标签字距（--track-label）出"工程图纸"味。
 *  写字太亮或阴影太重，立刻退化成普通浅色主题。 */
export const PAPER_LIGHT: ThemeTokens = {
  "--paper": "#f4efe4",
  "--paper-side": "#efe8db",
  "--surface": "#faf6ee",
  "--surface-hover": "rgb(90 75 50 / 0.06)",
  "--ink": "#2f2b26",
  "--ink-soft": "#5d564c",
  "--ink-faint": "#7d7466",
  "--line": "#ddd3c0",
  "--line-strong": "#d0c5b0",
  "--active-bg": "rgb(var(--accent-rgb) / 0.14)",
  "--active-bg-hover": "rgb(var(--accent-rgb) / 0.20)",
  "--tabbar-bg": "color-mix(in srgb, var(--ink) 8%, var(--paper))",
  "--search-hit-bg": "rgb(181 137 0 / 0.16)",
  "--btn-bg": "#2f2b26",
  "--btn-bg-hover": "#453f37",
  "--btn-fg": "#faf6ee",
  "--code-bg": "rgb(90 75 50 / 0.07)",
  "--code-fg": "#8a4b2a",
  "--code-block-bg": "#2f2b26",
  "--code-block-border": "transparent",
  "--danger-bg": "#f6e2dc",
  "--tip-bg": "#2f2b26",
  "--tip-fg": "#faf6ee",
  "--shadow-card": "0 1px 2px rgb(60 45 20 / 0.06), 0 8px 24px rgb(60 45 20 / 0.05)",
  "--wf-chip-base": "#ece4d5",
  "--wf-chip-cur": "#ded3be",
  "--wf-chip-today": "#ded3be",
  "--wf-date-chip": "#ded3be",
  "--wf-date-chip-hover": "#d2c6ae",
  "--wf-top-circle": "#ded3be",
  "--wf-top-icon": "#8a8175",
  "--wf-top-sep": "#6b6357",
  "--wf-top-crumb": "#7d7466",
  "--track-label": "0.1em",
};

/** 内置预设方案表（顺序即 UI 列表顺序）。新增方案只需往数组里加一项。 */
export const PRESETS: readonly ThemePreset[] = [
  {
    id: "preset-solarized",
    nameKey: "themePresetSolarized",
    descKey: "themePresetSolarizedDesc",
    base: "dark",
    tokens: SOLARIZED_DARK,
  },
  {
    id: "preset-paper",
    nameKey: "themePresetPaper",
    descKey: "themePresetPaperDesc",
    base: "light",
    tokens: PAPER_LIGHT,
  },
];

export function findPreset(id: string | null | undefined): ThemePreset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}
