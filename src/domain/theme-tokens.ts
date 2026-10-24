// 主题 token 规范（纯数据）：内置亮/暗两套语义变量全集。
// 自定义主题 = 覆盖本表任意子集；PreferencesService 把「基础主题 ∪ 自定义 tokens」
// 合并结果以 --x 内联注入 <html>，CSS 文件里的 :root / [data-theme=dark] 保留同值
// 作为无 JS 回退。权威以本文件为准（改这里需同步 styles.css 与 docs/theme-tokens.md）。
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
  "--active-bg": "rgb(var(--accent-rgb) / 0.25)",
  "--active-bg-hover": "rgb(var(--accent-rgb) / 0.35)",
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
