// web 模式的自绘"选文件夹"弹窗：数据来自 dev-server 的 fs-browse（只读、无状态）。
// 单击子目录进入、双击直接选中；「选择此文件夹」取当前目录。
// dir="" 为虚拟根（Windows 盘符 / unix 根目录一级），此时只能进入不能选。

import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../i18n";
import type { BrowseDir } from "../backend";
import type { VaultService } from "../application/vault-service";
import { I } from "./icons";

interface Props {
  service: VaultService;
  /** 选定一个绝对路径（回填还是打开，由调用方决定） */
  onPick: (path: string) => void;
  onClose: () => void;
}

export default function FolderBrowseDialog({ service, onPick, onClose }: Props) {
  const { t } = useSettings();
  const [info, setInfo] = useState<BrowseDir | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const nav = useCallback(
    async (p: string) => {
      setErr(null);
      try {
        setInfo(await service.browse(p));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [service]
  );

  useEffect(() => {
    void nav("");
  }, [nav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const atRoot = !info || info.dir === "";
  return (
    <div className="settings-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fb-card" role="dialog" aria-label={t("pickFolderTitle")}>
        <div className="fb-head">
          <div className="fb-head-top">
            <span className="fb-title">{t("pickFolderTitle")}</span>
            <button className="top-icon-btn" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="fb-crumb">
            <button
              className="btn-ghost fb-up"
              disabled={atRoot}
              onClick={() => info && void nav(info.parent ?? "")}
            >
              {I.back}
              {t("goUp")}
            </button>
            <span className="fb-path" title={info?.dir || undefined}>
              {atRoot ? t("pickFolderRoot") : info?.dir}
            </span>
          </div>
        </div>
        <div className="fb-list">
          {info === null ? (
            <p className="fb-empty">{err ?? "…"}</p>
          ) : info.folders.length ? (
            info.folders.map((f) => (
              <button
                key={f.path}
                className="fb-item"
                onClick={() => void nav(f.path)}
                onDoubleClick={() => onPick(f.path)}
                title={f.path}
              >
                <span className="shrink-0 text-faint">{I.folder}</span>
                <span className="fb-name">{f.name}</span>
              </button>
            ))
          ) : (
            <p className="fb-empty">{t("emptyFolder")}</p>
          )}
        </div>
        <div className="fb-foot">
          {err && info && <span className="fb-err">{err}</span>}
          <button className="btn-ghost" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="btn-primary" disabled={atRoot} onClick={() => info && onPick(info.dir)}>
            {t("chooseThisFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}
