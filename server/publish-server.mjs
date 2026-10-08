// NoteShare 发布服务器 —— 零依赖，单文件。
// 作用：接收桌面端"发布"的笔记，把它变成任何人可访问的网页。
//
// 环境变量：
//   PORT      监听端口（默认 8788）
//   TOKEN     发布令牌（必填，桌面端发布时填同一个值）
//   DATA_DIR  数据目录（默认 ./data，Docker 里挂 /data 卷）
//
// 接口：
//   POST /api/publish   （Bearer TOKEN）{slug,title,html,tags[],date}
//   GET  /p/:slug       已发布文章
//   GET  /              已发布文章目录
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT || 8788);
const TOKEN = process.env.TOKEN || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

if (!TOKEN) {
  console.warn("[publish-server] 警告：未设置 TOKEN，任何人都无法发布（阅读不受影响）");
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #faf9f7; color: #292524;
  font: 17px/1.85 -apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
article { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
.doc-title { font-family: "Noto Serif SC", Georgia, serif; font-size: 2.1em; line-height: 1.35; margin: 0 0 12px; }
.doc-meta { color: #a8a29e; font-size: .82em; margin-bottom: 36px; display: flex; gap: 16px; }
.doc-meta .tags { color: #b45309; }
.doc-body img, .doc-body video { max-width: 100%; height: auto; border-radius: 8px; }
.doc-body h1,h2,h3,h4 { font-family: "Noto Serif SC", Georgia, serif; margin: 1.6em 0 .6em; line-height: 1.4; }
.doc-body p { margin: .9em 0; }
.doc-body a { color: #b45309; text-decoration: none; border-bottom: 1px solid #d6b48a; }
.doc-body blockquote { margin: 1.2em 0; padding: .2em 1.2em; border-left: 3px solid #d6d3d1; color: #57534e; background: #f5f4f2; border-radius: 0 6px 6px 0; }
.doc-body pre { background: #1c1917; color: #e7e5e4; padding: 16px 20px; border-radius: 10px; overflow-x: auto; font-size: .86em; }
.doc-body code { font-family: Consolas, monospace; }
.doc-body :not(pre) > code { background: #eee9e2; padding: .15em .4em; border-radius: 4px; font-size: .88em; color: #7c2d12; }
.doc-body ul, .doc-body ol { padding-left: 1.6em; }
.doc-body ul.contains-task-list { list-style: none; padding-left: .4em; }
.doc-body hr { border: none; border-top: 1px solid #e7e5e4; margin: 2.4em auto; width: 60%; }
footer { text-align: center; color: #d6d3d1; font-size: .8em; margin-top: 80px; }
.index-item { display: block; padding: 18px 4px; border-bottom: 1px solid #eee9e2; color: inherit; text-decoration: none; }
.index-item:hover h2 { color: #b45309; }
.index-item h2 { font-family: "Noto Serif SC", Georgia, serif; font-size: 1.25em; margin: 0 0 6px; }
.index-item .meta { color: #a8a29e; font-size: .82em; }
`;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title, body, extraHead = "") =>
  `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title>` +
  `<style>${CSS}</style>${extraHead}</head><body>${body}</body></html>`;

function readMeta(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${slug}.json`), "utf8"));
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");

  // 桌面端/开发端跨源调用
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // 发布
  if (req.method === "POST" && url.pathname === "/api/publish") {
    const auth = req.headers.authorization || "";
    if (!TOKEN || auth !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    const slug = String(body.slug || "");
    if (!/^[\w-]{1,64}$/.test(slug)) {
      res.writeHead(400).end("slug 只能包含字母数字、下划线和连字符");
      return;
    }
    const html = String(body.html || "");
    if (!html.trim()) {
      res.writeHead(400).end("html 内容为空");
      return;
    }
    const prev = readMeta(slug);
    const meta = {
      slug,
      title: String(body.title || "无标题"),
      tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
      date: String(body.date || new Date().toISOString().slice(0, 10)),
      publishedAt: prev?.publishedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(DATA_DIR, `${slug}.html`), html);
    fs.writeFileSync(path.join(DATA_DIR, `${slug}.json`), JSON.stringify(meta, null, 2));
    console.log(`[publish-server] ${prev ? "更新" : "发布"} /p/${slug} - ${meta.title}`);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ url: `/p/${slug}` }));
    return;
  }

  if (url.pathname === "/api/health") {
    res.writeHead(200).end("ok");
    return;
  }

  // 文章页
  const m = url.pathname.match(/^\/p\/([\w-]+)$/);
  if (m) {
    const slug = m[1];
    const meta = readMeta(slug);
    let html = "";
    try {
      html = fs.readFileSync(path.join(DATA_DIR, `${slug}.html`), "utf8");
    } catch {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page("404", `<article><h1 class="doc-title">没有这篇文章</h1><p>链接可能已失效。</p></article>`));
      return;
    }
    const tags = meta?.tags?.length
      ? `<span class="tags">${meta.tags.map((t) => `#${esc(t)}`).join(" ")}</span>`
      : "";
    const body =
      `<article><h1 class="doc-title">${esc(meta?.title || slug)}</h1>` +
      `<div class="doc-meta"><span>${esc(meta?.date || "")}</span>${tags}</div>` +
      `<div class="doc-body">${html}</div>` +
      `<footer>· 笔记 ·</footer></article>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page(meta?.title || slug, body));
    return;
  }

  // 目录页
  if (url.pathname === "/") {
    const items = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readMeta(f.replace(/\.json$/, "")))
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const list = items
      .map(
        (it) =>
          `<a class="index-item" href="/p/${esc(it.slug)}"><h2>${esc(it.title)}</h2>` +
          `<div class="meta">${esc(it.date)} ${it.tags.map((t) => "#" + esc(t)).join(" ")}</div></a>`
      )
      .join("\n");
    const body =
      `<article><h1 class="doc-title">笔记</h1><div class="doc-meta"><span>已发布 ${items.length} 篇</span></div>` +
      (list || "<p>还没有发布过文章。</p>") + `<footer>· 笔记 ·</footer></article>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page("笔记", body));
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[publish-server] http://0.0.0.0:${PORT}  (TOKEN ${TOKEN ? "已设置" : "未设置！"})`);
  console.log(`[publish-server] 数据目录: ${DATA_DIR}`);
});
