// 生成应用图标：纯 Node 画一个简洁的"纸+笔"图标，输出
//   src-tauri/icons/icon.png (512) 与 src-tauri/icons/icon.ico（内嵌 PNG）
// 无任何依赖：PNG 手工编码（zlib + CRC32），ICO 只是一个 6 字节头 + PNG。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "src-tauri", "icons");

// ---- 极简 PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 在 RGBA 画布上绘制，返回 PNG Buffer */
function renderPng(size, draw) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = a / 255;
    px[i] = Math.round(px[i] * (1 - na) + r * na);
    px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
    px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
    px[i + 3] = Math.max(px[i + 3], a);
  };
  draw(set, size);

  // 每行前加 filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 图案：暖纸底、圆角、一支斜放的笔 ----
const BG = [245, 242, 237];
const INK = [41, 37, 36];
const ACCENT = [180, 83, 9];

function draw(set, S) {
  const r = S * 0.18;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 圆角矩形底
      const cx = Math.min(Math.max(x, r), S - r);
      const cy = Math.min(Math.max(y, r), S - r);
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r - 0.5) set(x, y, ...BG);
      else if (d < r + 0.5) set(x, y, ...BG, Math.round((1 - (d - r + 0.5)) * 255));
    }
  }
  // 笔记本的几条横线
  const lines = [0.38, 0.5, 0.62, 0.74];
  for (const ly of lines) {
    for (let t = 0; t <= S * 0.34; t++) {
      const x = Math.round(S * 0.28 + t);
      const y = Math.round(S * ly);
      set(x, y, ...INK, 60);
      set(x, y + 1, ...INK, 25);
    }
  }
  // 一支斜放的笔（两段矩形旋转 -45° 的近似：逐点判断）
  const ang = -Math.PI / 4;
  const cx = S * 0.56, cy = S * 0.58;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - cx, dy = y - cy;
      // 旋转到笔的局部坐标
      const u = dx * Math.cos(-ang) - dy * Math.sin(-ang);
      const v = dx * Math.sin(-ang) + dy * Math.cos(-ang);
      const penLen = S * 0.44, penW = S * 0.075;
      if (u >= -penLen / 2 && u <= penLen / 2 && Math.abs(v) <= penW / 2) {
        // 笔尖（下端 18%）用墨色，笔杆用朱砂色
        const tip = u < -penLen / 2 + penLen * 0.18;
        const c = tip ? INK : ACCENT;
        set(x, y, ...c);
      }
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const png512 = renderPng(512, draw);
fs.writeFileSync(path.join(OUT, "icon.png"), png512);
fs.writeFileSync(path.join(OUT, "32x32.png"), renderPng(32, draw));
fs.writeFileSync(path.join(OUT, "128x128.png"), renderPng(128, draw));

// ICO：6 字节头 + 16 字节目录项 + 完整 PNG 数据
const ico = Buffer.concat([
  Buffer.from([0, 0, 1, 0, 1, 0]), // reserved, type=icon, count=1
  (() => {
    const e = Buffer.alloc(16);
    e[0] = 0; // 0 表示 256
    e[1] = 0;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png512.length, 8);
    e.writeUInt32LE(22, 12); // 数据偏移
    return e;
  })(),
  png512,
]);
fs.writeFileSync(path.join(OUT, "icon.ico"), ico);
console.log("icons written to", OUT);
