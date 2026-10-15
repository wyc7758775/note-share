import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./i18n";
import { silentCheck } from "./updater/store";
import "./styles.css";

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
