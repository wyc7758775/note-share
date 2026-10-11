// 画板编辑面板：以标签页形态渲染在栏内（打开/关闭由 Workspace 标签管理）
// 实时保存：改动后 ~1 秒自动存场景，~2.6 秒自动导出 PNG 预览（发 sceneSaved 事件刷新笔记内预览）
// 笔记/白板卡片走 Obsidian 式 canvas（CanvasPanel），这里只做手绘
import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { backend } from "../backend";
import { useSettings } from "../i18n";
import { useDomain } from "../domain/provider";
import { emitOpenNote } from "./WikiLink";

/** 卡片链接协议：noteshare://<vault 相对路径> */
const NOTE_LINK = "noteshare://";

interface Props {
  src: string;
  /** 是否为活动标签（标签常驻后多个画板同时挂载，Esc 只响应活动者） */
  active: boolean;
  /** PNG 落盘后回调（App 刷新文件树） */
  onSaved: () => void;
  /** 关闭当前标签（Esc / 兜底保存后调用） */
  onClose: () => void;
}

type SaveState = "saved" | "saving" | "error";

export default function ExcalidrawPanel({ src, active, onSaved, onClose }: Props) {
  const { t, dark } = useSettings();
  const { bus } = useDomain();
  const apiRef = useRef<any>(null);
  const [initialData, setInitialData] = useState<any>(null);
  const [, setSaveState] = useState<SaveState>("saved");
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
      bus.emit({ type: "sceneSaved", path: src }); // 笔记内的画板卡片刷新预览
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

  const handleClose = async () => {
    window.clearTimeout(sceneTimer.current);
    window.clearTimeout(pngTimer.current);
    await doSaveScene().catch(() => {});
    await doSavePng().catch(() => {});
    onClose();
  };

  // Esc 关闭：捕获阶段先于 Excalidraw 自己的 Esc 处理读状态——
  // 有选中元素或正在编辑文本时，这一次 Esc 留给画板（取消选中/结束编辑），
  // 只有"空闲"状态下的 Esc 才关闭标签（先兜底保存）。
  // 标签常驻后非活动面板不响应（否则会关掉别的标签）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
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
      void handleClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(
    () => () => {
      window.clearTimeout(sceneTimer.current);
      window.clearTimeout(pngTimer.current);
    },
    []
  );

  return (
    // 无顶栏设计（与笔记编辑器/白板一致）：文件名与关闭都在标签条上；Esc 空闲时兜底保存后关标签
    <div className="h-full">
      {initialData ? (
        <Excalidraw
          excalidrawAPI={(api: any) => (apiRef.current = api)}
          initialData={initialData}
          onChange={handleChange}
          theme={dark ? "dark" : "light"}
          // 点击笔记卡片（noteshare:// 链接）跳转：普通点击当前栏新标签（保留画板），Ctrl+点击新栏
          onLinkOpen={(element: any, event: any) => {
            const link = String(element?.link ?? "");
            if (link.startsWith(NOTE_LINK)) {
              event?.preventDefault?.();
              const ctrl = event?.ctrlKey || event?.metaKey;
              emitOpenNote(link.slice(NOTE_LINK.length), { newTab: !ctrl, newPane: ctrl });
            }
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-faint">
          {t("sceneLoading")}
        </div>
      )}
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
