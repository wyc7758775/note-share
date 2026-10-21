// Preferences（偏好聚合）：界面语言/字号/主题/主题色的唯一权威。
// 纯领域：无 IO、无 React；只做校验与归一化（字号钳制、色值校验、system 解析）。
// 变更经 EventBus 发 preferencesChanged（完整 config 载荷），UI 与持久化服务各自订阅。
// 全局单例（不随仓库切换重建）：语言与外观是应用级事实，与 vault 无关。

import type { EventBus } from "./events";
import type { ThemeBase, ThemeTokens } from "./theme-tokens";

export type Lang = "zh" | "en";
export type ThemePref = "light" | "dark" | "system";

/** 主题色配置：亮/暗主题各自的强调色（独立于主题 token，最后注入） */
export interface AccentColors {
  light: string;
  dark: string;
}

/** 自定义主题：覆盖基础主题的任意 token 子集（Phase 2） */
export interface CustomTheme {
  id: string;
  name: string;
  base: ThemeBase; // 生效于哪个基础模式（亮/暗）
  tokens: ThemeTokens;
}

export interface PreferencesConfig {
  version: 1;
  lang: Lang;
  /** 界面字号（rem 基准，px）：钳制 13~17 */
  uiFontSize: number;
  /** 编辑器正文字号（px）：钳制 14~22 */
  editorFontSize: number;
  theme: ThemePref;
  accent: AccentColors;
  /** 光标粗细（px）：1~6 */
  caretWidth: number;
  /** 光标长短（占行高比）：0.45~1 */
  caretRatio: number;
  /** 光标颜色：accent（主题色）/ ink（文字色）/ #rrggbb */
  caretColor: string;
  /** 打字机模式：光标垂直居中 */
  typewriter: boolean;
  /** 光标大跳转动画（跨行长距离移动） */
  caretAnimate: boolean;
  /** 当前选用的自定义主题 id；null = 内置主题 */
  themeId: string | null;
  customThemes: CustomTheme[];
}

export const DEFAULT_ACCENT: AccentColors = { light: "#b45309", dark: "#d97706" };

export const DEFAULTS: PreferencesConfig = {
  version: 1,
  lang: "zh",
  uiFontSize: 15,
  editorFontSize: 16,
  theme: "system",
  accent: { ...DEFAULT_ACCENT },
  caretWidth: 3,
  caretRatio: 0.85,
  caretColor: "accent",
  typewriter: false,
  caretAnimate: true,
  themeId: null,
  customThemes: [],
};

export const UI_FONT_MIN = 13;
export const UI_FONT_MAX = 17;
export const EDITOR_FONT_MIN = 14;
export const EDITOR_FONT_MAX = 22;

const clamp = (n: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normColor(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX_RE.test(v) ? v : fallback;
}

const TOKEN_KEY_RE = /^--[a-zA-Z0-9_-]{1,48}$/;
const TOKEN_MAX = 100; // 单个主题最多覆盖的 token 数
const TOKEN_VALUE_MAX = 800; // 单个 token 值长度上限（防恶意导入撑爆存储）
const ID_MAX = 48;

/** 主题 id 清理：只留安全字符；空则返回 null（调用方生成新 id） */
export function sanitizeThemeId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, ID_MAX);
  return s || null;
}

function normTokens(v: unknown): ThemeTokens {
  const out: ThemeTokens = {};
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (Object.keys(out).length >= TOKEN_MAX) break;
      if (!TOKEN_KEY_RE.test(k) || typeof val !== "string") continue;
      out[k] = val.slice(0, TOKEN_VALUE_MAX);
    }
  }
  return out;
}

function normTheme(v: unknown): CustomTheme | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Partial<CustomTheme>;
  const id = sanitizeThemeId(t.id);
  if (!id) return null;
  const name =
    typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 40) : "未命名主题";
  return { id, name, base: t.base === "dark" ? "dark" : "light", tokens: normTokens(t.tokens) };
}

const THEME_COLORS = ["accent", "ink"] as const;

function normCaretColor(v: unknown): string {
  if (typeof v === "string") {
    if ((THEME_COLORS as readonly string[]).includes(v)) return v;
    if (HEX_RE.test(v)) return v;
  }
  return DEFAULTS.caretColor;
}

