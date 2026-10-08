import { createContext, useContext, useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { backend } from "../backend";
import { isExcalidrawSrc, pngSibling, safeDecode } from "../lib/markdown";
import { I } from "./icons";

export const EMPTY_SCENE_JSON = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "noteshare",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

/** 画板内容版本号：每次保存画板后 +1，节点视图据此刷新预览图 */
export const SceneRevContext = createContext(0);

/** 节点视图请求打开画板编辑器的事件 */
export const EDIT_SCENE_EVENT = "noteshare:edit-scene";
export function emitEditScene(src: string) {
  window.dispatchEvent(new CustomEvent(EDIT_SCENE_EVENT, { detail: src }));
}

/** 图片节点：普通图片直接显示；.excalidraw 显示为可编辑画板卡片 */
function ImageView({ node, selected, deleteNode }: any) {
  const raw: string = node.attrs.src ?? "";
  const src = safeDecode(raw);
  const rev = useContext(SceneRevContext);
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
          // 有场景但没有预览 PNG（例如还没在编辑器里编辑过）
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
        <img src={url ?? src} alt={node.attrs.alt ?? ""} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={`excalidraw-fig ${selected ? "ring-2 ring-amber-500/60" : ""}`}
        onDoubleClick={() => emitEditScene(src)}
      >
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
        {state === "empty" ? (
          <div className="fig-empty" onClick={() => emitEditScene(src)}>
            空画板 · 点击开始绘制（会自动保存为 .excalidraw 文件）
          </div>
        ) : state === "noPng" ? (
          <div className="fig-empty" onClick={() => emitEditScene(src)}>
            画板已有内容 · 点击编辑生成预览图
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
