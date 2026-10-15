// 语音块应用服务（application 层）：录音编排、音频资源解析、共享播放器。
// 录音：getUserMedia → MediaRecorder(webm/opus) → 停止后落盘 attachments/（复用
// backend.saveAsset，webm 在其后缀白名单内）。波形与时长在停止时用 decodeAudioData
// 现算——webm 容器缺 duration header，AudioBuffer.duration 是准确值，一并取得。
import { backend } from "../backend";

export interface VoiceClip {
  path: string; // vault 相对路径（attachments/voice-*.webm）
  durationSec: number;
  peaks: number[]; // 0..1，已归一化
}

export interface AudioMeta {
  duration: number;
  peaks: number[];
}

/** 单个语音条的建议桶数（波形条数量） */
export const PEAK_BUCKETS = 48;

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 分桶峰值 → 归一化 0..1（全静音时避免除 0） */
function peaksOfChannel(data: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(data.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const end = Math.min((i + 1) * size, data.length);
    for (let j = i * size; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const norm = Math.max(...peaks, 0.01);
  return peaks.map((p) => Math.round((p / norm) * 100) / 100);
}

/** 解码 blob 取准确时长 + 波形（Chromium 能解 webm/opus；失败则抛错由调用方降级） */
async function decodeMeta(blob: Blob): Promise<AudioMeta> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return { duration: buf.duration, peaks: peaksOfChannel(buf.getChannelData(0), PEAK_BUCKETS) };
  } finally {
    void ctx.close();
  }
}

/** 实时电平采样重采样到固定桶数（decodeMeta 失败时的降级波形） */
function resampleLevels(levels: number[], buckets: number): number[] {
  const norm = Math.max(...levels, 0.01);
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const v = levels[Math.floor((i / buckets) * levels.length)] ?? 0;
    out.push(Math.min(1, Math.round((v / norm) * 100) / 100));
  }
  return out;
}

// ---------- 录音器 ----------

export type VoiceErr = "mic-denied" | "no-mic" | "unsupported" | "busy" | "generic";

export function explainVoiceErr(err: unknown): VoiceErr {
  if (err === "busy") return "busy";
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "mic-denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-mic";
  if (err instanceof Error && err.message.startsWith("voice:")) {
    const kind = err.message.slice(6);
    if (kind === "unsupported") return "unsupported";
  }
  return "generic";
}

/**
 * 一次录音会话。同一时刻全局只允许一个活动会话（后开会打拒绝 busy），
 * 避免两个块同时抢麦克风。
 */
export class VoiceRecorder {
  /** 当前活动会话（全局唯一；属性赋值而非变量别名，避免 this 逃逸分析的歧义） */
  private static active: VoiceRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = "";
  private startedAt = 0;
  private levelTimer = 0;
  private levels: number[] = []; // 100ms 一个实时电平（降级波形用）
  private level = 0;
  private ended = false;

  async start(): Promise<void> {
    // 全局单会话：正常流程旧的必然已 stop/cancel，这里兜的是组件树异常重建
    // 留下的幽灵会话（不回收会让后续录音永远 busy）
    const ghost = VoiceRecorder.active;
    if (ghost && !ghost.ended) ghost.cancel();
    this.mime = pickMime() ?? "";
    if (!this.mime) throw new Error("voice:unsupported");
    // 错误原样抛出：name 字段留给 explainVoiceErr 归类
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    VoiceRecorder.active = this;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.rec = new MediaRecorder(this.stream, { mimeType: this.mime });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(500);
    this.startedAt = performance.now();
    this.levelTimer = window.setInterval(() => {
      this.level = this.rms();
      this.levels.push(this.level);
    }, 100);
  }

