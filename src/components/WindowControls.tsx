// 自绘窗口控制按钮：Windows/Linux 关掉原生标题栏后由前端补位（最小化/最大化还原/关闭）。
// macOS 走系统红绿灯（titleBarStyle=overlay 悬浮左上），web 模式无窗口概念——两者都不渲染。
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend } from "../backend";
import { IS_MAC } from "../lib/platform";
import { useSettings } from "../i18n";

export const SHOW_WINDOW_CONTROLS = backend.mode === "tauri" && !IS_MAC;

export default function WindowControls() {
  const { t } = useSettings();
  const [max, setMax] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let dead = false;
    const sync = () =>
      void win.isMaximized().then((m) => {
        if (!dead) setMax(m);
      }).catch(() => {});
    sync();
    const un = win.onResized(sync); // 最大化/还原/拖拽改尺寸都跟着刷图标
    return () => {
      dead = true;
      void un.then((f) => f());
    };
  }, []);

  return (
    <div className="win-controls">
      <button
        className="cap-btn"
        data-tip={t("winMin")}
        onClick={() => void getCurrentWindow().minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0.5 5h9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        className="cap-btn"
        data-tip={max ? t("winRestore") : t("winMax")}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="2.5" width="6" height="6" stroke="currentColor" strokeWidth="1" />
            <path d="M2.8 2.5V0.9c0-.2.2-.4.4-.4h5.9c.2 0 .4.2.4.4v5.9c0 .2-.2.4-.4.4H7.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        className="cap-btn cap-close"
        data-tip={t("winClose")}
        onClick={() => void getCurrentWindow().close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0.7 0.7l8.6 8.6M9.3 0.7L0.7 9.3" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