/** 归一化 + 钳制：非法字段回退默认（外部数据进领域的唯一入口） */
export function normalize(input: Partial<PreferencesConfig>): PreferencesConfig {
  // 自定义主题列表：去重（先到先得）、逐项校验
  const seen = new Set<string>();
  const customThemes: CustomTheme[] = [];
  for (const t of Array.isArray(input.customThemes) ? input.customThemes : []) {
    const nt = normTheme(t);
    if (nt && !seen.has(nt.id)) {
      seen.add(nt.id);
      customThemes.push(nt);
    }
  }
  const themeIdRaw = sanitizeThemeId(input.themeId);
  const themeId = themeIdRaw && seen.has(themeIdRaw) ? themeIdRaw : null; // 指向不存在 → 回退内置
  return {
    version: 1,
    lang: input.lang === "en" ? "en" : "zh",
    uiFontSize: clamp(input.uiFontSize as number, UI_FONT_MIN, UI_FONT_MAX, DEFAULTS.uiFontSize),
    editorFontSize: clamp(
      input.editorFontSize as number,
      EDITOR_FONT_MIN,
      EDITOR_FONT_MAX,
      DEFAULTS.editorFontSize
    ),
    theme: input.theme === "light" || input.theme === "dark" || input.theme === "system"
      ? input.theme
      : DEFAULTS.theme,
    accent: {
      light: normColor(input.accent?.light, DEFAULT_ACCENT.light),
      dark: normColor(input.accent?.dark, DEFAULT_ACCENT.dark),
    },
    caretWidth: clamp(input.caretWidth as number, 1, 6, DEFAULTS.caretWidth),
    caretRatio: Math.round(clamp(input.caretRatio as number, 0.45, 1, DEFAULTS.caretRatio) * 100) / 100,
    caretColor: normCaretColor(input.caretColor),
    typewriter: input.typewriter === true,
    caretAnimate: input.caretAnimate !== false,
    themeId,
    customThemes,
  };
}

/** system 主题解析（纯函数；systemDark 由调用方提供 matchMedia 结果） */
export function resolveDark(theme: ThemePref, systemDark: boolean): boolean {
  return theme === "system" ? systemDark : theme === "dark";
}

/** 十六进制色 → RGB 三元组（供 --accent-rgb 派生透明度用） */
export function hexToRgbTriple(hex: string): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "180 83 9";
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export class Preferences {
  private config: PreferencesConfig = { ...DEFAULTS };
  private version = 0;
  private listeners = new Set<() => void>();

  constructor(private bus: EventBus) {}

  get(): Readonly<PreferencesConfig> {
    return this.config;
  }

  /** 启动装载（外部持久化数据）：静默归一化，不逐字段发事件 */
  load(raw: unknown) {
    if (raw && typeof raw === "object") {
      this.config = normalize(raw as Partial<PreferencesConfig>);
      this.bump();
    }
  }

  /** 修改偏好（UI 只发这个命令）；变更后广播完整 config */
  set(next: Partial<PreferencesConfig>) {
    this.config = normalize({ ...this.config, ...next });
    this.bump();
  }

  /** 选择主题方案：null = 内置；id = 自定义主题 */
  setThemeId(id: string | null) {
    this.set({ themeId: id });
  }

  /** 新增或覆盖保存一个自定义主题（按 id upsert）；保存后自动选中 */
  saveTheme(theme: CustomTheme) {
    const id = sanitizeThemeId(theme.id);
    if (!id) return;
    const rest = this.config.customThemes.filter((t) => t.id !== id);
    this.set({
      customThemes: [...rest, theme],
      themeId: id,
    });
  }

  /** 删除自定义主题；若当前选中它则回退内置 */
  removeTheme(id: string) {
    const next = this.config.customThemes.filter((t) => t.id !== id);
    this.set({
      customThemes: next,
      themeId: this.config.themeId === id ? null : this.config.themeId,
    });
  }

  /** 生成不冲突的主题 id */
  nextThemeId(): string {
    for (let i = 1; i < 10000; i++) {
      const id = `ct-${i}`;
      if (!this.config.customThemes.some((t) => t.id === id)) return id;
    }
    return `ct-${Date.now().toString(36)}`;
  }

  themeOf(id: string | null): CustomTheme | undefined {
    return id ? this.config.customThemes.find((t) => t.id === id) : undefined;
  }

  private bump() {
    this.version++;
    this.bus.emit({ type: "preferencesChanged", config: this.snapshot() });
    this.listeners.forEach((fn) => fn());
  }

  /** 深拷贝快照（事件载荷与持久化共用，杜绝外部改写内部状态） */
  snapshot(): PreferencesConfig {
    return {
      ...this.config,
      accent: { ...this.config.accent },
      customThemes: this.config.customThemes.map((t) => ({ ...t, tokens: { ...t.tokens } })),
    };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;
}
