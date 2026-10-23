// PreferencesService（应用服务）：偏好的唯一 IO 与 DOM 投影入口。
// - 持久化：localStorage（key `noteshare.prefs`，自动迁移旧 noteshare.lang/theme/accent）
// - 投影：<html> 的 data-theme / lang / font-size（rem 基准）/ --editor-font-size / --accent*
//   这些 DOM 状态全部可由 config 全量重建（启动 bootstrap 时重建一次）。
// 订阅 preferencesChanged 事件 → 应用投影 + 防抖落盘；UI 层不直接读写 localStorage/DOM。

import type { EventBus } from "../domain/events";
import { EventBus as EventBusImpl } from "../domain/events";
import type { PreferencesConfig } from "../domain/preferences";
import {
  Preferences,
  hexToRgbTriple,
  resolveDark,
} from "../domain/preferences";
import { builtin, type ThemeTokens } from "../domain/theme-tokens";

const KEY = "noteshare.prefs";

/** 读旧版分散存储并合并进新 key（迁移一次后旧 key 仍保留原值，不再读） */
function readStorage(): unknown {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* 损坏回退旧 key */
  }
  const legacy: Record<string, unknown> = {};
  if (localStorage.getItem("noteshare.lang") === "en") legacy.lang = "en";
  const t = localStorage.getItem("noteshare.theme");
  if (t === "light" || t === "dark" || t === "system") legacy.theme = t;
  try {
    const a = JSON.parse(localStorage.getItem("noteshare.accent") ?? "null");
    if (a && typeof a.light === "string" && typeof a.dark === "string") legacy.accent = a;
  } catch {
    /* 忽略 */
  }
  return Object.keys(legacy).length ? legacy : null;
}

function systemDark(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

export class PreferencesService {
  private persistTimer: number | undefined;
  private offBus: (() => void) | null = null;
  private offMedia: (() => void) | null = null;

  constructor(
    private bus: EventBus,
    private prefs: Preferences
  ) {}

  /** 启动：装载持久化配置 → 重建 DOM 投影 → 订阅变更事件与系统暗色变化。
   *  幂等：React StrictMode（开发模式）会 mount → unmount → mount，
   *  bootstrap 可能被调用多次，订阅不允许叠加、也不允许在 dispose 后失联。
   *  （旧实现把订阅放构造函数、dispose 只退订不重订：StrictMode 第二次
   *  bootstrap 后事件流断裂，主题/语言/字号切换全部失效，只能刷新页面。） */
  bootstrap() {
    if (!this.offBus) {
      this.offBus = this.bus.on("preferencesChanged", (e) => {
        if (e.type !== "preferencesChanged") return;
        this.apply(e.config);
        this.schedulePersist(e.config);
      });
    }
    const raw = readStorage();
    if (raw) this.prefs.load(raw);
    this.apply(this.prefs.get());
    if (typeof window.matchMedia === "function" && !this.offMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => this.apply(this.prefs.get());
      mq.addEventListener("change", onChange);
      this.offMedia = () => mq.removeEventListener("change", onChange);
    }
  }

  dispose() {
    this.offBus?.();
    this.offBus = null;
    this.offMedia?.();
    this.offMedia = null;
    window.clearTimeout(this.persistTimer);
  }

  /** 把 config 应用到 <html>（投影全量重建，幂等） */
  private apply(cfg: PreferencesConfig) {
    const root = document.documentElement;
    const dark = resolveDark(cfg.theme, systemDark());
    root.lang = cfg.lang === "en" ? "en" : "zh-CN";
    root.dataset.theme = dark ? "dark" : "light";
    // rem 基准：界面字号 = html 字号（全 UI 字号已 rem 化）
    root.style.fontSize = `${cfg.uiFontSize}px`;
    root.style.setProperty("--editor-font-size", `${cfg.editorFontSize}px`);
    // 主题 token：基础主题 ∪ 自定义覆盖（base 与当前模式匹配才生效）
    const custom = cfg.themeId
      ? cfg.customThemes.find((t) => t.id === cfg.themeId && t.base === (dark ? "dark" : "light"))
      : undefined;
    const tokens: ThemeTokens = { ...builtin(dark ? "dark" : "light"), ...(custom?.tokens ?? {}) };
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    // 强调色独立偏好，最后注入（自定义 token 覆盖不了 accent）
    const hex = dark ? cfg.accent.dark : cfg.accent.light;
    root.style.setProperty("--accent", hex);
    root.style.setProperty("--accent-rgb", hexToRgbTriple(hex));
  }

  private schedulePersist(cfg: PreferencesConfig) {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(cfg));
      } catch {
        /* 存储满等异常：静默，下次变更再试 */
      }
    }, 200);
  }
}

/** 应用级单例装配（main.tsx 调用一次；与 vault 生命周期无关） */
export function createPreferencesContext(): { prefs: Preferences; service: PreferencesService; bus: EventBus } {
  const bus = new EventBusImpl();
  const prefs = new Preferences(bus);
  const service = new PreferencesService(bus, prefs);
  return { prefs, service, bus };
}
