import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5188,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
    // 笔记库和发布服务的数据文件由应用自己读写，绝不能触发页面刷新
    watch: {
      ignored: ["**/devvault/**", "**/server/**"],
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
});
