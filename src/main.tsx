import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./i18n";
import { silentCheck } from "./updater/store";
import { IS_MAC } from "./lib/platform";
import "./styles.css";

// macOS：系统红绿灯悬浮在窗口左上（titleBarStyle=overlay），
// 打上标记让侧栏顶排/收起侧栏后的标签条让位（见 styles.css 的 .on-mac）
if (IS_MAC) document.documentElement.classList.add("on-mac");

// 领域容器由 App 按 session 创建（切仓库 = 重建容器 + remount），
// 这里只保留设置上下文
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </React.StrictMode>
);

// 启动 3s 后静默检查更新（仅生产构建的 Windows 桌面端；dev/web 内部跳过）
silentCheck();
