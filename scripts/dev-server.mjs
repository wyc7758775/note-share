// 浏览器开发模式的"假 Tauri 后端"：
// 与 src-tauri/src/lib.rs 的命令一一对应，直接用 Node fs 操作 vault 文件夹。
// 正式桌面版走 Rust，本文件只用于 `npm run dev` 的开发与测试。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VAULT = path.resolve(process.env.VAULT_DIR || path.join(ROOT, "devvault"));
const PORT = Number(process.env.PORT || 8787);

const ASSET_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".excalidraw", ".mp4", ".webm", ".pdf",
]);
const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm",
  ".pdf": "application/pdf",
};

const toPosix = (p) => p.split(path.sep).join("/");

function resolveInside(rel) {
  if (!rel || rel.includes("..")) throw new Error("非法路径");
  const abs = path.resolve(VAULT, rel);
  if (abs !== VAULT && !abs.startsWith(VAULT + path.sep)) throw new Error("非法路径");
  return abs;
}

function uniqueAbs(abs) {
  if (!fs.existsSync(abs)) return abs;
  const dir = path.dirname(abs);
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  throw new Error("重名文件太多");
}

function buildTree(dir, rel) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const folders = [], notes = [], assets = [], others = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      folders.push({ name: e.name, path: childRel, kind: "folder", children: buildTree(path.join(dir, e.name), childRel) });
    } else {
      const ext = path.extname(e.name).toLowerCase();
      const node = { name: e.name, path: childRel, kind: ext === ".md" ? "note" : ASSET_EXTS.has(ext) ? "asset" : "other" };
      if (node.kind === "note") notes.push(node);
      else if (node.kind === "asset") assets.push(node);
      else others.push(node);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, "zh");
  folders.sort(byName); notes.sort(byName); assets.sort(byName); others.sort(byName);
  return [...folders, ...notes, ...assets, ...others];
}

