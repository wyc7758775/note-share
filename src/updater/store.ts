// 应用更新：客户端完整更新（tauri-plugin-updater：下载安装包→自动重启）
// 与前端资源热更新（Rust 命令：下载 zip→立即生效不重启）。
// 模块级 store + useSyncExternalStore：侧栏下载按钮与设置面板版本区共享同一份状态。
// DEV 下可用 ?mockupdate=1 在浏览器里模拟更新态调试 UI。
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import * as updater from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { backend } from "../backend";

export type UpdatePhase =
  | "idle" // 初始 / 有待更新项等待用户操作
  | "checking"
  | "downloading"
  | "installing" // 客户端更新已下载，安装并重启中
  | "uptodate"
  | "error";

export interface UpdateState {
  /** 桌面端才展示版本区（web 模式整个区块隐藏） */
  inApp: boolean;
  /** 允许自动更新：仅 Windows（macOS 未签名，走手动下载） */
  canAuto: boolean;
  inited: boolean;
  checked: boolean;
  appVersion: string;
  /** 服务端可用的客户端新版本 */
  clientVersion: string | null;
  /** 服务端可用的热更版本 */
  hotVersion: string | null;
  /** 已安装热更版本 */
  installedHot: string | null;
  /** 当前页面是否运行在热更资源上 */
  runningHot: boolean;
  phase: UpdatePhase;
  downloaded: number;
  total: number;
  error: string | null;
}

const mock = import.meta.env.DEV && new URLSearchParams(location.search).has("mockupdate");
const inApp = mock || backend.mode === "tauri";
const canAuto = mock || (backend.mode === "tauri" && /windows/i.test(navigator.userAgent));

let state: UpdateState = {
  inApp,
  canAuto,
  inited: false,
  checked: false,
  appVersion: "",
  clientVersion: null,
  hotVersion: null,
  installedHot: null,
  runningHot: false,
  phase: "idle",
  downloaded: 0,
  total: 0,
  error: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** 当前快照（非 hook 场景读取，如 useEffect 里判断） */
export function getUpdates(): UpdateState {
  return state;
}

export function useUpdates(): UpdateState {
  return useSyncExternalStore(subscribeUpdates, getUpdates, getUpdates);
}

function subscribeUpdates(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function busy(): boolean {
  return state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
}

function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

/** 下载进度百分比（总量未知时为 null，UI 显示 spinner） */
export function updatePercent(s: UpdateState): number | null {
  return s.total > 0 ? Math.min(100, Math.round((s.downloaded / s.total) * 100)) : null;
}

/** hotres 协议地址：Windows(WebView2) 自定义协议映射为 http://<scheme>.localhost */
export function hotresIndexUrl(): string {
  return /windows/i.test(navigator.userAgent)
    ? "http://hotres.localhost/index.html"
    : "hotres://localhost/index.html";
}

function embeddedIndexUrl(): string {
  return /windows/i.test(navigator.userAgent)
    ? "http://tauri.localhost/index.html"
    : "tauri://localhost/index.html";
}

/** 启动时初始化：版本号、已装热更、是否运行在热更资源上 */
export async function initUpdater(): Promise<void> {
  if (state.inited) return;
  if (!mock && backend.mode !== "tauri") return;
  const appVersion = mock ? "0.1.0" : await getVersion().catch(() => "");
  const st = mock
    ? { installed: null as string | null }
    : await invoke<{ installed: string | null }>("hot_update_state").catch(() => null);
  set({
    inited: true,
    appVersion,
    installedHot: st?.installed ?? null,
    runningHot: mock ? false : /hotres\.localhost/i.test(location.origin),
  });
}

async function checkClient(): Promise<string | null> {
  try {
    const upd = await updater.check();
    return upd?.version ?? null;
  } catch {
    return null; // 端点不可达/未发布：忽略，热更检查照常
  }
}

async function checkHot(): Promise<string | null> {
  try {
    const hot = await invoke<{ version: string } | null>("check_hot_update");
    return hot?.version ?? null;
  } catch {
    return null;
  }
}

/** 检查更新（客户端 + 热更并行）；有任一可用 → phase 回 idle 等待用户点击 */
export async function checkForUpdates(): Promise<void> {
  if (!state.canAuto || busy()) return;
  if (mock) {
    set({ checked: true, phase: "idle", hotVersion: "9.9.9", clientVersion: null });
    return;
  }
  set({ phase: "checking", error: null });
  const [clientVersion, hotVersion] = await Promise.all([checkClient(), checkHot()]);
  set({
    clientVersion,
    hotVersion,
    checked: true,
    phase: clientVersion || hotVersion ? "idle" : "uptodate",
  });
}

/** 启动静默检查：仅生产构建的桌面端（dev 下用设置面板手动触发） */
export function silentCheck(): void {
  if (import.meta.env.DEV || !state.canAuto) return;
  void initUpdater();
  window.setTimeout(() => {
    void checkForUpdates();
  }, 3000);
}

/** 客户端完整更新：下载（进度）→ 安装 → 重启 */
export async function installClientUpdate(): Promise<void> {
  if (!state.canAuto || busy()) return;
  if (import.meta.env.DEV) {
    set({ phase: "error", error: "DEV 模式不执行安装，请用打包后的应用验证" });
    return;
  }
  try {
    set({ phase: "downloading", error: null, downloaded: 0, total: 0 });
    const upd = await updater.check();
    if (!upd) {
      set({ phase: "uptodate", clientVersion: null });
      return;
    }
    set({ clientVersion: upd.version });
    let received = 0;
    await upd.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          if (event.data.contentLength) set({ total: event.data.contentLength });
          break;
        case "Progress":
          received += event.data.chunkLength;
          set({ downloaded: received });
          break;
        case "Finished":
          set({ phase: "installing" });
          break;
      }
    });
    set({ phase: "installing" });
    await relaunch();
  } catch (e) {
    set({ phase: "error", error: errText(e) });
  }
}

