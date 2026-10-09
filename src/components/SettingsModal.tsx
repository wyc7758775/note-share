// 设置弹窗：语言 / 主题。遮罩 + 居中卡片 + 缩放淡入；Esc 或点遮罩关闭。
import { useEffect } from "react";
import { useSettings, type Lang, type Theme } from "../i18n";

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
  const { t, lang, setLang, theme, setTheme } = useSettings();

  // 语言切换涉及编辑器实例等一次性初始化的文案，直接刷新页面最稳妥（主题是纯 CSS，无需刷新）
  const changeLang = (l: Lang) => {
    if (l === lang) return;
    localStorage.setItem("noteshare.lang", l);
    location.reload();
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
        </div>
      </div>
    </div>
  );
}
