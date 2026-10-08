// 文件名工具（独立成模块，避免组件文件混入非组件导出导致 Fast Refresh 失效）
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^\[\]]/g, "").trim();
}
