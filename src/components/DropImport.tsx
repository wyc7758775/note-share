// OS 文件拖放导入：window 级监听（Files-only），拖入时全窗覆盖层提示，
// 松开导入到"活动栏当前标签所在文件夹"（无则 vault 根）。
// 拖到编辑器正文的图片仍由 Editor 消费（插图），这里只接未被内部处理的 drop；
// 拖到文件树的文件夹行会定向导入（FileTree 自己处理并 stopPropagation）。
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../i18n";
import { useDomain } from "../domain/provider";
import { importDroppedFiles, type ImportResult } from "../lib/dropImport";

type Phase = "idle" | "over" | "busy" | "done" | "fail";

export default function DropImport() {
  const { t } = useSettings();
  const { notes: noteService, workspace } = useDomain();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ImportResult | null>(null);
  const depthRef = useRef(0); // dragenter/leave 嵌套计数
  const timerRef = useRef<number>(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const reset = () => {
      depthRef.current = 0;
      setPhase((p) => (p === "over" ? "idle" : p));
    };

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return; // 内部标签/树拖拽不掺和
      depthRef.current += 1;
      setPhase("over");
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // 必须：否则 drop 落到浏览器变成打开文件
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setPhase((p) => (p === "over" ? "idle" : p));
    };
    const onBlur = () => reset();
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depthRef.current = 0;
      // 能冒泡到 window 的都是内部没消费的 drop（编辑器插图已 stopPropagation）
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      // 目标：活动栏当前标签所在文件夹（Home/根 = ""）
      const active = workspace.activePath ?? "";
      const folder = active.split("/").slice(0, -1).join("/");
      setPhase("busy");
      try {
        const r = await importDroppedFiles(files, folder, noteService);
        setResult(r);
        setPhase(r.failed.length && !r.notes.length && !r.assets.length ? "fail" : "done");
        if (r.notes[0]) workspace.open(r.notes[0], "newTab"); // 首个笔记直接打开
      } catch (err) {
        console.error("拖放导入失败", err);
        setPhase("fail");
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("blur", onBlur);
      window.clearTimeout(timerRef.current);
    };
  }, [noteService, workspace]);

  // done/fail 短暂展示后淡出
  useEffect(() => {
    if (phase !== "done" && phase !== "fail") return;
    timerRef.current = window.setTimeout(() => setPhase("idle"), 2600);
    return () => window.clearTimeout(timerRef.current);
  }, [phase]);

  if (phase === "idle") return null;

  const n = (result?.notes.length ?? 0) + (result?.assets.length ?? 0);
  const folderLabel = (() => {
    const active = workspace.activePath ?? "";
    return active.split("/").slice(0, -1).join("/") || "/";
  })();

  return (
    <div className="drop-import-overlay" data-phase={phase}>
      {phase === "busy" ? (
        <div className="drop-import-card">{t("dropImporting")}</div>
      ) : phase === "done" ? (
        <div className="drop-import-card drop-import-done">
          {t("dropImportDone", { n })}
          {result && result.notes.length > 0 && (
            <span className="drop-import-sub">{result.notes.map((p) => p.split("/").pop()).join("、")}</span>
          )}
        </div>
      ) : phase === "fail" ? (
        <div className="drop-import-card drop-import-fail">{t("dropImportFail")}</div>
      ) : (
        <div className="drop-import-card">
          <div className="drop-import-icon">⤓</div>
          <div>{t("dropImportHint", { folder: folderLabel })}</div>
          <div className="drop-import-sub">{t("dropImportFolderTip")}</div>
        </div>
      )}
    </div>
  );
}
