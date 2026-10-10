// 发布 / 导出视图：占满编辑器主区（视图切换，不是全局遮罩弹窗）
import { useEffect, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { backend } from "../backend";
import { useSettings } from "../i18n";
import { useDomain } from "../domain/provider";
import { getPublishConfig, setPublishConfig } from "../lib/config";
import { tagsOf } from "../lib/frontmatter";
import { composeArticleHtml, inlineAssets } from "../lib/exportHtml";
import { I } from "./icons";

interface Props {
  editor: TipTapEditor;
  pathRef: { current: string };
  fmRef: { current: Record<string, unknown> };
  title: { current: string };
  onBack: () => void;
}

export default function PublishPanel({ editor, pathRef, fmRef, title, onBack }: Props) {
  const { t } = useSettings();
  const { notes: noteService } = useDomain();
  const [exportState, setExportState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [exportMsg, setExportMsg] = useState("");

  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [slug, setSlug] = useState("");
  const [pubState, setPubState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [pubMsg, setPubMsg] = useState("");
  const [pubUrl, setPubUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const cfg = getPublishConfig();
    setServerUrl(cfg.serverUrl);
    setToken(cfg.token);
    setSlug(String(fmRef.current.slug || randomSlug()));
  }, [fmRef]);

  const date = () => {
    const fm = fmRef.current;
    const t = String(fm.publishedAt || fm.created || "");
    return t ? t.slice(0, 10) : new Date().toISOString().slice(0, 10);
  };

  const doExport = async () => {
    setExportState("busy");
    setExportMsg("");
    try {
      const html = await inlineAssets(editor.getHTML());
      const titleText = title.current.trim() || t("untitled");
      const doc = await composeArticleHtml(titleText, html, {
        tags: tagsOf(fmRef.current),
        date: date(),
      });
      const fileName = `${titleText.replace(/[\\/:*?"<>|]/g, "_")}.html`;
      const saved = await backend.saveTextFile(fileName, doc);
      if (saved === null) {
        const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
        setExportMsg(t("exportedDownload", { name: fileName }));
      } else {
        setExportMsg(t("exportedTo", { path: saved }));
      }
      setExportState("done");
    } catch (e) {
      console.error(e);
      setExportState("error");
      setExportMsg(t("exportFail"));
    }
  };

  const doPublish = async () => {
    const base = serverUrl.trim().replace(/\/+$/, "");
    if (!base) {
      setPubState("error");
      setPubMsg(t("pubNeedServer"));
      return;
    }
    if (!slug.trim()) {
      setPubState("error");
      setPubMsg(t("pubNeedSlug"));
      return;
    }
    setPubState("busy");
    setPubMsg("");
    setCopied(false);
    try {
      const html = await inlineAssets(editor.getHTML());
      const titleText = title.current.trim() || t("untitled");
      const data = await noteService.publish({
        path: pathRef.current,
        base,
        token: token.trim(),
        slug: slug.trim(),
        title: titleText,
        html,
        tags: tagsOf(fmRef.current),
        date: date(),
      });
      const full = base + data.url;
      setPubUrl(full);
      setPubMsg(t("pubOk"));
      setPubState("done");
      setPublishConfig({ serverUrl: base, token: token.trim() });
      fmRef.current.slug = slug.trim();
      fmRef.current.publishedAt = new Date().toISOString();
      noteService.requestSave();
    } catch (e: any) {
      console.error(e);
      setPubState("error");
      setPubMsg(t("pubFail", { msg: e?.message ?? String(e) }));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <button className="btn-ghost !py-1" onClick={onBack}>
          {t("backToNote")}
        </button>
        <span className="text-sm font-medium text-ink">{t("publishTitle")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-10">
          {/* 方式一：单文件 HTML */}
          <section className="rounded-lg border border-line p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-ink">{t("exportHtmlTitle")}</div>
                <div className="mt-1 text-xs leading-relaxed text-soft">
                  {t("exportHtmlDesc")}
                </div>
              </div>
              <button className="btn-outline shrink-0" disabled={exportState === "busy"} onClick={doExport}>
                {exportState === "busy" ? t("exporting") : t("exportNow")}
              </button>
            </div>
            {exportMsg && (
              <div className={`mt-2 text-xs ${exportState === "error" ? "text-red-600" : "text-green-700"}`}>
                {exportMsg}
              </div>
            )}
          </section>

          {/* 方式二：发布到服务器 */}
          <section className="mt-4 rounded-lg border border-line p-5">
            <div className="text-sm font-medium text-ink">{t("pubServerTitle")}</div>
            <div className="mt-1 text-xs leading-relaxed text-soft">
              {t("pubServerDesc")}
            </div>
            <div className="mt-4 grid gap-2">
              <input
                className="input"
                placeholder={t("serverPlaceholder")}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
              <input
                className="input"
                placeholder={t("tokenPlaceholder")}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-soft">{t("linkPath")}</span>
                <div className="flex flex-1 items-center rounded-md border border-line-strong bg-surface">
                  <span className="pl-2 text-xs text-faint">/p/</span>
                  <input
                    className="w-full rounded-r-md px-1 py-1.5 text-sm outline-none"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.replace(/[^\w-]/g, ""))}
                  />
                </div>
                <button
                  className="shrink-0 text-xs text-faint hover:text-soft"
                  title={t("shuffleTip")}
                  onClick={() => setSlug(randomSlug())}
                >
                  {t("shuffle")}
                </button>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              {pubState === "done" && pubUrl ? (
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    className="truncate text-xs text-amber-700 underline"
                    href={pubUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {pubUrl}
                  </a>
                  <button
                    className="btn-outline !px-2 !py-1 text-xs"
                    onClick={async () => {
                      await navigator.clipboard.writeText(pubUrl);
                      setCopied(true);
                    }}
                  >
                    {copied ? `${I.check} ${t("copied")}` : t("copyLink")}
                  </button>
                </div>
              ) : (
                <span
                  className={`text-xs ${pubState === "error" ? "text-red-600" : "text-soft"}`}
                >
                  {pubMsg || t("pubOverwrite")}
                </span>
              )}
              <button className="btn-primary shrink-0" disabled={pubState === "busy"} onClick={doPublish}>
                {pubState === "busy" ? t("publishing") : t("publish")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function randomSlug() {
  return Math.random().toString(36).slice(2, 8);
}