  private rms(): number {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3); // 放大 3 倍让条子可见
  }

  /** 当前电平 0..1（UI 轮询） */
  getLevel(): number {
    return this.level;
  }

  /** 已录秒数 */
  elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** 停止并落盘；返回 vault 路径与元数据（同时写入元数据缓存） */
  async stop(): Promise<VoiceClip> {
    this.teardown();
    if (this.ended) throw new Error("voice:stopped");
    this.ended = true;
    const durationSec = Math.max(0.1, (performance.now() - this.startedAt) / 1000);
    const blob = new Blob(this.chunks, { type: this.mime });
    if (!blob.size) throw new Error("voice:empty");
    const [meta, base64] = await Promise.all([
      decodeMeta(blob).catch(() => ({
        duration: durationSec,
        peaks: resampleLevels(this.levels, PEAK_BUCKETS),
      })),
      blobToBase64(blob),
    ]);
    const ext = this.mime.includes("mp4") ? "mp4" : "webm";
    const { path } = await backend.saveAsset(`voice-${stamp()}.${ext}`, base64);
    metaCache.set(path, meta);
    return { path, durationSec: meta.duration, peaks: meta.peaks };
  }

  /** 丢弃录音（不落盘）；已停止的会话幂等 */
  cancel(): void {
    if (this.ended) return;
    this.ended = true;
    this.teardown();
  }

  private teardown(): void {
    window.clearInterval(this.levelTimer);
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* 已停止 */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    if (VoiceRecorder.active === this) VoiceRecorder.active = null;
  }
}

// ---------- 资源解析（vault 路径 → dataURL / 元数据，模块级缓存） ----------

const urlCache = new Map<string, string>(); // dataURL 体积大，封顶淘汰最旧
const URL_CACHE_MAX = 12;
const metaCache = new Map<string, AudioMeta>();

/** 音频 → dataURL（图片管线同款；失败返回 null 由调用方显示缺态） */
export async function audioUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit) {
    urlCache.delete(path);
    urlCache.set(path, hit); // 触碰置新
    return hit;
  }
  try {
    const { base64, mime } = await backend.readAssetBase64(path);
    const url = `data:${mime};base64,${base64}`;
    if (urlCache.size >= URL_CACHE_MAX) {
      const oldest = urlCache.keys().next().value;
      if (oldest !== undefined) urlCache.delete(oldest);
    }
    urlCache.set(path, url);
    return url;
  } catch {
    return null;
  }
}

/** 读取元数据：缓存 → 现算（decodeAudioData）。失败返回 null。 */
export async function audioMeta(path: string, url: string): Promise<AudioMeta | null> {
  const hit = metaCache.get(path);
  if (hit) return hit;
  try {
    const blob = await (await fetch(url)).blob();
    const meta = await decodeMeta(blob);
    metaCache.set(path, meta);
    return meta;
  } catch {
    return null;
  }
}

// ---------- 共享播放器（全局单实例：播 A 自动停 B） ----------

let sharedEl: HTMLAudioElement | null = null;

/** 停掉当前播放（无播放则空操作） */
export function stopSharedAudio(): void {
  if (!sharedEl) return;
  try {
    sharedEl.pause();
  } catch {
    /* 忽略 */
  }
  sharedEl = null;
}

/**
 * 独占播放：开始播 url，挤掉任何在播的。onTick 随 timeupdate 汇报进度，
 * onEnd 在自然结束/被挤掉/播放失败时回调。返回停止句柄。
 */
export function playSharedAudio(
  url: string,
  onTick: (t: number) => void,
  onEnd: () => void
): () => void {
  stopSharedAudio();
  const el = new Audio(url);
  sharedEl = el;
  let alive = true;
  const finish = () => {
    if (!alive) return;
    alive = false;
    if (sharedEl === el) sharedEl = null;
    onEnd();
  };
  el.addEventListener("timeupdate", () => {
    if (alive && sharedEl === el) onTick(el.currentTime);
  });
  el.addEventListener("ended", finish);
  el.addEventListener("pause", () => {
    // 用户点暂停或被挤掉（挤掉前 sharedEl 已换，走 finish 由新调用方负责）
    if (alive && sharedEl === el) {
      alive = false;
      sharedEl = null;
      onEnd();
    }
  });
  el.addEventListener("error", finish);
  el.play().catch(finish);
  return () => {
    if (!alive) return;
    alive = false;
    try {
      el.pause();
    } catch {
      /* 忽略 */
    }
    if (sharedEl === el) sharedEl = null;
  };
}

/** 拖动进度条 seek（秒） */
export function seekSharedAudio(t: number): void {
  if (sharedEl) sharedEl.currentTime = t;
}

/** 当前共享播放器是否在播（块重挂载后恢复 UI 用） */
export function sharedAudioPlaying(): boolean {
  return !!sharedEl && !sharedEl.paused;
}

export function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
