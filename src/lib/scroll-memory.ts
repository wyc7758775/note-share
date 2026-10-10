// 笔记阅读位置记忆（仅内存：刷新页面自然清空）。
// Editor 卸载时记录滚动位置，重进同一篇笔记时恢复；重命名迁移、删除清理。

const scrollMemory = new Map<string, number>();

export function rememberScroll(path: string, top: number) {
  if (top > 0) scrollMemory.set(path, top);
  else scrollMemory.delete(path);
}

export function recallScroll(path: string): number {
  return scrollMemory.get(path) ?? 0;
}

export function moveScrollMemory(oldPath: string, newPath: string) {
  const v = scrollMemory.get(oldPath);
  if (v !== undefined) {
    scrollMemory.set(newPath, v);
    scrollMemory.delete(oldPath);
  }
}

export function forgetScroll(path: string) {
  scrollMemory.delete(path);
}
