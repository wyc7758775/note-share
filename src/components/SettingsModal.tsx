// 设置弹窗：语言 / 主题 / 主题色。遮罩 + 居中卡片 + 缩放淡入；Esc 或点遮罩关闭。
import { useEffect } from "react";
import { useSettings, DEFAULT_ACCENT, type AccentColors, type Lang, type Theme } from "../i18n";

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
        </div>
      </div>
    </div>
  );
}
