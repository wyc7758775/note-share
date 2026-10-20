// Home 视图的跨组件导航总线（window 事件 + 待消费的 zoom 目标）。
// HomeView 是懒加载 tab 内容，跳转发生时可能尚未挂载：
// pendingZoom 先记下目标，挂载完成（setContent 之后）再消费。

export const OPEN_HOME_EVENT = "noteshare:open-home";
export const ZOOM_HOME_EVENT = "noteshare:zoom-home";
/** 全局返回/前进（鼠标侧键）：由当前激活视图先处理（Home 的 zoom），未处理再落 App 历史 */
export const NAV_BACK_EVENT = "noteshare:nav-back";
export const NAV_FORWARD_EVENT = "noteshare:nav-forward";
/** 点击 Home/Workflowy 入口：清空搜索并回到原始大纲 */
export const RESET_HOME_EVENT = "noteshare:reset-home";

export interface HomeOpenOpts {
  newTab?: boolean;
  newPane?: boolean;
}

/** 节点 zoom 目标：优先 blockId；没有则按树地址（挂载后从文档解析定位） */
export interface HomeZoomTarget {
  blockId?: string;
  address?: number[];
}

let pendingZoom: HomeZoomTarget | null = null;

/** 打开 Home 标签（App 监听，内部有全局去重） */
export function requestOpenHome(opts: HomeOpenOpts = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_HOME_EVENT, { detail: opts }));
}

/** 请求 Home 缩放到某节点（HomeView 已挂载则立即应用，否则记为待消费） */
export function requestZoomHome(target: HomeZoomTarget) {
  pendingZoom = target;
  window.dispatchEvent(new CustomEvent(ZOOM_HOME_EVENT, { detail: target }));
}

/** HomeView 挂载后/事件到达时取走待缩放目标 */
export function consumePendingZoom(): HomeZoomTarget | null {
  const p = pendingZoom;
  pendingZoom = null;
  return p;
}
