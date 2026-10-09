// 画板编辑面板：渲染在编辑器右侧（与笔记并排，不是全局遮罩）
// 实时保存：改动后 ~1 秒自动存场景，~2.6 秒自动导出 PNG 预览；关闭时兜底保存
import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { backend } from "../backend";
import { useSettings } from "../i18n";

interface Props {
  src: string;
  onBack: () => void;
  /** 返回按钮文案：从笔记推入时"← 返回笔记"，独立打开时"关闭" */
  backLabel?: string;
  onSaved: () => void;
}

type SaveState = "saved" | "saving" | "error";

export default function ExcalidrawPanel({ src, onBack, backLabel, onSaved }: Props) {
  const { t, dark } = useSettings();
  const backText = backLabel ?? t("close");
  const apiRef = useRef<any>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const latestRef = useRef<{ elements: any[]; files: any; appState: any } | null>(null);
  const sceneTimer = useRef<number | undefined>(undefined);
  const pngTimer = useRef<number | undefined>(undefined);
  const lastSceneJson = useRef<string>("");

  useEffect(() => {
    let dead = false;
    (async () => {
      // 读不到 / 内容损坏：降级为空场景（可重画，保存时写回原路径自愈）
      let scene: { elements?: unknown[]; appState?: { viewBackgroundColor?: string }; files?: unknown } = {};
      try {
        scene = JSON.parse(await backend.readScene(src));
      } catch {
        /* 用空场景 */
      }
      if (dead) return;
      lastSceneJson.current = JSON.stringify({ elements: scene.elements ?? [] });
      setInitialData({
        elements: scene.elements ?? [],
        appState: {
          viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
        },
        files: scene.files ?? {},
      });
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

  // Esc 返回：捕获阶段先于 Excalidraw 自己的 Esc 处理读状态——
  // 有选中元素或正在编辑文本时，这一次 Esc 留给画板（取消选中/结束编辑），
  // 只有"空闲"状态下的 Esc 才退出画板返回笔记。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const appState = apiRef.current?.getAppState?.();
      const busy =
        !!appState &&
        (Object.keys(appState.selectedElementIds ?? {}).length > 0 ||
          appState.editingId != null ||
          appState.editingGroupId != null);
      if (busy) return;
      e.preventDefault();
      e.stopPropagation();
      void handleBack();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(sceneTimer.current);
      window.clearTimeout(pngTimer.current);
    },
    []
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-2 text-sm text-soft">
          <span className="text-faint">✏</span>
          <span>{t("sceneTitle")}</span>
          <span
            className={`text-xs ${
              saveState === "saving"
                ? "text-amber-700"
                : saveState === "error"
                  ? "text-red-600"
                  : "text-faint"
            }`}
          >
            {saveState === "saving" ? t("autosaving") : saveState === "error" ? t("autosaveRetry") : t("autosaveOn")}
          </span>
        </div>
        <button className="btn-ghost !py-1" onClick={() => void handleBack()}>
          {backText}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {initialData ? (
          <Excalidraw
            excalidrawAPI={(api: any) => (apiRef.current = api)}
            initialData={initialData}
            onChange={handleChange}
            theme={dark ? "dark" : "light"}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-faint">
            {t("sceneLoading")}
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
