// 画板编辑面板：渲染在编辑器右侧（与笔记并排，不是全局遮罩）
// 实时保存：改动后 ~1 秒自动存场景，~2.6 秒自动导出 PNG 预览；关闭时兜底保存
import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { backend } from "../backend";

interface Props {
  src: string;
  onBack: () => void;
  /** 返回按钮文案：从笔记推入时"← 返回笔记"，独立打开时"关闭" */
  backLabel?: string;
  onSaved: () => void;
}

type SaveState = "saved" | "saving" | "error";

export default function ExcalidrawPanel({ src, onBack, backLabel = "关闭", onSaved }: Props) {
  const apiRef = useRef<any>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const latestRef = useRef<{ elements: any[]; files: any; appState: any } | null>(null);
  const sceneTimer = useRef<number | undefined>(undefined);
  const pngTimer = useRef<number | undefined>(undefined);
  const lastSceneJson = useRef<string>("");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const scene = JSON.parse(await backend.readScene(src));
        if (dead) return;
        lastSceneJson.current = JSON.stringify({ elements: scene.elements ?? [] });
        setInitialData({
          elements: scene.elements ?? [],
          appState: {
            viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
          },
          files: scene.files ?? {},
        });
      } catch {
        setError("画板文件读取失败");
      }
    })();
    return () => {
      dead = true;
    };
  }, [src]);

  const buildSceneJson = () => {
    const l = latestRef.current!;
    return JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "noteshare",
      elements: l.elements,
      files: l.files,
      appState: { viewBackgroundColor: l.appState?.viewBackgroundColor },
    });
  };

  const doSaveScene = async () => {
    const l = latestRef.current;
    if (!l) return;
    const json = JSON.stringify({ elements: l.elements });
    if (json === lastSceneJson.current) return;
    lastSceneJson.current = json;
    setSaveState("saving");
    try {
      await backend.saveScene(src, buildSceneJson(), null);
      setSaveState("saved");
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  };

  const doSavePng = async () => {
    const l = latestRef.current;
    if (!l || !l.elements.length) return;
    try {
      const blob = await exportToBlob({
        elements: l.elements,
        files: l.files,
        appState: { ...l.appState, exportWithDarkMode: false },
        mimeType: "image/png",
      });
      const pngBase64 = await blobToBase64(blob);
      await backend.saveScene(src, buildSceneJson(), pngBase64);
      onSaved();
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  };

  const handleChange = () => {
    const api = apiRef.current;
    if (!api) return;
    latestRef.current = {
      elements: api.getSceneElements(),
      files: api.getFiles(),
      appState: api.getAppState(),
    };
    window.clearTimeout(sceneTimer.current);
    sceneTimer.current = window.setTimeout(() => void doSaveScene(), 900);
    window.clearTimeout(pngTimer.current);
    pngTimer.current = window.setTimeout(() => void doSavePng(), 2600);
  };

  const handleBack = async () => {
    window.clearTimeout(sceneTimer.current);
    window.clearTimeout(pngTimer.current);
    await doSaveScene().catch(() => {});
    await doSavePng().catch(() => {});
    onBack();
  };

  useEffect(
    () => () => {
      window.clearTimeout(sceneTimer.current);
      window.clearTimeout(pngTimer.current);
    },
    []
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-stone-200 px-3">
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <span className="text-stone-400">✏</span>
          <span>画板</span>
          <span
            className={`text-xs ${
              saveState === "saving"
                ? "text-amber-700"
                : saveState === "error"
                  ? "text-red-600"
                  : "text-stone-400"
            }`}
          >
            {saveState === "saving" ? "自动保存中…" : saveState === "error" ? "保存失败，仍在重试" : "实时保存已开启"}
          </span>
        </div>
        <button className="btn-ghost !py-1" onClick={() => void handleBack()}>
          {backLabel}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {initialData ? (
          <Excalidraw
            excalidrawAPI={(api: any) => (apiRef.current = api)}
            initialData={initialData}
            onChange={handleChange}
            theme="light"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-stone-400">
            {error || "画板加载中…"}
          </div>
        )}
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
