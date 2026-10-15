// 语音块：/语音 呼出 → 录音态（自动开麦）→ 停止落盘 attachments/ → 播放器。
// 双形态注册共用一个 NodeView：笔记 = 块级 AudioBlock（独占一行），
// 大纲 = 行内 InlineAudio（放在独立 item 里，圆点后整行即播放器）。
// 磁盘格式 ![[attachments/voice-*.webm]]，进出编辑器经 markdown.ts 伪装互转
// （与 HomeEmbed 的 noteshare-homeembed: 前缀同款方案，priority 高于 CustomImage）。
import { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import {
  VoiceRecorder,
  audioMeta,
  audioUrl,
  explainVoiceErr,
  fmtDur,
  playSharedAudio,
  seekSharedAudio,
  type AudioMeta,
  type VoiceErr,
} from "../application/voice-service";
import { AUDIO_PREFIX, safeDecode, stripAudioPrefix } from "../lib/markdown";
import { downloadDataUrl } from "../lib/download";
import { showContextMenu } from "./ContextMenu";
import { useSettings } from "../i18n";

const REC_START_DELAY = 120; // StrictMode 下 NodeView 会挂载两次，延迟启动躲开重挂载窗口

function audioSrcFromDOM(el: HTMLElement): string | null {
  const s = el.getAttribute("src") ?? "";
  if (!s) return null;
  return s.startsWith(AUDIO_PREFIX) ? safeDecode(s.slice(AUDIO_PREFIX.length)) : safeDecode(s);
}

function baseVoiceNode(name: string, extra: { inline?: boolean; group: string }) {
  return Node.create({
    name,
    group: extra.group,
    inline: !!extra.inline,
    atom: true,
    draggable: false,

    addAttributes() {
      return {
        src: {
          default: null,
          parseHTML: (el: HTMLElement) => audioSrcFromDOM(el),
        },
      };
    },

    parseHTML() {
      // audio[src]：导出 HTML / 富文本粘贴回环；img[伪装前缀]：markdown 管线。
      // priority 60 抢在 CustomImage 的通用 img 规则之前
      return [
        { tag: "audio[src][data-voice]", priority: 61 },
        { tag: `img[src^="${AUDIO_PREFIX}"]`, priority: 60 },
      ];
    },

    renderHTML({ node }) {
      // getHTML（导出/发布）直出原生 audio；inlineAssets 的 src="..." 替换对它同样生效
      return [
        "audio",
        mergeAttributes({ src: node.attrs.src ?? "", controls: "", "data-voice": "1" }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(AudioNodeView);
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: any, node: any) {
            const src = node.attrs.src as string | null;
            if (!src) {
              // 录音中/异常块不落任何内容
              if (!extra.inline) {
                state.ensureNewLine();
                state.closeBlock(node);
              }
              return;
            }
            // 前缀剥离：attrs 可能因异常路径带上伪装前缀，落盘必须干净
            state.write(`![[${stripAudioPrefix(src)}]]`);
            if (!extra.inline) state.closeBlock(node);
          },
          parse: {},
        },
      };
    },
  });
}

/** 笔记编辑器里的块级语音（独占一行） */
export const AudioBlock = baseVoiceNode("audioBlock", { group: "block" });

/** 大纲 item 内的行内语音 */
export const InlineAudio = baseVoiceNode("inlineAudio", { group: "inline", inline: true });

/** 大纲 /语音：在当前条目下方新建一个独立 item 专放语音（B 方案：块即条目） */
export function insertVoiceAfterCurrentItem(editor: Editor, range: Range): void {
  const $ = editor.state.doc.resolve(range.from);
  let d = $.depth;
  while (d > 0 && $.node(d).type.name !== "taskItem") d--;
  if (d === 0) {
    // 空文档散段（不在任何列表里）：行内插入兜底
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({ type: "inlineAudio", attrs: { src: null } })
      .run();
    return;
  }
  // deleteRange 发生在本条目内，条目末尾位置前移同样的字符数
  const delta = range.to - range.from;
  const insertAt = $.before(d) + $.node(d).nodeSize - delta;
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContentAt(insertAt, {
      type: "taskItem",
      attrs: { checked: false },
      content: [{ type: "paragraph", content: [{ type: "inlineAudio", attrs: { src: null } }] }],
    })
    .run();
}

