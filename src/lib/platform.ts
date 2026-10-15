// 平台与运行环境判定（自绘标题栏、右键菜单文案等共用）。
// 平台探测与 Editor 的 MOD_KEY 同一套：优先 userAgentData.platform，回退 navigator.platform。
const PLATFORM =
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
  navigator.platform ??
  "";

export const IS_MAC = /mac|iphone|ipad|ipod/i.test(PLATFORM);