/** 应用热更新：下载 zip → Rust 解压切换 → 前端导航到 hotres（页面卸载即生效） */
export async function applyHotUpdate(): Promise<void> {
  if (!state.canAuto) return;
  if (mock) {
    set({ phase: "downloading", error: null, downloaded: 0, total: 100 });
    let p = 0;
    const timer = window.setInterval(() => {
      p += 10;
      set({ downloaded: Math.min(p, 100) });
      if (p >= 100) {
        window.clearInterval(timer);
        set({ phase: "uptodate", hotVersion: null, installedHot: "9.9.9" });
      }
    }, 180);
    return;
  }
  try {
    const hot = await invoke<{ version: string; url: string } | null>("check_hot_update");
    if (!hot) {
      set({ hotVersion: null, phase: "uptodate" });
      return;
    }
    set({ phase: "downloading", error: null, downloaded: 0, total: 0 });
    await invoke("apply_hot_update", { url: hot.url, version: hot.version });
    // 导航会卸载当前页面，其后代码大概率不再执行
    location.assign(hotresIndexUrl());
  } catch (e) {
    set({ phase: "error", error: errText(e) });
  }
}

/** 清除已安装热更：删除热更目录并回到安装包内置资源 */
export async function clearHotUpdate(): Promise<void> {
  if (mock) {
    set({ installedHot: null, runningHot: false });
    return;
  }
  try {
    await invoke("clear_hot_update");
    location.assign(embeddedIndexUrl());
  } catch (e) {
    set({ phase: "error", error: errText(e) });
  }
}

/** 侧栏下载按钮 / 设置面板更新按钮统一入口：优先客户端完整更新，否则热更 */
export function startUpdate(): void {
  if (busy()) return;
  if (state.clientVersion) void installClientUpdate();
  else if (state.hotVersion) void applyHotUpdate();
}
