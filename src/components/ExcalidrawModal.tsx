import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { backend } from "../backend";

interface Props {
  src: string; // attachments/xxx.excalidraw
  onClose: () => void;
  onSaved: () => void;
}

export default function ExcalidrawModal({ src, onClose, onSaved }: Props) {
  const apiRef = useRef<any>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const scene = JSON.parse(await backend.readScene(src));
        if (dead) return;
        setInitialData({
          elements: scene.elements ?? [],
          appState: {
            viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
          },
          files: scene.files ?? {},
        });
      } catch (e) {
        setError("画板文件读取失败");
      }
    })();
    return () => {
      dead = true;
    };
  }, [src]);

  const handleSave = async () => {
    const api = apiRef.current;
    if (!api) return;
    setSaving(true);
    setError("");
    try {
      const elements = api.getSceneElements();
      const files = api.getFiles();
      const appState = api.getAppState();

      // PNG 预览图：编辑器内和发布页都显示这张
      const blob = await exportToBlob({
        elements,
        files,
        appState: { ...appState, exportWithDarkMode: false },
        mimeType: "image/png",
      });
      const pngBase64 = await blobToBase64(blob);

      // 场景文件：与 Obsidian Excalidraw 插件同源的 .excalidraw JSON
      const sceneJson = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "noteshare",
        elements,
        files,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
      });

      await backend.saveScene(src, sceneJson, pngBase64);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      setError("保存失败，请重试");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-[88vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200 px-4">
          <div className="text-sm font-medium text-stone-700">画板（Excalidraw）</div>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn-primary" disabled={saving} onClick={handleSave}>
              {saving ? "保存中…" : "完成并保存"}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          {initialData ? (
            <Excalidraw
              excalidrawAPI={(api: any) => (apiRef.current = api)}
              initialData={initialData}
              theme="light"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-stone-400">
              {error || "画板加载中…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
