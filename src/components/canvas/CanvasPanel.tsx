// 白板面板（Obsidian 式 Canvas）：以标签页形态渲染在栏内。
// 落盘为 Obsidian 兼容的 .canvas JSON（nodes/edges），可直接在 Obsidian 打开编辑。
// 卡片三类：
//   note  = file 卡片：笔记正文 markdown 只读渲染，卡内滚动（nowheel），双链可点
//   image = file 卡片：vault 图片（可从本地上传），contain 展示
//   text  = 文本卡片：双击就地编辑（markdown 渲染）
// 交互：拖动移动、选中后四边缩放、四向连接点拖出箭头连线（Loose 模式任意互连）、
// 双击连线改标签、Delete/Backspace 删除选中、空白拖拽平移、滚轮缩放、Esc 逐级退出。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  NodeResizer,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useNodesState,
  useEdgesState,
  useStoreApi,
  addEdge,
  reconnectEdge,
  ConnectionMode,
  MarkerType,
} from "@xyflow/react";
import type {
  Connection,
  Edge,
  EdgeChange,
  EdgeProps,
  Node,
  NodeChange,
  NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { backend } from "../../backend";
import { useSettings } from "../../i18n";
import { useDomain, useDirectoryVersion } from "../../domain/provider";
import { parseNote } from "../../lib/frontmatter";
import { renderCardMarkdown, hydrateCardImages } from "../../lib/mdRender";
import { emitOpenNote } from "../WikiLink";
import ImageViewer from "../ImageViewer";
import { I } from "../icons";

type SaveState = "saved" | "saving" | "error";
type Side = "top" | "right" | "bottom" | "left";

interface Props {
  src: string;
  /** 是否为活动标签（标签常驻后多个白板同时挂载，Esc 只响应活动者） */
  active: boolean;
  /** 关闭当前标签（Esc / 兜底保存后调用） */
  onClose: () => void;
}

/** 色块完整样式（Excalidraw 属性面板对应项；color 兼容旧 "1"-"6" 键） */
type CvData = {
  file?: string;
  text?: string;
  editing?: boolean;
  /** 色块身份 = color 存在；值可为 hex 或 "transparent" */
  color?: string;
  /** 边框颜色（无则不描边） */
  stroke?: string;
  /** 1 细 / 2 中 / 4 粗 */
  strokeW?: number;
  /** solid | dashed | dotted */
  strokeStyle?: string;
  /** solid | hachure | cross */
  fill?: string;
  /** round | sharp */
  edges?: string;
  /** 0-100 */
  opacity?: number;
  /** 字号档位 0-3 */
  fsize?: number;
};
type CvNode = Node<CvData>;
type CardKind = "note" | "image" | "text" | "block";

/** 面板级上下文：白板文件所在文件夹（卡片里"点击创建缺失笔记"时新建到同目录）、
 *  touch = 触发防抖保存（节点组件里 rf.updateNodeData / setNodes 不走 onNodesChange）、
 *  setNodes = useNodesState 的状态 setter（受控模式下 rf.setNodes 会被 props 覆盖，图层换序必须走这里） */
const CvCtx = createContext<{
  folder: string;
  touch: () => void;
  setNodes: (updater: (ns: CvNode[]) => CvNode[]) => void;
}>({ folder: "", touch: () => {}, setNodes: () => {} });

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
/** 文件树拖拽的 dataTransfer 类型（与 FileTree 约定） */
const TREE_MIME = "application/x-noteshare-tree";
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 };
const SIZES = {
  note: { w: 400, h: 340 },
  image: { w: 360, h: 280 },
  text: { w: 300, h: 180 },
  block: { w: 240, h: 88 },
};

