import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsProvider } from "./i18n";
import { createDomain, DomainProvider } from "./domain/provider";
import "./styles.css";

// 组合根：领域容器在 React 之外创建一次（全局唯一），
// StrictMode 双渲染不会产生第二个实例
const domain = createDomain();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <DomainProvider domain={domain}>
        <App />
      </DomainProvider>
    </SettingsProvider>
  </React.StrictMode>
);
