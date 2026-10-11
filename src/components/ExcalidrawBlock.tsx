import { createContext, useContext, useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { backend } from "../backend";
import { isExcalidrawSrc, pngSibling, safeDecode } from "../lib/markdown";
import { downloadDataUrl, extOfDataUrl } from "../lib/download";
import { showContextMenu } from "./ContextMenu";
import { useSettings } from "../i18n";
import { I } from "./icons";

export const EMPTY_SCENE_JSON = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "noteshare",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

/** 画板相关全局状态：rev 是内容版本号（保存后 +1 刷新预览），locked 是编辑器锁定态 */
export const EditorStateContext = createContext<{ rev: number; locked: boolean }>({
  rev: 0,
  locked: false,
});

/** 节点视图请求打开画板编辑器的事件（detail = { path, newTab }）；
 *  从笔记内进入画板默认开新标签（保留笔记标签），App 统一处理 */
export const EDIT_SCENE_EVENT = "noteshare:edit-scene";
export function emitEditScene(src: string, newTab = true) {
  window.dispatchEvent(new CustomEvent(EDIT_SCENE_EVENT, { detail: { path: src, newTab } }));
}

/** 请求用共用阅览器查看图片的事件（detail = 图片 src） */
export const VIEW_IMAGE_EVENT = "noteshare:view-image";
export function emitViewImage(src: string) {
  window.dispatchEvent(new CustomEvent(VIEW_IMAGE_EVENT, { detail: src }));
}

/** 图片节点：单击选中（四角拖拽缩放，Delete 删除），双击打开阅览器；
 *  .excalidraw 显示为可编辑画板卡片（锁定时纯展示） */
function ImageView({ node, editor, selected, deleteNode, updateAttributes, getPos }: any) {
  const { t } = useSettings();
  const raw: string = node.attrs.src ?? "";
  const src = safeDecode(raw);
  const { rev, locked } = useContext(EditorStateContext);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "empty" | "noPng" | "ready">("loading");
  const [dragW, setDragW] = useState<number | null>(null); // 拖拽过程中的宽度
  const isFig = isExcalidrawSrc(src);
  const displayW = dragW ?? (node.attrs.width ? Number(node.attrs.width) : null);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!isFig) {
        try {
          const { base64, mime } = await backend.readAssetBase64(src);
          if (!dead) setUrl(`data:${mime};base64,${base64}`);
        } catch {
          if (!dead) setUrl(src); // 外链图片等
        }
        return;
      }
      try {
        const scene = JSON.parse(await backend.readScene(src));
        if (dead) return;
        const elements = scene.elements ?? [];
        if (!elements.length) {
          setUrl(null);
          setState("empty");
          return;
        }
        try {
          const { base64, mime } = await backend.readAssetBase64(pngSibling(src));
          if (!dead) {
            setUrl(`data:${mime};base64,${base64}`);
            setState("ready");
          }
        } catch {
          if (!dead) {
            setUrl(null);
            setState("noPng");
          }
        }
      } catch {
        if (!dead) setState("empty");
      }
    })();
    return () => {
      dead = true;
    };
  }, [src, rev, isFig]);

  /** 单击：选中节点（出现缩放手柄，Delete 可删） */
  const selectNode = (e: React.MouseEvent) => {
    if (locked) return;
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos === "number") {
      editor.commands.focus();
      editor.commands.setNodeSelection(pos);
    }
  };

  /** 拖角缩放：只改宽度，高度按比例跟随 */
  const startResize = (e: React.PointerEvent, dir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = (e.currentTarget as HTMLElement).parentElement;
    const startX = e.clientX;
    const startW = displayW ?? wrap?.offsetWidth ?? 400;
    const clamp = (w: number) => Math.max(80, Math.min(1400, Math.round(w)));
    const move = (ev: PointerEvent) => setDragW(clamp(startW + (ev.clientX - startX) * dir));
    const finish = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      // 触摸设备上系统打断手势（pointercancel）时不提交宽度，只还原
      if (ev.type === "pointercancel") {
        setDragW(null);
        return;
      }
      setDragW(null);
      updateAttributes({ width: clamp(startW + (ev.clientX - startX) * dir) });
    };
    const cancel = (ev: PointerEvent) => finish(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  if (!isFig) {
    const dataUrl = url ?? src;
    return (
      <NodeViewWrapper>
        <span
          className={`img-resize-wrap ${selected ? "img-selected" : ""}`}
          style={displayW ? { width: displayW } : undefined}
        >
          <img
            src={dataUrl}
            data-src={raw}
            alt={node.attrs.alt ?? ""}
            title={locked ? t("imgTitleLock") : t("imgTitleEdit")}
            style={displayW ? { width: "100%" } : undefined}
            onClick={selectNode}
            onDoubleClick={() => emitViewImage(dataUrl)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              showContextMenu(e.clientX, e.clientY, [
                { label: t("viewLarge"), onClick: () => emitViewImage(dataUrl) },
                {
                  label: t("downloadImage"),
                  onClick: () =>
                    void downloadDataUrl(
                      safeDecode(raw).split("/").pop() || `image.${extOfDataUrl(dataUrl)}`,
                      dataUrl
                    ),
                },
                { separator: true },
                { label: t("deleteImage"), danger: true, onClick: deleteNode },
              ]);
            }}
          />
          {selected && !locked && (
            <>
              <span className="img-handle tl" onPointerDown={(e) => startResize(e, -1)} />
              <span className="img-handle tr" onPointerDown={(e) => startResize(e, 1)} />
              <span className="img-handle bl" onPointerDown={(e) => startResize(e, -1)} />
              <span className="img-handle br" onPointerDown={(e) => startResize(e, 1)} />
            </>
          )}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={`excalidraw-fig ${selected ? "ring-2 ring-amber-500/60" : ""}`}
        onDoubleClick={() => !locked && emitEditScene(src)}
        onClick={() => {
          // 可编辑：右侧面板编辑；锁定：用阅览器看预览图
          if (locked) {
            if (url) emitViewImage(url);
          } else {
            emitEditScene(src);
          }
        }}
        title={locked ? t("clickCanvas") : t("clickToEdit")}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (locked) {
            if (url) {
              showContextMenu(e.clientX, e.clientY, [
                {
                  label: t("downloadPng"),
                  onClick: () =>
                    void downloadDataUrl(
                      pngSibling(src).split("/").pop() || "drawing.png",
                      url
                    ),
                },
              ]);
            }
            return;
          }
          showContextMenu(e.clientX, e.clientY, [
            { label: t("editCanvas"), onClick: () => emitEditScene(src) },
            {
              label: t("downloadPng"),
              disabled: !url,
              onClick: () =>
                void downloadDataUrl(
                  pngSibling(src).split("/").pop() || "drawing.png",
                  url!
                ),
            },
            { separator: true },
            { label: t("deleteCanvasBlock"), danger: true, onClick: deleteNode },
          ]);
        }}
      >
        {!locked && (
          <div className="fig-actions">
            <button
              className="btn-outline !px-2 !py-1 text-xs"
              title="编辑画板"
              onClick={() => emitEditScene(src)}
            >
              {I.pen} {t("editCanvas")}
            </button>
            <button
              className="btn-outline !px-2 !py-1 text-xs hover:!text-red-600"
              title={t("deleteCanvasKeep")}
              onClick={deleteNode}
            >
              {t("delete")}
            </button>
          </div>
        )}
        {state === "empty" ? (
          <div
            className="fig-empty"
            onClick={() => !locked && emitEditScene(src)}
          >
            {locked ? t("emptyCanvas") : t("emptyCanvasHint")}
          </div>
        ) : state === "noPng" ? (
          <div
            className="fig-empty"
            onClick={() => !locked && emitEditScene(src)}
          >
            {locked ? "画板" : t("canvasReadyHint")}
          </div>
        ) : url ? (
          <img src={url} data-src={raw} alt={t("sceneAlt")} />
        ) : (
          <div className="fig-empty">画板加载中…</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 真实资源路径：解析时优先读 data-src——NodeView 展示用的 img 可能是
      // dataUrl（画板 PNG 预览/图片内联），拖拽/粘贴时 ProseMirror 会从 DOM
      // 重新解析节点，没有 data-src 保护的话 dataUrl 会被写回文档顶掉路径
      src: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-src") ?? element.getAttribute("src"),
      },
      // 显示宽度（像素）；保存为 Obsidian 风格 ![alt|宽度](src)
      width: {
        default: null,
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width } : {},
        parseHTML: (element) => element.getAttribute("width") || null,
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const alt = String(node.attrs.alt || "").replace(/[[\]|]/g, "");
          const w = node.attrs.width ? `|${node.attrs.width}` : "";
          state.ensureNewLine();
          state.write(`![${alt}${w}](${node.attrs.src})`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
