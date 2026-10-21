// 左下角仓库菜单（Obsidian 式）：当前仓库名按钮点开下拉——
// 已知仓库列表（当前项打勾，目录缺失的标灰）+「管理仓库…」回启动页。
// 列表数据来自应用级 VaultRegistry（切仓库时它存活，不随 session 重建）。

import { useEffect, useRef, useState } from "react";
import { useSettings } from "../i18n";
import { useVaultsVersion, type VaultRef } from "../domain/vault";
import type { VaultService } from "../application/vault-service";
import { I } from "./icons";

interface Props {
  service: VaultService;
  current: VaultRef;
  onSwitch: (path: string) => Promise<void>;
  onManage: () => void;
}

export default function VaultMenu({ service, current, onSwitch, onManage }: Props) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useVaultsVersion(service.registry); // 注册表变化（移除/新增仓库）时重渲染

  // 点击菜单外任意处关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const vaults = service.registry.list();

  return (
    <div className="vault-menu" ref={rootRef}>
      <button
        className="vault-menu-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {I.folder}
        <span className="min-w-0 flex-1 truncate">{current.name}</span>
        <span className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`}>
          {I.chevron}
        </span>
      </button>
      {open && (
        <div className="vault-menu-pop">
          {vaults.map((v) => {
            const isCurrent = v.path === current.path;
            return (
              <button
                key={v.id}
                className={`vault-menu-item ${isCurrent ? "current" : ""} ${v.exists ? "" : "missing"}`}
                disabled={!v.exists}
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onSwitch(v.path).catch(showErr);
                }}
              >
                <span className="vm-check">{isCurrent ? I.check : null}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{v.name}</span>
                  <span className="block truncate text-[0.733rem] text-faint">
                    {v.exists ? v.path : `${t("vaultMissing")} · ${v.path}`}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="vault-menu-sep" />
          <button
            className="vault-menu-item"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <span className="vm-check">{I.switchVault}</span>
            <span className="flex-1 text-left">{t("manageVaults")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function showErr(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  alert(msg);
}
