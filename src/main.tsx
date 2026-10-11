import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./i18n";
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