function sanitizeName(name, { keepExt = true } = {}) {
  let n = String(name).replace(/[\\/:*?"<>|#^\[\]]/g, "").trim();
  if (!keepExt) n = n.replace(/\.(md)?$/i, "");
  return n;
}

function* walkNotes(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkNotes(path.join(dir, e.name), childRel);
    else if (e.name.toLowerCase().endsWith(".md")) yield { abs: path.join(dir, e.name), rel: childRel };
  }
}

const handlers = {
  "vault-name": async () => path.basename(VAULT),
  "tree": async () => buildTree(VAULT, ""),
  "note": async ({ path: rel }) => {
    const abs = resolveInside(rel);
    return { path: toPosix(rel), raw: fs.readFileSync(abs, "utf8") };
  },
  "note-save": async ({ path: rel, raw }) => {
    const abs = resolveInside(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, raw, "utf8");
  },
  "note-create": async ({ folder, title }) => {
    const name = `${sanitizeName(title, { keepExt: false }) || "未命名笔记"}.md`;
    const dir = folder ? resolveInside(folder) : VAULT;
    fs.mkdirSync(dir, { recursive: true });
    const abs = uniqueAbs(path.join(dir, name));
    const created = new Date().toISOString();
    fs.writeFileSync(
      abs,
      `---\ntags: []\ncreated: ${created}\nupdated: ${created}\n---\n\n`,
      "utf8"
    );
    return toPosix(path.relative(VAULT, abs));
  },
  "folder-create": async ({ parent, name }) => {
    const n = sanitizeName(name) || "新文件夹";
    const dir = parent ? resolveInside(parent) : VAULT;
    let abs = path.join(dir, n);
    for (let i = 2; fs.existsSync(abs); i++) abs = path.join(dir, `${n}-${i}`);
    fs.mkdirSync(abs, { recursive: true });
    return toPosix(path.relative(VAULT, abs));
  },
  // 把文件/笔记移动到指定文件夹（拖拽用）；撞名自动加序号
  "move": async ({ from, toFolder }) => {
    const abs = resolveInside(from);
    const destDir = toFolder ? resolveInside(toFolder) : VAULT;
    if (!fs.statSync(destDir).isDirectory()) throw new Error("目标不是文件夹");
    fs.mkdirSync(destDir, { recursive: true });
    const target = uniqueAbs(path.join(destDir, path.basename(abs)));
    fs.renameSync(abs, target);
    return toPosix(path.relative(VAULT, target));
  },
  "rename": async ({ from, newName }) => {
    const abs = resolveInside(from);
    const isNote = from.toLowerCase().endsWith(".md");
    let n = sanitizeName(newName, { keepExt: false });
    if (!n) throw new Error("名称不能为空");
    if (isNote) n += ".md";
    let target = path.join(path.dirname(abs), n);
    if (target !== abs && fs.existsSync(target)) {
      // 撞名时自动加序号（与新建一致），保证自动保存不中断
      const ext = path.extname(target);
      const stem = path.basename(target, ext);
      for (let i = 2; i < 1000; i++) {
        const cand = path.join(path.dirname(abs), `${stem}-${i}${ext}`);
        if (!fs.existsSync(cand)) {
          target = cand;
          break;
        }
      }
    }
    fs.renameSync(abs, target);
    return toPosix(path.relative(VAULT, target));
  },
  "delete": async ({ path: rel }) => {
    const abs = resolveInside(rel);
    const trash = path.join(VAULT, ".trash");
    fs.mkdirSync(trash, { recursive: true });
    const stamp = Date.now().toString(36);
    const target = path.join(trash, `${stamp}-${path.basename(abs)}`);
    fs.renameSync(abs, target);
  },
  "search": async ({ q }) => {
    const needle = q.toLowerCase();
    const hits = [];
    for (const { abs, rel } of walkNotes(VAULT, "")) {
      let text = "";
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const idx = text.toLowerCase().indexOf(needle);
      const title = path.basename(rel, ".md");
      if (idx === -1 && !title.toLowerCase().includes(needle)) continue;
      let snippet = "";
      if (idx !== -1) {
        snippet = text
          .slice(Math.max(0, idx - 40), idx + 60)
          .replace(/\s+/g, " ")
          .trim();
      }
      hits.push({ path: rel, title, snippet });
      if (hits.length >= 50) break;
    }
    return hits;
  },
  "scene": async ({ path: rel }) => {
    try {
      return fs.readFileSync(resolveInside(rel), "utf8");
    } catch {
      // 空画板（新建）或引用的文件已被删：返回空场景，进入后重画会保存回原路径自愈
      return JSON.stringify({ type: "excalidraw", version: 2, source: "noteshare", elements: [] });
    }
  },
  "scene-save": async ({ name, sceneJson, pngBase64 }) => {
    const dir = path.join(VAULT, "attachments");
    fs.mkdirSync(dir, { recursive: true });
    let sceneAbs;
    if (name) {
      sceneAbs = resolveInside(name.endsWith(".excalidraw") ? name : `${name}.excalidraw`);
    } else {
      sceneAbs = uniqueAbs(path.join(dir, `drawing-${Date.now().toString(36)}.excalidraw`));
    }
    fs.writeFileSync(sceneAbs, sceneJson, "utf8");
    let pngPath = null;
    if (pngBase64) {
      const pngAbs = sceneAbs.replace(/\.excalidraw$/, ".png");
      fs.writeFileSync(pngAbs, Buffer.from(pngBase64, "base64"));
      pngPath = toPosix(path.relative(VAULT, pngAbs));
    }
    return { scenePath: toPosix(path.relative(VAULT, sceneAbs)), pngPath };
  },
  "asset-save": async ({ name, base64 }) => {
    const dir = path.join(VAULT, "attachments");
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(name).toLowerCase();
    const base = sanitizeName(path.basename(name, ext)).slice(0, 40) || "asset";
    const abs = uniqueAbs(path.join(dir, base + (ASSET_EXTS.has(ext) ? ext : ".png")));
    fs.writeFileSync(abs, Buffer.from(base64, "base64"));
    return { path: toPosix(path.relative(VAULT, abs)) };
  },
  "asset": async ({ path: rel }) => {
    const abs = resolveInside(rel);
    const ext = path.extname(abs).toLowerCase();
    return {
      base64: fs.readFileSync(abs).toString("base64"),
      mime: MIME[ext] || "application/octet-stream",
    };
  },
  "health": async () => "ok",
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  const url = new URL(req.url, "http://x");
  const key = url.pathname.replace(/^\/api\//, "");
  const handler = handlers[key];
  if (!handler) {
    res.writeHead(404).end(JSON.stringify({ error: "unknown api" }));
    return;
  }
  try {
    let args = null;
    if (req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    } else {
      args = Object.fromEntries(url.searchParams);
    }
    const result = await handler(args || {});
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(result ?? null));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-server] vault = ${VAULT}`);
  console.log(`[dev-server] http://127.0.0.1:${PORT}/api/health`);
});
