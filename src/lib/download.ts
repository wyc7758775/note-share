// 统一的"下载到本地"：浏览器模式触发 <a download> 下载；
// 桌面（Tauri）模式弹出系统保存对话框写入文件（save_binary_file 命令）。
import { backend } from "../backend";

export function extOfDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml)/i);
  if (!m) return "png";
  return m[1].toLowerCase() === "svg+xml" ? "svg" : m[1].toLowerCase().replace("jpeg", "jpg");
}

export async function downloadDataUrl(defaultName: string, dataUrl: string): Promise<string | null> {
  if (backend.mode === "tauri") {
    const b64 = dataUrl.split(",")[1] ?? "";
    return backend.saveBinaryFile(defaultName, b64);
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return defaultName;
}
