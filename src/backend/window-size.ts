// 桌面端窗口尺寸策略（Obsidian 式）：启动页小窗、工作区大窗。
// web 模式 / 窗口 API 不可用时静默跳过，不影响页面本身。
import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";

const PICKER = new LogicalSize(720, 540);
const MAIN = new LogicalSize(1280, 820);

async function apply(size: LogicalSize) {
  try {
    const win = getCurrentWindow();
    await win.setSize(size);
    await win.center();
  } catch {
    /* 非 Tauri 环境或权限缺失：保持当前尺寸 */
  }
}

export function setPickerWindowSize() {
  return apply(PICKER);
}

export function setMainWindowSize() {
  return apply(MAIN);
}
