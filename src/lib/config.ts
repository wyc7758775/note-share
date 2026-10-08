// 发布服务器的连接配置，存在浏览器/桌面本地
export interface PublishConfig {
  serverUrl: string; // 例如 http://your-server:8787
  token: string;
}

const KEY = "noteshare.publish";

export function getPublishConfig(): PublishConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PublishConfig;
  } catch {
    /* ignore */
  }
  return { serverUrl: "", token: "" };
}

export function setPublishConfig(cfg: PublishConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
