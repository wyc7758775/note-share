// 启动页 / 仓库管理器：复刻 Obsidian 原版布局——顶部「新建仓库 / 打开本地仓库」
// 两张动作卡（新建卡点击原地展开为表单），下方已知仓库列表；整页铺满窗口，
// 桌面端此页即小窗（见 backend/window-size.ts），web 预览居中限宽。
// 新建 = 选父目录 + 起名（写入 .noteshare 清单）；打开本地 = 选已有文件夹，
// 兼容直接打开现成的 Obsidian 库。web 模式无系统选目录弹窗：右卡退化为手输路径。

import { useEffect, useState } from "react";
import { useSettings } from "../i18n";
import { useVaultsVersion } from "../domain/vault";
import type { VaultService } from "../application/vault-service";
import { PikachuLogo, I } from "./icons";
import { setPickerWindowSize } from "../backend/window-size";

const LAST_PARENT_KEY = "noteshare.lastVaultParent";

interface Props {
  service: VaultService;
  onOpen: (path: string) => Promise<void>;
  /** 从主界面"管理仓库"进来时可返回当前仓库；冷启动时没有 */
  onBack?: () => void;
}

export default function VaultSwitcher({ service, onOpen, onBack }: Props) {
  const { t } = useSettings();
  useVaultsVersion(service.registry); // 移除/打开仓库后列表即时刷新
  const vaults = service.registry.list();
  const canManage = service.canManage;

  const [creating, setCreating] = useState(false); // 新建卡展开为表单（Obsidian 式）
  const [name, setName] = useState("");
  const [location, setLocation] = useState(() => localStorage.getItem(LAST_PARENT_KEY) ?? "");
  const [webPath, setWebPath] = useState(""); // web 模式手输的仓库路径
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 桌面端：从大窗（管理仓库入口）回到此页时缩回 Obsidian 式小窗
  useEffect(() => {
    void setPickerWindowSize();
  }, []);

  useEffect(() => {
    localStorage.setItem(LAST_PARENT_KEY, location);
  }, [location]);

  const browse = async () => {
    const dir = await service.pickFolder();
    if (dir) setLocation(dir);
  };

  const create = async () => {
    if (!name.trim() || !location.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const ref = await service.create(location.trim(), name.trim());
      setName("");
      setCreating(false);
      await onOpen(ref.path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openLocal = async () => {
    const dir = await service.pickFolder();
    if (!dir) return;
    setBusy(true);
    setErr(null);
    try {
      await onOpen(dir);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openListed = async (path: string) => {
    setBusy(true);
    setErr(null);
    try {
      await onOpen(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vault-switcher">
      <header className="vs-head">
        <div className="flex items-center gap-2.5">
          <PikachuLogo size={26} className="text-ink" />
          <span className="serif text-[17px] font-semibold text-ink">NoteShare</span>
        </div>
        {onBack && (
          <button className="vs-back" onClick={onBack}>
            {I.back}
            {t("backToVault")}
          </button>
        )}
      </header>

      <div className="vs-body">
        <div className="vs-cards">
          {creating ? (
            <section className="vs-form">
              <h3 className="vs-card-title">{t("newVault")}</h3>
              <label className="vs-field">
                <span>{t("vaultNameLabel")}</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) void create();
                  }}
                  placeholder={t("newVaultNamePh")}
                />
              </label>
              <label className="vs-field">
                <span>{t("locationLabel")}</span>
                <div className="vs-loc">
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t("locationPh")}
                  />
                  <button className="btn-ghost" onClick={browse}>
                    {t("browse")}
                  </button>
                </div>
              </label>
              <div className="mt-1 flex justify-end gap-2">
                <button className="btn-ghost" disabled={busy} onClick={() => setCreating(false)}>
                  {t("cancel")}
                </button>
                <button
                  className="btn-primary"
                  disabled={busy || !name.trim() || !location.trim()}
                  onClick={create}
                >
                  {t("createVaultBtn")}
                </button>
              </div>
            </section>
          ) : (
            <button className="vs-card" onClick={() => setCreating(true)}>
              <span className="vs-card-icon">
                <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M1.75 4.75A1.5 1.5 0 0 1 3.25 3.25h2.6l1.4 1.75h5.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                  <path
                    d="M8 7.25v4M6 9.25h4"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="vs-card-name">{t("newVault")}</span>
              <span className="vs-card-hint">{t("createVaultHint")}</span>
            </button>
          )}

          {canManage ? (
            <button className="vs-card" disabled={busy} onClick={openLocal}>
              <span className="vs-card-icon">
                <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M1.75 4.75A1.5 1.5 0 0 1 3.25 3.25h2.6l1.4 1.75h5.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
              </span>
              <span className="vs-card-name">{t("openLocalVault")}</span>
              <span className="vs-card-hint">{t("openLocalHint")}</span>
            </button>
          ) : (
            // web 模式没有系统选目录弹窗：卡片退化为手输路径直接打开
            <div className="vs-card vs-card-static">
              <span className="vs-card-icon">
                <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M1.75 4.75A1.5 1.5 0 0 1 3.25 3.25h2.6l1.4 1.75h5.5a1.5 1.5 0 0 1 1.5 1.5v5.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7z"
                    stroke="currentColor"
                    strokeWidth="1.1"
                  />
                </svg>
              </span>
              <span className="vs-card-name">{t("openLocalVault")}</span>
              <div className="vs-loc">
                <input
                  value={webPath}
                  onChange={(e) => setWebPath(e.target.value)}
                  placeholder={t("vaultPathPh")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && webPath.trim() && !busy) void openListed(webPath.trim());
                  }}
                />
                <button
                  className="btn-ghost"
                  disabled={busy || !webPath.trim()}
                  onClick={() => void openListed(webPath.trim())}
                >
                  {t("openPathBtn")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="vs-vaults">
          <h2 className="vs-title">{t("vaults")}</h2>
          {vaults.length === 0 && <p className="vs-empty">{t("noVaultsYet")}</p>}
          {vaults.map((v) => (
            <div
              key={v.id}
              className={`vs-vault ${v.exists ? "" : "missing"}`}
              role="button"
              tabIndex={v.exists ? 0 : -1}
              onClick={() => v.exists && !busy && void openListed(v.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && v.exists && !busy) void openListed(v.path);
              }}
            >
              <span className="shrink-0 text-faint">{I.folder}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{v.name}</span>
                <span className="block truncate text-[11px] text-faint" title={v.path}>
                  {v.path}
                </span>
              </span>
              <button
                className="vs-remove"
                title={t("removeVaultTip")}
                onClick={(e) => {
                  e.stopPropagation();
                  void service.remove(v.path);
                }}
              >
                {I.trash}
              </button>
            </div>
          ))}
        </div>

        {!canManage && <p className="vs-webnote">{t("vaultWebTip")}</p>}
        {err && <p className="vs-err">{err}</p>}
      </div>
    </div>
  );
}
