// 设置弹窗：语言 / 主题 / 主题色 / 版本与更新。遮罩 + 居中卡片 + 缩放淡入；Esc 或点遮罩关闭。
import { useEffect } from "react";
import { useSettings, DEFAULT_ACCENT, type AccentColors, type Lang, type Theme } from "../i18n";
import {
  checkForUpdates,
  clearHotUpdate,
  getUpdates,
  initUpdater,
  startUpdate,
  updatePercent,
  useUpdates,
} from "../updater/store";

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={`seg-item ${o.value === value ? "active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang, theme, setTheme, accent, setAccent } = useSettings();
  const upd = useUpdates();
  const busy =
    upd.phase === "checking" || upd.phase === "downloading" || upd.phase === "installing";
  const ready = upd.clientVersion !== null || upd.hotVersion !== null;

  const changeAccent = (key: keyof AccentColors, value: string) => {
    setAccent({ ...accent, [key]: value });
  };

  // 语言与主题均为局部更新：Context 驱动组件重渲染；编辑器内的词条/占位符
  // 通过 currentLang()（读 <html lang>）惰性读取，无需刷新页面、不丢编辑状态
  const changeLang = (l: Lang) => {
    if (l === lang) return;
    setLang(l);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 打开面板即初始化版本信息；未检查过则顺手查一次（web 模式内部会跳过）
  useEffect(() => {
    void initUpdater().then(() => {
      if (!getUpdates().checked) void checkForUpdates();
    });
  }, []);

  return (
    <div className="settings-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-card" role="dialog" aria-label={t("settings")}>
        <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--line)" }}>
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{t("settings")}</span>
          <button className="top-icon-btn" data-tip={t("closeEsc")} onClick={onClose}>✕</button>
        </div>
        <div className="grid gap-5 px-5 py-5">
          <div className="grid gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>{t("settingsLanguage")}</span>
            <Segment<Lang>
              value={lang}
              onChange={changeLang}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>{t("settingsTheme")}</span>
            <Segment<Theme>
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: t("themeLight") },
                { value: "dark", label: t("themeDark") },
                { value: "system", label: t("themeSystem") },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>{t("settingsAccent")}</span>
              <button
                className="text-[11px] text-faint hover:text-soft"
                onClick={() => setAccent({ ...DEFAULT_ACCENT })}
              >
                {t("accentReset")}
              </button>
            </div>
            <div className="seg" style={{ padding: "6px 10px", gap: 14 }}>
              <label className="flex flex-1 items-center justify-between gap-2 text-[12.5px] text-soft">
                {t("accentLight")}
                <input
                  type="color"
                  value={accent.light}
                  onChange={(e) => changeAccent("light", e.target.value)}
                  className="h-6 w-9 cursor-pointer rounded border-none bg-transparent p-0"
                />
              </label>
              <label className="flex flex-1 items-center justify-between gap-2 text-[12.5px] text-soft">
                {t("accentDark")}
                <input
                  type="color"
                  value={accent.dark}
                  onChange={(e) => changeAccent("dark", e.target.value)}
                  className="h-6 w-9 cursor-pointer rounded border-none bg-transparent p-0"
                />
              </label>
            </div>
          </div>
          {upd.inApp && (
            <div className="grid gap-2">
              <span className="text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
                {t("versionSection")}
              </span>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-soft">{t("versionClient")}</span>
                  <span className="text-ink">{upd.appVersion ? `v${upd.appVersion}` : "—"}</span>
                </div>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-soft">{t("versionHot")}</span>
                  <span className="text-ink">
                    {upd.installedHot
                      ? `v${upd.installedHot}${upd.runningHot ? t("versionHotRunning") : ""}`
                      : t("versionHotNone")}
                  </span>
                </div>
              </div>
              {upd.canAuto ? (
                <>
                  {(upd.phase === "downloading" || upd.phase === "installing") && (
                    <div className="update-progress">
                      <i style={{ width: `${updatePercent(upd) ?? 100}%` }} />
                    </div>
                  )}
                  {upd.phase === "checking" && (
                    <div className="text-[12px] text-faint">{t("updateChecking")}</div>
                  )}
                  {upd.phase === "uptodate" && (
                    <div className="text-[12px] text-faint">{t("updateUpToDate")}</div>
                  )}
                  {upd.phase === "error" && (
                    <div className="text-[12px]" style={{ color: "#dc2626" }}>
                      {t("updateError")}
                      {upd.error ? `：${upd.error}` : ""}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-faint">
                      {upd.phase === "downloading"
                        ? `${t("updateDownloading")}${
                            updatePercent(upd) !== null ? ` ${updatePercent(upd)}%` : ""
                          }`
                        : upd.phase === "installing"
                          ? t("updateInstalling")
                          : ""}
                    </span>
                    {ready ? (
                      <button className="btn-primary text-[12.5px]" disabled={busy} onClick={startUpdate}>
                        {upd.clientVersion
                          ? `${t("updateDownload")} v${upd.clientVersion}`
                          : `${t("updateHotApply")} v${upd.hotVersion}`}
                      </button>
                    ) : (
                      <button
                        className="btn-outline text-[12.5px]"
                        disabled={upd.phase === "checking"}
                        onClick={() => void checkForUpdates()}
                      >
                        {t("updateCheck")}
                      </button>
                    )}
                  </div>
                  {upd.installedHot && (
                    <button
                      className="text-left text-[11px] text-faint hover:text-soft"
                      onClick={() => void clearHotUpdate()}
                    >
                      {t("updateHotClear")}
                    </button>
                  )}
                </>
              ) : (
                <div className="text-[12px] text-faint">{t("updateMacManual")}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