// ---------------- NodeView ----------------

function AudioNodeView({ node, selected, deleteNode, updateAttributes }: NodeViewProps) {
  const { t } = useSettings();
  const src = (node.attrs.src as string | null) ?? null;
  const inline = node.type.name === "inlineAudio";

  // ---- 录音态 ----
  const [phase, setPhase] = useState<"arming" | "recording" | "saving" | "error">(
    src ? "error" : "arming" // src 存在时下面 ready 分支接管，phase 仅录音用
  );
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [errKind, setErrKind] = useState<VoiceErr | null>(null);
  const recRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  // 开麦并进入录音态（挂载 120ms 后与失败重试共用一条路径）
  const startRecording = () => {
    void (async () => {
      const rec = new VoiceRecorder();
      recRef.current = rec;
      try {
        await rec.start();
        setPhase("recording");
        tickRef.current = window.setInterval(() => {
          setElapsed(rec.elapsed());
          setLevel(rec.getLevel());
        }, 100);
      } catch (err) {
        setErrKind(explainVoiceErr(err));
        setPhase("error");
      }
    })();
  };

  useEffect(() => {
    if (src) return; // 播放器块不录音
    let dead = false;
    // 延迟启动：StrictMode 双挂载窗口内不真开麦
    timerRef.current = window.setTimeout(() => {
      if (!dead) startRecording();
    }, REC_START_DELAY);
    return () => {
      dead = true;
      window.clearTimeout(timerRef.current ?? undefined);
      window.clearInterval(tickRef.current ?? undefined);
      recRef.current?.cancel();
      recRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc 取消录音（录音态独占）
  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        recRef.current?.cancel();
        deleteNode();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, deleteNode]);

  const stopRecording = async () => {
    const rec = recRef.current;
    if (!rec) return;
    window.clearInterval(tickRef.current ?? undefined);
    setPhase("saving");
    try {
      const clip = await rec.stop();
      updateAttributes({ src: clip.path });
    } catch {
      setErrKind("generic");
      setPhase("error");
    } finally {
      if (recRef.current === rec) recRef.current = null;
    }
  };

  const cancelRecording = () => {
    window.clearTimeout(timerRef.current ?? undefined);
    window.clearInterval(tickRef.current ?? undefined);
    recRef.current?.cancel();
    deleteNode();
  };

  // ---- 播放器态 ----
  const [url, setUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<AudioMeta | null>(null);
  const [loadFail, setLoadFail] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const stopPlayRef = useRef<(() => void) | null>(null);
  const urlRef = useRef<string | null>(null);
  urlRef.current = url;

  useEffect(() => {
    if (!src) return;
    let dead = false;
    setUrl(null);
    setMeta(null);
    setLoadFail(false);
    stopPlayRef.current?.();
    stopPlayRef.current = null;
    setPlaying(false);
    setCur(0);
    (async () => {
      const u = await audioUrl(src);
      if (dead) return;
      setUrl(u);
      if (!u) {
        setLoadFail(true);
        return;
      }
      const m = await audioMeta(src, u);
      if (!dead) setMeta(m);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // 组件卸载时若还在播，停掉
  useEffect(
    () => () => {
      stopPlayRef.current?.();
    },
    []
  );

  const togglePlay = async () => {
    if (playing) {
      stopPlayRef.current?.();
      stopPlayRef.current = null;
      setPlaying(false);
      return;
    }
    const u = url ?? (src ? await audioUrl(src) : null);
    if (!u) {
      setLoadFail(true);
      return;
    }
    stopPlayRef.current = playSharedAudio(
      u,
      (t2) => setCur(t2),
      () => {
        stopPlayRef.current = null;
        setPlaying(false);
        setCur(0);
      }
    );
    setPlaying(true);
  };

  const seekWave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!meta || !url) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const t = ratio * meta.duration;
    if (!playing) void togglePlay();
    seekSharedAudio(t);
    setCur(t);
  };

  const fmt = (s: number) => fmtDur(s);

  // ---------------- 渲染 ----------------

  const wrapCls = `voice-block${inline ? " voice-inline" : ""}${selected ? " is-selected" : ""}`;

  if (!src) {
    // 录音 / 保存中 / 失败
    return (
      <NodeViewWrapper as={inline ? "span" : "div"} className={wrapCls} contentEditable={false}>
        {phase === "arming" && <span className="voice-arm">{t("voiceArming")}</span>}
        {phase === "recording" && (
          <span className="voice-rec">
            <span className="voice-dot" />
            <span className="voice-rec-label">{t("voiceRec")}</span>
            <span className="voice-rec-time">{fmt(elapsed)}</span>
            <span className="voice-live">
              {Array.from({ length: 12 }, (_, i) => {
                const on = level * 12 > i * (10 / 12) + 1;
                return <i key={i} className={on ? "on" : ""} />;
              })}
            </span>
            <button
              className="voice-stop-btn"
              onClick={(e) => {
                e.stopPropagation();
                void stopRecording();
              }}
              title={t("voiceStop")}
            >
              {t("voiceStop")}
            </button>
            <button
              className="voice-cancel-btn"
              onClick={(e) => {
                e.stopPropagation();
                cancelRecording();
              }}
              title={t("cancel")}
            >
              ✕
            </button>
          </span>
        )}
        {phase === "saving" && <span className="voice-arm">{t("voiceProcessing")}</span>}
        {phase === "error" && (
          <span className="voice-rec voice-error">
            <span className="voice-err-text">
              {t(
                errKind === "mic-denied"
                  ? "voiceMicDenied"
                  : errKind === "no-mic"
                    ? "voiceMicMissing"
                    : errKind === "unsupported"
                      ? "voiceUnsupported"
                      : "voiceRecFail"
              )}
            </span>
            <button
              className="voice-stop-btn"
              onClick={(e) => {
                e.stopPropagation();
                setPhase("arming");
                setErrKind(null);
                startRecording();
              }}
            >
              {t("voiceRetry")}
            </button>
            <button
              className="voice-cancel-btn"
              onClick={(e) => {
                e.stopPropagation();
                cancelRecording();
              }}
              title={t("cancel")}
            >
              ✕
            </button>
          </span>
        )}
      </NodeViewWrapper>
    );
  }

  // 播放器
  const peaks = meta?.peaks ?? Array.from({ length: 48 }, () => 0.25);
  const dur = meta?.duration ?? 0;
  const progress = dur > 0 ? Math.min(1, cur / dur) : 0;

  return (
    <NodeViewWrapper as={inline ? "span" : "div"} className={wrapCls} contentEditable={false}>
      <span
        className="voice-player"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          showContextMenu(e.clientX, e.clientY, [
            {
              label: t("voiceDownload"),
              disabled: !url,
              onClick: () => {
                if (url) void downloadDataUrl(src.split("/").pop() || "voice.webm", url);
              },
            },
            { separator: true },
            { label: t("voiceDelete"), danger: true, onClick: () => deleteNode() },
          ]);
        }}
      >
        <button
          className={`voice-play-btn${playing ? " is-playing" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            void togglePlay();
          }}
          disabled={loadFail}
          title={playing ? t("voicePause") : t("voicePlay")}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="voice-wave" onClick={seekWave} title={t("voiceSeek")}>
          {peaks.map((p, i) => (
            <i
              key={i}
              className={i / peaks.length < progress ? "played" : ""}
              style={{ height: `${Math.max(8, Math.round(p * 100))}%` }}
            />
          ))}
        </span>
        <span className="voice-time">
          {loadFail ? t("voiceLoadFail") : `${fmt(cur)} / ${meta ? fmt(dur) : "…"}`}
        </span>
      </span>
    </NodeViewWrapper>
  );
}

// 供只读管线（发布预览等）识别伪装 src
export function isVoiceSrc(src: string): boolean {
  return src.startsWith(AUDIO_PREFIX);
}
