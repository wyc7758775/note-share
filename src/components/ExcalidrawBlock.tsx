import { createContext, useContext, useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { backend } from "../backend";
import { isExcalidrawSrc, pngSibling, safeDecode } from "../lib/markdown";
import { showContextMenu } from "./ContextMenu";
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

/** 节点视图请求打开画板编辑器的事件 */
export const EDIT_SCENE_EVENT = "noteshare:edit-scene";
export function emitEditScene(src: string) {
  window.dispatchEvent(new CustomEvent(EDIT_SCENE_EVENT, { detail: src }));
}

/** 请求用共用阅览器查看图片的事件（detail = 图片 src） */
export const VIEW_IMAGE_EVENT = "noteshare:view-image";
export function emitViewImage(src: string) {
  window.dispatchEvent(new CustomEvent(VIEW_IMAGE_EVENT, { detail: src }));
}

/** 图片节点：普通图片直接显示；.excalidraw 显示为可编辑画板卡片（锁定时纯展示） */
function ImageView({ node, selected, deleteNode }: any) {
  const raw: string = node.attrs.src ?? "";
  const src = safeDecode(raw);
  const { rev, locked } = useContext(EditorStateContext);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "empty" | "noPng" | "ready">("loading");
  const isFig = isExcalidrawSrc(src);

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

  if (!isFig) {
    return (
      <NodeViewWrapper>
        <img
          src={url ?? src}
          alt={node.attrs.alt ?? ""}
          title="点击查看大图"
          onClick={(e) => emitViewImage((e.target as HTMLImageElement).src)}
        />
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
        title={locked ? "点击查看画板" : "点击在右侧编辑画板"}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (locked) return;
          showContextMenu(e.clientX, e.clientY, [
            { label: "编辑画板", onClick: () => emitEditScene(src) },
            { separator: true },
            { label: "删除画板块", danger: true, onClick: deleteNode },
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
              {I.pen} 编辑
            </button>
            <button
              className="btn-outline !px-2 !py-1 text-xs hover:!text-red-600"
              title="删除画板块（文件保留在 attachments）"
              onClick={deleteNode}
            >
              删除
            </button>
          </div>
        )}
        {state === "empty" ? (
          <div
            className="fig-empty"
            onClick={() => !locked && emitEditScene(src)}
          >
            {locked ? "空画板" : "空画板 · 点击开始绘制（会自动保存为 .excalidraw 文件）"}
          </div>
        ) : state === "noPng" ? (
          <div
            className="fig-empty"
            onClick={() => !locked && emitEditScene(src)}
          >
            {locked ? "画板" : "画板已有内容 · 点击编辑生成预览图"}
          </div>
        ) : url ? (
          <img src={url} alt="excalidraw 画板" />
        ) : (
          <div className="fig-empty">画板加载中…</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const CustomImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
