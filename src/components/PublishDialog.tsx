import { useEffect, useState } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { backend } from "../backend";
import { getPublishConfig, setPublishConfig } from "../lib/config";
import { tagsOf } from "../lib/frontmatter";
import { composeArticleHtml, inlineAssets } from "../lib/exportHtml";
import { I } from "./icons";

interface Props {
  editor: TipTapEditor;
  pathRef: { current: string };
  fmRef: { current: Record<string, unknown> };
  title: { current: string };
  onClose: () => void;
}

export default function PublishDialog({ editor, fmRef, title, onClose }: Props) {
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
      const t = title.current.trim() || "无标题";
      const doc = await composeArticleHtml(t, html, {
        tags: tagsOf(fmRef.current),
        date: date(),
      });
      const fileName = `${t.replace(/[\\/:*?"<>|]/g, "_")}.html`;
      const saved = await backend.saveTextFile(fileName, doc);
      if (saved === null) {
        // 浏览器开发模式：直接触发下载
        const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
        setExportMsg(`已下载 ${fileName}（单文件，图片已内嵌，双击即可打开）`);
      } else {
        setExportMsg(`已导出到 ${saved}`);
      }
      setExportState("done");
    } catch (e) {
      console.error(e);
      setExportState("error");
      setExportMsg("导出失败，请看控制台");
    }
  };

  const doPublish = async () => {
    const base = serverUrl.trim().replace(/\/+$/, "");
    if (!base) {
      setPubState("error");
      setPubMsg("请先填写服务器地址");
      return;
    }
    if (!slug.trim()) {
      setPubState("error");
      setPubMsg("请填写路径名 slug");
      return;
    }
    setPubState("busy");
    setPubMsg("");
    setCopied(false);
    try {
      const html = await inlineAssets(editor.getHTML());
      const t = title.current.trim() || "无标题";
      const res = await fetch(`${base}/api/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({
          slug: slug.trim(),
          title: t,
          html,
          tags: tagsOf(fmRef.current),
          date: date(),
        }),
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      }
      const data = (await res.json()) as { url: string };
      const full = base + data.url;
      setPubUrl(full);
      setPubMsg("发布成功！");
      setPubState("done");
      setPublishConfig({ serverUrl: base, token: token.trim() });
      // 记回 frontmatter，下次默认复用同一 slug
      fmRef.current.slug = slug.trim();
      fmRef.current.publishedAt = new Date().toISOString();
      window.dispatchEvent(new CustomEvent("noteshare:save-now"));
    } catch (e: any) {
      console.error(e);
      setPubState("error");
      setPubMsg(`发布失败：${e?.message ?? e}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[520px] max-w-full rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="serif text-lg font-bold text-stone-800">发布 / 导出这篇笔记</h2>
          <button className="btn-ghost !px-2" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 方式一：单文件 HTML */}
        <section className="rounded-lg border border-stone-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-stone-800">导出单文件 HTML</div>
              <div className="mt-0.5 text-xs text-stone-500">
                图片全部内嵌成一个 .html 文件，微信/网盘发给别人，双击就能看
              </div>
            </div>
            <button className="btn-outline shrink-0" disabled={exportState === "busy"} onClick={doExport}>
              {exportState === "busy" ? "导出中…" : "立即导出"}
            </button>
          </div>
          {exportMsg && (
            <div className={`mt-2 text-xs ${exportState === "error" ? "text-red-600" : "text-green-700"}`}>
              {exportMsg}
            </div>
          )}
        </section>

        {/* 方式二：发布到服务器 */}
        <section className="mt-4 rounded-lg border border-stone-200 p-4">
          <div className="text-sm font-medium text-stone-800">发布到我的服务器</div>
          <div className="mt-0.5 text-xs text-stone-500">
            文章会传到你部署的发布服务上，任何人通过链接访问（server/publish-server.mjs）
          </div>
          <div className="mt-3 grid gap-2">
            <input
              className="input"
              placeholder="服务器地址，如 http://123.45.67.89:8787"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <input
              className="input"
              placeholder="访问令牌 Token（服务器环境变量 TOKEN）"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-stone-500">链接路径</span>
              <div className="flex flex-1 items-center rounded-md border border-stone-300 bg-white">
                <span className="pl-2 text-xs text-stone-400">/p/</span>
                <input
                  className="w-full rounded-r-md px-1 py-1.5 text-sm outline-none"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.replace(/[^\w-]/g, ""))}
                />
              </div>
              <button
                className="shrink-0 text-xs text-stone-400 hover:text-stone-600"
                title="随机生成"
                onClick={() => setSlug(randomSlug())}
              >
                换一个
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
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
                  {copied ? `${I.check} 已复制` : "复制链接"}
                </button>
              </div>
            ) : (
              <span
                className={`text-xs ${
                  pubState === "error" ? "text-red-600" : "text-stone-500"
                }`}
              >
                {pubMsg || "同一 slug 重复发布会覆盖更新"}
              </span>
            )}
            <button className="btn-primary shrink-0" disabled={pubState === "busy"} onClick={doPublish}>
              {pubState === "busy" ? "发布中…" : "发布"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function randomSlug() {
  return Math.random().toString(36).slice(2, 8);
}