/** 色块调色板：Excalidraw 同款圆点序列（末尾彩虹圆 = 任意取色） */
const BLOCK_PALETTE = [
  "#1e1e1e",
  "#a5a5a5",
  "#e03131",
  "#e8590c",
  "#f08c00",
  "#2f9e44",
  "#0c8599",
  "#1971c2",
  "#9c36b5",
  "#e64980",
];
/** 旧版 1-6 键 → 新 hex（历史文件兼容） */
const LEGACY_BLOCK_COLORS: Record<string, string> = {
  "1": "#e03131",
  "2": "#e8590c",
  "3": "#f08c00",
  "4": "#2f9e44",
  "5": "#0c8599",
  "6": "#1971c2",
};
const normalizeBlockColor = (c: string) =>
  c === "transparent"
    ? c
    : LEGACY_BLOCK_COLORS[c] ?? (/^#[0-9a-f]{6}$/i.test(c) ? c : "#2f9e44");

/** hex → 带透明度的 rgb() */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)} / ${a})`;
}

/** 色块背景：实心 / 斜线阴影 / 交叉阴影（Excalidraw 填充样式；线条铺在浅色底上） */
function blockBg(c: string, fill: string): string {
  if (c === "transparent") return "transparent";
  const hatch = `repeating-linear-gradient(45deg, ${c} 0 2px, transparent 2px 9px)`;
  const tint = `linear-gradient(${hexA(c, 0.13)}, ${hexA(c, 0.13)})`;
  if (fill === "hachure") return `${hatch}, ${tint}`;
  if (fill === "cross")
    return `${hatch}, repeating-linear-gradient(-45deg, ${c} 0 2px, transparent 2px 9px), ${tint}`;
  return c;
}

/** 字号档位（S/M/L/XL），默认档 1 = 15px 与纯文本卡一致 */
const FSIZE = [13, 15, 18, 24];

/** 按背景亮度选正文色（亮底深字 / 暗底白字；透明底走继承色） */
function textOn(bg: string): string {
  if (bg === "transparent") return "";
  const hex = bg.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1c1917" : "#ffffff";
}

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// ---------- .canvas JSON ↔ React Flow 映射 ----------

interface CanvasFile {
  nodes: Array<{
    id: string;
    type?: string;
    file?: string;
    text?: string;
    color?: string;
    stroke?: string;
    strokeW?: number;
    strokeStyle?: string;
    fill?: string;
    edges?: string;
    opacity?: number;
    fsize?: number;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }>;
  edges?: Array<{
    id?: string;
    fromNode: string;
    toNode: string;
    fromSide?: Side;
    toSide?: Side;
    label?: string;
    fromEnd?: string;
    toEnd?: string;
  }>;
}

function fromCanvasJson(raw: string): { nodes: CvNode[]; edges: Edge[] } | null {
  let data: CanvasFile;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.nodes)) return null;
  const nodes: CvNode[] = [];
  for (const n of data.nodes) {
    if (!n || typeof n.id !== "string" || !n.id) continue;
    const pos = { x: n.x ?? 0, y: n.y ?? 0 };
    if (n.type === "text") {
      const hasColor = typeof n.color === "string" && !!n.color;
      const size = hasColor ? SIZES.block : SIZES.text;
      nodes.push({
        id: n.id,
        type: "text",
        position: pos,
        width: n.width ?? size.w,
        height: n.height ?? size.h,
        data: {
          text: typeof n.text === "string" ? n.text : "",
          ...(hasColor
            ? {
                color: normalizeBlockColor(n.color!),
                ...(n.stroke && /^#[0-9a-f]{6}$/i.test(n.stroke) ? { stroke: n.stroke } : {}),
                ...([1, 2, 4].includes(n.strokeW!) ? { strokeW: n.strokeW } : {}),
                ...(n.strokeStyle === "dashed" || n.strokeStyle === "dotted" ? { strokeStyle: n.strokeStyle } : {}),
                ...(n.fill === "hachure" || n.fill === "cross" ? { fill: n.fill } : {}),
                ...(n.edges === "sharp" ? { edges: "sharp" } : {}),
                ...(typeof n.opacity === "number" && n.opacity >= 0 && n.opacity < 100
                  ? { opacity: Math.round(n.opacity) }
                  : {}),
                ...([0, 1, 2, 3].includes(n.fsize!) && n.fsize !== 1 ? { fsize: n.fsize } : {}),
              }
            : {}),
        },
      });
    } else if (typeof n.file === "string" && n.file) {
      const kind = IMG_RE.test(n.file) ? "image" : "note";
      nodes.push({
        id: n.id,
        type: kind,
        position: pos,
        width: n.width ?? SIZES[kind].w,
        height: n.height ?? SIZES[kind].h,
        data: { file: n.file },
      });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = [];
  for (const e of data.edges ?? []) {
    if (!e || !ids.has(e.fromNode) || !ids.has(e.toNode)) continue;
    edges.push({
      id: typeof e.id === "string" && e.id ? e.id : newId(),
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: e.fromSide ?? "right",
      targetHandle: e.toSide ?? "left",
      type: "cv",
      ...(e.label ? { label: String(e.label) } : {}),
      ...(e.fromEnd === "arrow" ? { markerStart: ARROW } : {}),
      ...(e.toEnd === "none" ? {} : { markerEnd: ARROW }),
    });
  }
  return { nodes, edges };
}

function toCanvasJson(nodes: CvNode[], edges: Edge[]): string {
  return JSON.stringify({
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type === "text" ? "text" : "file",
      ...(n.type === "text"
        ? {
            text: String(n.data?.text ?? ""),
            ...(n.data?.color ? { color: String(n.data.color) } : {}),
            ...(n.data?.stroke ? { stroke: String(n.data.stroke) } : {}),
            ...(n.data?.strokeW && n.data.strokeW !== 2 ? { strokeW: n.data.strokeW } : {}),
            ...(n.data?.strokeStyle && n.data.strokeStyle !== "solid"
              ? { strokeStyle: n.data.strokeStyle }
              : {}),
            ...(n.data?.fill && n.data.fill !== "solid" ? { fill: n.data.fill } : {}),
            ...(n.data?.edges && n.data.edges !== "round" ? { edges: n.data.edges } : {}),
            ...(typeof n.data?.opacity === "number" && n.data.opacity !== 100
              ? { opacity: n.data.opacity }
              : {}),
            ...(typeof n.data?.fsize === "number" && n.data.fsize !== 1 ? { fsize: n.data.fsize } : {}),
          }
        : { file: String(n.data?.file ?? "") }),
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.measured?.width ?? 0),
      height: Math.round(n.height ?? n.measured?.height ?? 0),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      fromNode: e.source,
      fromSide: (e.sourceHandle as Side) ?? "right",
      toNode: e.target,
      toSide: (e.targetHandle as Side) ?? "left",
      ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
      ...(e.markerStart ? { fromEnd: "arrow" } : {}),
      ...(e.markerEnd ? { toEnd: "arrow" } : {}),
    })),
  });
}

// ---------- 卡片内链接点击（双链跳转/缺失创建/外链新窗） ----------

function useCardLinkClick() {
  const { directory, notes } = useDomain();
  const { folder } = useContext(CvCtx);
  return (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.("a");
    if (!a) return;
    const ctrl = e.ctrlKey || e.metaKey;
    // 点击语义与画板内链接一致：默认当前栏新标签（保留白板），Ctrl 新栏
    const opts = { newTab: !ctrl, newPane: ctrl };
    const name = a.getAttribute("data-cv-name");
    if (name) {
      e.preventDefault();
      e.stopPropagation();
      const hit = directory.resolve(name);
      if (hit.kind === "resolved") {
        emitOpenNote(hit.path, opts);
        return;
      }
      void notes.create(name, folder).then((p) => {
        if (p) emitOpenNote(p, opts);
      });
      return;
    }
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.open(href, "_blank");
    }
  };
}

/** 四向连接点（Loose 模式：任一点既可拖出也可落入） */
function CvHandles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="top" className="cv-handle" />
      <Handle type="source" position={Position.Right} id="right" className="cv-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="cv-handle" />
      <Handle type="source" position={Position.Left} id="left" className="cv-handle" />
    </>
  );
}

/** 卡片正容器：html 挂载后异步把 vault 图片占位换成 dataURL */
function CardBody({
  html,
  onContentClick,
  children,
}: {
  html: string | null;
  onContentClick: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (html && ref.current) void hydrateCardImages(ref.current);
  }, [html]);
  return (
    <div ref={ref} className="cv-card-body nowheel cv-md" onClick={onContentClick}>
      {children}
      {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

// ---------- 笔记卡片 ----------

function NoteCard(props: NodeProps) {
  const { id, data, selected } = props;
  const file = String((data as CvData)?.file ?? "");
  const { t } = useSettings();
  const rf = useReactFlow();
  const onContentClick = useCardLinkClick();
  const [html, setHtml] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let dead = false;
    setHtml(null);
    void (async () => {
      try {
        const { raw } = await backend.readNote(file);
        if (dead) return;
        const { body } = parseNote(raw);
        setHtml(renderCardMarkdown(body));
      } catch {
        if (!dead) setHtml("");
      }
    })();
    return () => {
      dead = true;
    };
  }, [file, rev]);

  const name = file.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  const openNote = (e: React.MouseEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    emitOpenNote(file, { newTab: !ctrl, newPane: ctrl });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={120} />
      <CvHandles />
      <div className="cv-card">
        <div className="cv-card-head nodrag" onClick={openNote} title={t("wbOpenNote")}>
          <span className="cv-card-ico">{I.note}</span>
          <span className="cv-card-title">{name}</span>
          <span className="cv-card-acts nodrag">
            <button className="cv-act" data-tip={t("wbOpenNote")} onClick={openNote} onPointerDown={stop}>
              ↗
            </button>
            <button
              className="cv-act"
              data-tip={t("wbRefreshCard")}
              onClick={() => setRev((v) => v + 1)}
              onPointerDown={stop}
            >
              ⟳
            </button>
            <button
              className="cv-act cv-act-danger"
              data-tip={t("delete")}
              onClick={() => void rf.deleteElements({ nodes: [{ id }] })}
              onPointerDown={stop}
            >
              ✕
            </button>
          </span>
        </div>
        <CardBody html={html} onContentClick={onContentClick}>
          {html === null && <span className="cv-hint">…</span>}
          {html === "" && <span className="cv-hint">{t("wbFileMissing")}</span>}
        </CardBody>
      </div>
    </>
  );
}

// ---------- 图片卡片 ----------

function ImageCard(props: NodeProps) {
  const { id, data, selected } = props;
  const file = String((data as CvData)?.file ?? "");
  const { t } = useSettings();
  const rf = useReactFlow();
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [viewer, setViewer] = useState(false);

  useEffect(() => {
    let dead = false;
    setUrl(null);
    setMissing(false);
    void (async () => {
      try {
        const { base64, mime } = await backend.readAssetBase64(file);
        if (!dead) setUrl(`data:${mime};base64,${base64}`);
      } catch {
        if (!dead) setMissing(true);
      }
    })();
    return () => {
      dead = true;
    };
  }, [file]);

  const name = file.split("/").pop() ?? "";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={90} />
      <CvHandles />
      <div className="cv-card cv-card-image">
        <div className="cv-img-box nowheel nodrag" onDoubleClick={() => url && setViewer(true)}>
          {url ? (
            <img src={url} alt={name} draggable={false} />
          ) : (
            <span className="cv-hint">{missing ? t("wbFileMissing") : "…"}</span>
          )}
        </div>
        <div className="cv-card-foot" title={file}>
          <span className="cv-card-ico">{I.image}</span>
          <span className="cv-card-title">{name}</span>
          <span className="cv-card-acts nodrag">
            <button
              className="cv-act cv-act-danger"
              data-tip={t("delete")}
              onClick={() => void rf.deleteElements({ nodes: [{ id }] })}
              onPointerDown={stop}
            >
              ✕
            </button>
          </span>
        </div>
      </div>
      {viewer && url && (
        <ImageViewer images={[{ src: url, name }]} index={0} onClose={() => setViewer(false)} />
      )}
    </>
  );
}

// ---------- 文本卡片：纯文字直输（无 markdown 渲染）+ 色块变体（居中白字可换色） ----------

function TextCard(props: NodeProps) {
  const { id, data, selected } = props;
  const d = (data ?? {}) as CvData;
  const text = String(d.text ?? "");
  const color = d.color ? String(d.color) : null;
  const { t } = useSettings();
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  const [propBelow, setPropBelow] = useState(false);

  // 创建即编辑（addCard 置 editing 标记，提交后清掉避免重开又进编辑）
  useEffect(() => {
    if (d.editing) setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(text);
    setEditing(true);
  };
  const { touch } = useContext(CvCtx);
  const commit = () => {
    setEditing(false);
    if (draft !== text || d.editing) {
      rf.updateNodeData(id, d.editing ? { text: draft, editing: false } : { text: draft });
      touch();
    }
  };

  // ---- 色块：可调样式方块 + 居中文字（点击选中呼出 Excalidraw 式属性面板） ----
  if (color) {
    const fg = textOn(color) || undefined;
    const fs = FSIZE[d.fsize ?? 1];
    return (
      <>
        <NodeResizer isVisible={selected} minWidth={120} minHeight={56} />
        <CvHandles />
        {/* host 承载选中描边与属性面板；opacity 只作用于块身，免得面板跟着变虚。
            属性面板默认浮在块上方，上方空间不足（块贴近画布顶）时翻到下方 */}
        <div
          className="cv-block-host"
          ref={hostRef}
          onPointerEnter={() => {
            const r = hostRef.current?.getBoundingClientRect();
            if (r) setPropBelow(r.top < 378);
          }}
        >
          <div
            className="cv-block"
            style={{
              background: blockBg(color, d.fill ?? "solid"),
              ...(fg ? { color: fg } : {}),
              ...(d.stroke ? { border: `${d.strokeW ?? 2}px ${d.strokeStyle ?? "solid"} ${d.stroke}` } : {}),
              borderRadius: d.edges === "sharp" ? 3 : 22,
              ...(typeof d.opacity === "number" && d.opacity < 100 ? { opacity: d.opacity / 100 } : {}),
            }}
          >
            {editing ? (
              <textarea
                autoFocus
                className="cv-block-input nowheel nodrag nopan"
                style={{ background: "rgb(0 0 0 / 0.12)", fontSize: fs }}
                value={draft}
                placeholder={t("wbBlockPh")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    (e.target as HTMLElement).blur();
                  }
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : text ? (
              <div className="cv-block-text nowheel" style={{ fontSize: fs }} onDoubleClick={startEdit}>
                {text}
              </div>
            ) : (
              <button
                className="cv-block-empty nodrag"
                onClick={startEdit}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {t("wbTextEmpty")}
              </button>
            )}
          </div>
          <BlockPanel id={id} d={d} below={propBelow} />
        </div>
      </>
    );
  }

  // ---- 纯文本卡：所见即所得纯文字 ----
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={80} />
      <CvHandles />
      <div className="cv-card">
        {editing ? (
          <textarea
            autoFocus
            className="cv-textarea nowheel nodrag nopan"
            value={draft}
            placeholder={t("wbTextPh")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                (e.target as HTMLElement).blur();
              }
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="cv-card-body nowheel cv-plain" onDoubleClick={startEdit}>
            {text || (
              <button
                className="cv-text-empty nodrag"
                onClick={startEdit}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {t("wbTextEmpty")}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ---------- 色块属性面板（Excalidraw 式：背景/边框色板 + 分段图标组 + 不透明度 + 图层/操作） ----------

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="cv-prop-row">
      <span className="cv-prop-label">{label}</span>
      <div className="cv-prop-ctl">{children}</div>
    </div>
  );
}

/** 面板小图标（16px，currentColor 随选中态着色） */
function SegIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden>
      {children}
    </svg>
  );
}

function BlockPanel({ id, d, below }: { id: string; d: CvData; below?: boolean }) {
  const { t } = useSettings();
  const rf = useReactFlow();
  const { touch, setNodes } = useContext(CvCtx);
  const color = d.color ?? "#2f9e44";
  const stroke = d.stroke ?? "";
  const strokeW = d.strokeW ?? 2;
  const strokeStyle = d.strokeStyle ?? "solid";
  const fill = d.fill ?? "solid";
  const edges = d.edges ?? "round";
  const opacity = typeof d.opacity === "number" ? d.opacity : 100;
  const fsize = d.fsize ?? 1;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const set = (patch: Partial<CvData>) => {
    rf.updateNodeData(id, patch);
    touch();
  };

  // 图层 = nodes 数组顺序（渲染 z 序），置前移尾、置后移头
  const reorder = (front: boolean) => {
    setNodes((ns) => {
      const i = ns.findIndex((n) => n.id === id);
      if (i < 0) return ns;
      const cp = ns.slice();
      const [x] = cp.splice(i, 1);
      return front ? [...cp, x] : [x, ...cp];
    });
    touch();
  };
  const dup = () => {
    const src = rf.getNode(id);
    if (!src) return;
    rf.addNodes([
      {
        ...src,
        id: newId(),
        selected: false,
        position: { x: src.position.x + 26, y: src.position.y + 26 },
        data: { ...src.data },
      },
    ]);
    touch();
  };

  return (
    <div className={`cv-prop nowheel nodrag nopan ${below ? "cv-prop-below" : ""}`} onPointerDown={stop} onDoubleClick={stop}>
      {/* 背景 */}
      <PropRow label={t("wbBg")}>
        <button
          className={`cv-swatch cv-swatch-none ${color === "transparent" ? "cv-swatch-on" : ""}`}
          title={t("wbTransparent")}
          onClick={() => set({ color: "transparent" })}
        />
        {BLOCK_PALETTE.map((c) => (
          <button
            key={c}
            className={`cv-swatch ${c === color ? "cv-swatch-on" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => set({ color: c })}
          />
        ))}
        <label className="cv-swatch cv-swatch-rainbow" title={t("wbBlockCustom")}>
          <input
            type="color"
            className="cv-color-input"
            value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#2f9e44"}
            onChange={(e) => set({ color: e.target.value })}
          />
        </label>
      </PropRow>
      {/* 边框 */}
      <PropRow label={t("wbStroke")}>
        <button
          className={`cv-swatch cv-swatch-slash ${!stroke ? "cv-swatch-on" : ""}`}
          title={t("wbStrokeNone")}
          onClick={() => set({ stroke: undefined })}
        />
        {BLOCK_PALETTE.map((c) => (
          <button
            key={c}
            className={`cv-swatch ${stroke === c ? "cv-swatch-on" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => set({ stroke: c })}
          />
        ))}
        <label className="cv-swatch cv-swatch-rainbow" title={t("wbBlockCustom")}>
          <input
            type="color"
            className="cv-color-input"
            value={/^#[0-9a-f]{6}$/i.test(stroke) ? stroke : "#1e1e1e"}
            onChange={(e) => set({ stroke: e.target.value })}
          />
        </label>
      </PropRow>
      {/* 边框宽度 */}
      <PropRow label={t("wbStrokeW")}>
        {([1, 2, 4] as const).map((w, i) => (
          <button
            key={w}
            className={`cv-seg-btn ${strokeW === w ? "on" : ""}`}
            title={t(i === 0 ? "wbThin" : i === 1 ? "wbMedium" : "wbThick")}
            onClick={() => set({ strokeW: w })}
          >
            <SegIcon>
              <line x1="2.5" y1="8" x2="13.5" y2="8" strokeWidth={w} strokeLinecap="round" />
            </SegIcon>
          </button>
        ))}
      </PropRow>
      {/* 边框样式 */}
      <PropRow label={t("wbStrokeStyle")}>
        <button
          className={`cv-seg-btn ${strokeStyle === "solid" ? "on" : ""}`}
          title={t("wbSolid")}
          onClick={() => set({ strokeStyle: "solid" })}
        >
          <SegIcon>
            <line x1="2.5" y1="8" x2="13.5" y2="8" strokeWidth="2" strokeLinecap="round" />
          </SegIcon>
        </button>
        <button
          className={`cv-seg-btn ${strokeStyle === "dashed" ? "on" : ""}`}
          title={t("wbDashed")}
          onClick={() => set({ strokeStyle: "dashed" })}
        >
          <SegIcon>
            <line x1="2.5" y1="8" x2="13.5" y2="8" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2.4" />
          </SegIcon>
        </button>
        <button
          className={`cv-seg-btn ${strokeStyle === "dotted" ? "on" : ""}`}
          title={t("wbDotted")}
          onClick={() => set({ strokeStyle: "dotted" })}
        >
          <SegIcon>
            <line x1="3" y1="8" x2="13" y2="8" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.1 3.4" />
          </SegIcon>
        </button>
      </PropRow>
      {/* 填充样式 */}
      <PropRow label={t("wbFill")}>
        <button
          className={`cv-seg-btn ${fill === "solid" ? "on" : ""}`}
          title={t("wbFillSolid")}
          onClick={() => set({ fill: "solid" })}
        >
          <SegIcon>
            <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
          </SegIcon>
        </button>
        <button
          className={`cv-seg-btn ${fill === "hachure" ? "on" : ""}`}
          title={t("wbHachure")}
          onClick={() => set({ fill: "hachure" })}
        >
          <SegIcon>
            <rect x="3" y="3" width="10" height="10" rx="2" />
            <path d="M3 11 L11 3 M5.5 13 L13 5.5" strokeWidth="1.3" />
          </SegIcon>
        </button>
        <button
          className={`cv-seg-btn ${fill === "cross" ? "on" : ""}`}
          title={t("wbCross")}
          onClick={() => set({ fill: "cross" })}
        >
          <SegIcon>
            <rect x="3" y="3" width="10" height="10" rx="2" />
            <path d="M3 11 L11 3 M5.5 13 L13 5.5 M3 5.5 L5.5 3 M8 13 L13 8" strokeWidth="1.2" />
          </SegIcon>
        </button>
      </PropRow>
      {/* 边角 */}
      <PropRow label={t("wbEdges")}>
        <button
          className={`cv-seg-btn ${edges === "round" ? "on" : ""}`}
          title={t("wbRound")}
          onClick={() => set({ edges: "round" })}
        >
          <SegIcon>
            <rect x="3" y="4.5" width="10" height="7" rx="3.5" />
          </SegIcon>
        </button>
        <button
          className={`cv-seg-btn ${edges === "sharp" ? "on" : ""}`}
          title={t("wbSharp")}
          onClick={() => set({ edges: "sharp" })}
        >
          <SegIcon>
            <rect x="3.5" y="4.5" width="9" height="7" rx="0.5" />
          </SegIcon>
        </button>
      </PropRow>
      {/* 不透明度 */}
      <PropRow label={t("wbOpacity")}>
        <input
          type="range"
          className="cv-range"
          min={0}
          max={100}
          step={5}
          value={opacity}
          onChange={(e) => set({ opacity: Number(e.target.value) })}
          onPointerDown={stop}
        />
        <span className="cv-range-val">{opacity}%</span>
      </PropRow>
      {/* 字号 */}
      <PropRow label={t("wbFontSize")}>
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            className={`cv-seg-btn cv-seg-wide ${fsize === i ? "on" : ""}`}
            title={`${FSIZE[i]}px`}
            onClick={() => set({ fsize: i })}
          >
            {["S", "M", "L", "XL"][i]}
          </button>
        ))}
      </PropRow>
      {/* 图层 */}
      <PropRow label={t("wbLayers")}>
        <button className="cv-txt-btn" onClick={() => reorder(true)}>
          <SegIcon>
            <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
            <rect x="2.5" y="2.5" width="8" height="8" rx="2" fill="currentColor" />
          </SegIcon>
          {t("wbToFront")}
        </button>
        <button className="cv-txt-btn" onClick={() => reorder(false)}>
          <SegIcon>
            <rect x="5.5" y="5.5" width="8" height="8" rx="2" fill="currentColor" />
            <rect x="2.5" y="2.5" width="8" height="8" rx="2" />
          </SegIcon>
          {t("wbToBack")}
        </button>
      </PropRow>
      {/* 操作 */}
      <PropRow label={t("wbActions")}>
        <button className="cv-txt-btn" onClick={dup}>
          <SegIcon>
            <rect x="5" y="5" width="8.5" height="8.5" rx="2" />
            <rect x="2.5" y="2.5" width="8.5" height="8.5" rx="2" />
          </SegIcon>
          {t("wbDuplicate")}
        </button>
        <button
          className="cv-txt-btn cv-txt-danger"
          onClick={() => void rf.deleteElements({ nodes: [{ id }] })}
        >
          <SegIcon>
            <path d="M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l0.7 8h5.6l0.7-8" strokeLinecap="round" />
          </SegIcon>
          {t("wbDeleteShort")}
        </button>
      </PropRow>
    </div>
  );
}

// ---------- 连线（贝塞尔 + 标签） ----------

function CanvasEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerStart, markerEnd } =
    props;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.3,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={16} />
      {label ? (
        <EdgeLabelRenderer>
          <div className="cv-edge-label" style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}>
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { note: NoteCard, image: ImageCard, text: TextCard };
const edgeTypes = { cv: CanvasEdge };

// ---------- 插入选择器 ----------

/** 搜笔记：无结果（或无完全同名）时给"直接创建"行 */
function NotePicker({
  folder,
  onPick,
  onClose,
}: {
  folder: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const { directory, notes } = useDomain();
  useDirectoryVersion();
  const [q, setQ] = useState("");
  const query = q.trim();
  const lower = query.toLowerCase();
  const all = directory.all();
  const hits = (
    query
      ? all.filter((n) => n.name.toLowerCase().includes(lower) || n.path.toLowerCase().includes(lower))
      : all
  ).slice(0, 8);
  const exact = hits.some((n) => n.name.toLowerCase() === lower);
  const canCreate = query.length > 0 && !exact;

  const create = async () => {
    const path = await notes.create(query, folder);
    if (path) onPick(path);
  };

  return (
    <div className="cv-picker">
      <input
        autoFocus
        className="cv-picker-input"
        placeholder={t("pickNotePh")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (hits[0]) onPick(hits[0].path);
            else if (canCreate) void create();
          }
          if (e.key === "Escape") onClose();
          e.stopPropagation();
        }}
      />
      <div className="cv-picker-list">
        {canCreate && (
          <button
            className="slash-item"
            onMouseDown={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <span className="slash-icon">＋</span>
            <span className="slash-text">
              <span className="slash-title">{t("wbCreateNote", { name: query })}</span>
              <span className="slash-desc">{folder || "/"}</span>
            </span>
          </button>
        )}
        {hits.map((n) => (
          <button
            key={n.path}
            className="slash-item"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(n.path);
            }}
          >
            <span className="slash-icon">📄</span>
            <span className="slash-text">
              <span className="slash-title">{n.name}</span>
              <span className="slash-desc">{n.path}</span>
            </span>
          </button>
        ))}
        {!canCreate && hits.length === 0 && (
          <div className="cv-picker-empty">{query ? t("wbNoMatch") : t("wbNoNotes")}</div>
        )}
      </div>
    </div>
  );
}

/** 选图片：vault 已有图片 + 上传本地 */
function ImagePicker({
  onPick,
  onClose,
}: {
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const { bus } = useDomain();
  const [items, setItems] = useState<{ name: string; path: string }[] | null>(null);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const out: { name: string; path: string }[] = [];
      const walk = (nodes: import("../../backend").TreeNode[]) => {
        for (const n of nodes) {
          if (n.kind === "folder") walk(n.children ?? []);
          else if (n.kind === "asset" && IMG_RE.test(n.name)) out.push({ name: n.name, path: n.path });
        }
      };
      walk(await backend.tree());
      if (!dead) setItems(out);
    })();
    return () => {
      dead = true;
    };
  }, []);

  const lower = q.trim().toLowerCase();
  const hits = (items ?? []).filter((im) => !lower || im.name.toLowerCase().includes(lower)).slice(0, 8);

  const upload = async (file: File) => {
    const base64 = await fileToBase64(file);
    const { path } = await backend.saveAsset(file.name, base64);
    bus.emit({ type: "assetCreated", path }); // 文件树即时刷新
    onPick(path);
  };

  return (
    <div className="cv-picker">
      <input
        autoFocus
        className="cv-picker-input"
        placeholder={t("wbImagePh")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onPick(hits[0].path);
          }
          if (e.key === "Escape") onClose();
          e.stopPropagation();
        }}
      />
      <div className="cv-picker-list">
        <button
          className="slash-item"
          onMouseDown={(e) => {
            e.preventDefault();
            fileRef.current?.click();
          }}
        >
          <span className="slash-icon">⬆</span>
          <span className="slash-text">
            <span className="slash-title">{t("wbUploadImage")}</span>
            <span className="slash-desc">attachments/</span>
          </span>
        </button>
        {hits.map((im) => (
          <button
            key={im.path}
            className="slash-item"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(im.path);
            }}
          >
            <span className="slash-icon">🖼</span>
            <span className="slash-text">
              <span className="slash-title">{im.name}</span>
              <span className="slash-desc">{im.path}</span>
            </span>
          </button>
        ))}
        {items !== null && hits.length === 0 && (
          <div className="cv-picker-empty">{t("wbNoImages")}</div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// ---------- 主面板 ----------

export default function CanvasPanel(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasBoard {...props} />
    </ReactFlowProvider>
  );
}

function CanvasBoard({ src, active, onClose }: Props) {
  const { t, dark } = useSettings();
  const { bus } = useDomain();
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<CvNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [picker, setPicker] = useState<null | "note" | "image">(null);
  const [edgeEdit, setEdgeEdit] = useState<{ id: string; label: string; x: number; y: number } | null>(null);
  const storeApi = useStoreApi();

  /** 同步补测节点 internals（handleBounds/尺寸）：官方 useUpdateNodeInternals 走 rAF，
   *  页面隐藏（窗口最小化/标签不可见）时 rAF 与 ResizeObserver 都会停摆，
   *  连线会静默不渲染——这里直连 store 同步量，绕开渲染帧依赖 */
  const kickInternals = useCallback(
    (ids: string[]) => {
      const { domNode, updateNodeInternals } = storeApi.getState();
      if (!domNode) return;
      const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: true }>();
      for (const id of ids) {
        const el = domNode.querySelector(`.react-flow__node[data-id="${id}"]`);
        if (el) updates.set(id, { id, nodeElement: el as HTMLDivElement, force: true });
      }
      if (updates.size) updateNodeInternals(updates);
    },
    [storeApi]
  );

  const latestRef = useRef<{ nodes: CvNode[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const readyRef = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const lastJson = useRef("");
  const folder = src.split("/").slice(0, -1).join("/");

  useEffect(() => {
    latestRef.current = { nodes, edges };
  }, [nodes, edges]);

  // ---- 保存（防抖；序列化内容无变化时跳过） ----

  const doSave = useCallback(async () => {
    if (!readyRef.current) return;
    const json = toCanvasJson(latestRef.current.nodes, latestRef.current.edges);
    if (json === lastJson.current) return;
    lastJson.current = json;
    setSaveState("saving");
    try {
      await backend.writeNote(src, json);
      setSaveState("saved");
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }, [src]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void doSave(), 700);
  }, [doSave]);

  // ---- 载入 ----

  useEffect(() => {
    let dead = false;
    readyRef.current = false;
    setReady(false);
    void (async () => {
      let parsed: { nodes: CvNode[]; edges: Edge[] } = { nodes: [], edges: [] };
      try {
        const { raw } = await backend.readNote(src);
        const p = fromCanvasJson(raw);
        if (p) parsed = p;
      } catch {
        /* 文件缺失/损坏 → 空白板，保存时写回自愈 */
      }
      if (dead) return;
      lastJson.current = toCanvasJson(parsed.nodes, parsed.edges);
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      dead = true;
    };
  }, [src, setNodes, setEdges]);

  // 载入 / 增删卡片后补两脚强制重测，消除注册时序竞态
  useEffect(() => {
    if (!ready || nodes.length === 0) return;
    const ids = nodes.map((n) => n.id);
    const t1 = window.setTimeout(() => kickInternals(ids), 60);
    const t2 = window.setTimeout(() => kickInternals(ids), 320);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ready, nodes.length, kickInternals]);

  // 卸载兜底：防抖窗口内切走时落盘（未加载完成不写，防 StrictMode 双挂载清空文件）
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      void saveRef.current();
    },
    []
  );

  const handleClose = async () => {
    window.clearTimeout(saveTimer.current);
    await doSave().catch(() => {});
    onClose();
  };
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;

  // ---- 变更 → 自动保存 ----

  const handleNodesChange = useCallback(
    (changes: NodeChange<CvNode>[]) => {
      onNodesChange(changes);
      scheduleSave();
    },
    [onNodesChange, scheduleSave]
  );
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      scheduleSave();
    },
    [onEdgesChange, scheduleSave]
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) => addEdge({ ...c, type: "cv", markerEnd: ARROW }, es));
      scheduleSave();
    },
    [setEdges, scheduleSave]
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConn: Connection) => {
      setEdges((es) => reconnectEdge(oldEdge, newConn, es));
      scheduleSave();
    },
    [setEdges, scheduleSave]
  );

  const onEdgeDoubleClick = useCallback((e: React.MouseEvent, edge: Edge) => {
    setEdgeEdit({ id: edge.id, label: typeof edge.label === "string" ? edge.label : "", x: e.clientX, y: e.clientY });
  }, []);

  const commitEdgeLabel = () => {
    const edit = edgeEdit;
    if (!edit) return;
    setEdgeEdit(null);
    setEdges((es) =>
      es.map((x) => (x.id === edit.id ? { ...x, label: edit.label.trim() || undefined } : x))
    );
    scheduleSave();
  };

  // ---- 新增卡片：默认落可视中心（多张级联偏移）；拖入落鼠标处 ----

  const addCardAt = useCallback(
    (kind: CardKind, file: string | undefined, flowPos: { x: number; y: number }) => {
      const { w, h } = SIZES[kind];
      const node: CvNode = {
        id: newId(),
        type: kind === "text" || kind === "block" ? "text" : kind,
        position: { x: Math.round(flowPos.x - w / 2), y: Math.round(flowPos.y - h / 2) },
        width: w,
        height: h,
        data:
          kind === "text"
            ? { text: "", editing: true }
            : kind === "block"
              ? { text: "", editing: true, color: "#2f9e44" }
              : { file: file ?? "" },
      };
      setNodes((ns) => [...ns, node]);
      setPicker(null);
      scheduleSave();
    },
    [setNodes, scheduleSave]
  );

  const addCard = useCallback(
    (kind: CardKind, file?: string) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const center = rect
        ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 0, y: 0 };
      const off = (latestRef.current.nodes.length % 5) * 28;
      addCardAt(kind, file, { x: center.x + off, y: center.y + off });
    },
    [rf, addCardAt]
  );

  // 从文件树拖笔记/图片进白板：拖放点成卡
  const onTreeDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TREE_MIME)) return;
    e.preventDefault(); // dragenter/dragover 都要取消默认，drop 才会派发
    e.dataTransfer.dropEffect = "copy";
  };
  const onTreeDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TREE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(TREE_MIME);
    if (!raw) return;
    try {
      const { path, kind } = JSON.parse(raw) as { path?: string; kind?: string };
      if (!path) return;
      if (kind === "note") {
        addCardAt("note", path, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      } else if (kind === "asset" && IMG_RE.test(path)) {
        addCardAt("image", path, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }
    } catch {
      /* 非法数据忽略 */
    }
  };

  // ---- 笔记/附件改名或移动：卡片引用跟随 ----

  useEffect(() => {
    const off = bus.on(["noteRenamed", "noteMoved", "assetMoved"], (e) => {
      if (e.type !== "noteRenamed" && e.type !== "noteMoved" && e.type !== "assetMoved") return;
      let hit = false;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.data?.file !== e.from) return n;
          hit = true;
          return { ...n, data: { ...n.data, file: e.to } };
        })
      );
      if (hit) scheduleSave();
    });
    return off;
  }, [bus, setNodes, scheduleSave]);

  // ---- Esc 逐级退出：输入框 → 选择器 → 选中 → 关标签（仅活动标签响应） ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return; // 标签常驻：非活动面板不响应，避免关错标签
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      // 卡片文本编辑 / 标签编辑中的 Esc：先退出编辑（blur 即提交），不穿透
      if (el && el.closest && el.closest("textarea, input")) {
        e.preventDefault();
        e.stopPropagation();
        (el as HTMLElement).blur();
        return;
      }
      if (edgeEdit) {
        e.preventDefault();
        e.stopPropagation();
        setEdgeEdit(null);
        return;
      }
      if (picker) {
        e.preventDefault();
        e.stopPropagation();
        setPicker(null);
        return;
      }
      const sel =
        latestRef.current.nodes.some((n) => n.selected) ||
        latestRef.current.edges.some((x) => x.selected);
      if (sel) {
        e.preventDefault();
        e.stopPropagation();
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setEdges((es) => es.map((x) => (x.selected ? { ...x, selected: false } : x)));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, picker, edgeEdit, setNodes, setEdges]);

  return (
    <CvCtx.Provider value={{ folder, touch: scheduleSave, setNodes }}>
      {/* 无顶栏设计（与笔记编辑器一致）：文件名与关闭都在标签条上；Esc 逐级退出最后关标签 */}
      <div
        ref={wrapRef}
        className="cv-wrap h-full"
        onDragEnter={onTreeDragOver}
        onDragOver={onTreeDragOver}
        onDrop={onTreeDrop}
      >
        {ready ? (
            <ReactFlow
              className="cv-flow"
              colorMode={dark ? "dark" : "light"}
              onError={(code, msg) => console.warn("[cv-flow]", code, msg)}
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              edgesReconnectable
              onEdgeDoubleClick={onEdgeDoubleClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              deleteKeyCode={["Backspace", "Delete"]}
              minZoom={0.1}
              maxZoom={2.5}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1.8} />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              {t("wbLoading")}
            </div>
          )}

          {/* 空白提示 */}
          {ready && nodes.length === 0 && (
            <div className="cv-empty-hint">{t("wbEmptyHint")}</div>
          )}

          {/* 底部工具栏 + 插入选择器 */}
          {ready && (
            <>
              {picker && <div className="cv-picker-backdrop" onClick={() => setPicker(null)} />}
              <div className="cv-toolbar">
                <button
                  className={`cv-tool ${picker === "note" ? "cv-tool-on" : ""}`}
                  data-tip={t("wbAddNote")}
                  onClick={() => setPicker((v) => (v === "note" ? null : "note"))}
                >
                  {I.note}
                  <span>{t("wbNote")}</span>
                </button>
                <button
                  className={`cv-tool ${picker === "image" ? "cv-tool-on" : ""}`}
                  data-tip={t("wbAddImage")}
                  onClick={() => setPicker((v) => (v === "image" ? null : "image"))}
                >
                  {I.image}
                  <span>{t("wbImage")}</span>
                </button>
                <button
                  className="cv-tool"
                  data-tip={t("wbAddText")}
                  onClick={() => addCard("text")}
                >
                  <span className="cv-tool-t">T</span>
                  <span>{t("wbText")}</span>
                </button>
                <button
                  className="cv-tool"
                  data-tip={t("wbAddBlock")}
                  onClick={() => addCard("block")}
                >
                  <span className="cv-tool-block" />
                  <span>{t("wbBlock")}</span>
                </button>
              </div>
              {picker === "note" && (
                <NotePicker
                  folder={folder}
                  onPick={(p) => addCard("note", p)}
                  onClose={() => setPicker(null)}
                />
              )}
              {picker === "image" && (
                <ImagePicker onPick={(p) => addCard("image", p)} onClose={() => setPicker(null)} />
              )}
            </>
          )}

          {/* 连线标签编辑（双击连线呼出） */}
          {edgeEdit && (
            <input
              autoFocus
              className="cv-edge-input"
              style={{ left: edgeEdit.x, top: edgeEdit.y }}
              value={edgeEdit.label}
              placeholder={t("wbEdgeLabel")}
              onChange={(e) => setEdgeEdit((v) => (v ? { ...v, label: e.target.value } : v))}
              onBlur={commitEdgeLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdgeLabel();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setEdgeEdit(null);
                }
                e.stopPropagation();
              }}
            />
          )}

          {/* 保存失败浮动提示（顶栏已删，错误态单独浮出；点击重试） */}
          {saveState === "error" && (
            <button className="cv-save-error" onClick={() => void doSave()}>
              {t("wbSaveFailed")} · {t("retry")}
            </button>
          )}
        </div>
    </CvCtx.Provider>
  );
}
