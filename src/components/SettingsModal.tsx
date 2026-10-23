// 设置弹窗：左侧导航（外观 / 光标 / 主题方案 / 关于）+ 右侧内容面板。
// 遮罩 + 居中卡片 + 缩放淡入；Esc 或点遮罩关闭。
import { useEffect, useState } from "react";
import { useSettings, DEFAULT_ACCENT, type AccentColors, type Lang } from "../i18n";
import ThemeManager from "./ThemeManager";
import { Icon, type IconName } from "./icons";
import {
  checkForUpdates,
  clearHotUpdate,
  getUpdates,
  initUpdater,
  startUpdate,
  updatePercent,
  useUpdates,
} from "../updater/store";

/* ---------- 原子控件 ---------- */

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

/** 滑杆行：标签 + 数值 + range（范围/钳制在领域层，UI 只发命令） */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  defaultValue,
  resetLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue: number;
  resetLabel: string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="settings-label">{label}</span>
        <span className="settings-value">
          {value}
          {unit}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="settings-range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button className="settings-reset" onClick={() => onChange(defaultValue)}>
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

/** 开关（布尔项） */
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="settings-label">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        className="settings-switch"
        style={{ background: value ? "var(--accent)" : "var(--line-strong)" }}
        onClick={() => onChange(!value)}
      >
        <span
          className="settings-switch-knob"
          style={{ left: value ? "1.067rem" : "0.133rem" }}
        />
      </button>
    </div>
  );
}

/** 主题模式卡片：亮 / 暗 / 跟随系统（预览块用固定色，不随应用主题变化） */
function ThemeModeCard({
  mode,
  label,
  active,
  onClick,
}: {
  mode: "light" | "dark" | "system";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`theme-mode-card ${active ? "active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className={`theme-mode-preview preview-${mode}`} aria-hidden>
        <span className="preview-side" />
        <span className="preview-main">
          <i />
          <i className="w-3/5" />
          <i className="w-4/5" />
        </span>
      </span>
      <span className="theme-mode-label">{label}</span>
      {active && (
        <span className="theme-mode-check" aria-hidden>
          ✓
        </span>
      )}
    </button>
  );
}

/** 十六进制输入：合法即写领域层，非法回弹（颜色由 input[type=color] 选，这里只做精确值） */
function HexInput({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [draft, setDraft] = useState(value);
  // props 变化时同步草稿（渲染期调整，不用 effect）
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(value);
  }
  const commit = () => {
    if (/^#[0-9a-fA-F]{6}$/.test(draft)) onChange(draft.toLowerCase());
    else setDraft(value);
  };
  return (
    <input
      className="settings-hex"
      value={draft}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** 色板行：色点（点开系统取色器）+ 名称 + 十六进制值 */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <label className="color-row">
      <span className="color-swatch">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="color-swatch-dot" style={{ background: value }} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <HexInput value={value} onChange={onChange} />
    </label>
  );
}

/** 光标预览：一段文字 + 按当前偏好渲染的闪烁光标 */
function CaretPreview({
  width,
  ratio,
  color,
}: {
  width: number;
  ratio: number;
  color: string;
}) {
  const { t } = useSettings();
  const hex =
    color === "accent" ? "var(--accent)" : color === "ink" ? "var(--ink)" : color;
  return (
    <div className="caret-preview">
      <span className="caret-preview-text">
        {t("caretPreviewText")}
        <span
          className="caret-preview-bar"
          style={{
            width: `${width}px`,
            height: `${Math.round(18 * ratio)}px`,
            background: hex,
          }}
        />
      </span>
    </div>
  );
}

/* ---------- 内容面板 ---------- */

function AppearancePanel() {
  const {
    t,
    lang,
    setLang,
    theme,
    setTheme,
    accent,
    setAccent,
    uiFontSize,
    setUiFontSize,
    editorFontSize,
    setEditorFontSize,
  } = useSettings();

  const changeAccent = (key: keyof AccentColors, value: string) => {
    setAccent({ ...accent, [key]: value });
  };

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3>{t("settingsLanguage")}</h3>
        <Segment<Lang>
          value={lang}
          onChange={setLang}
          options={[
            { value: "zh", label: "中文" },
            { value: "en", label: "English" },
          ]}
        />
      </section>

      <section className="settings-section">
        <h3>{t("settingsTheme")}</h3>
        <div className="theme-mode-row">
          <ThemeModeCard mode="light" label={t("themeLight")} active={theme === "light"} onClick={() => setTheme("light")} />
          <ThemeModeCard mode="dark" label={t("themeDark")} active={theme === "dark"} onClick={() => setTheme("dark")} />
          <ThemeModeCard mode="system" label={t("themeSystem")} active={theme === "system"} onClick={() => setTheme("system")} />
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("settingsUiFont")}</h3>
        <div className="settings-col gap-2.5">
          <SliderRow
            label={t("settingsUiFont")}
            value={uiFontSize}
            min={13}
            max={17}
            step={0.5}
            unit="px"
            defaultValue={15}
            resetLabel={t("settingsFontReset")}
            onChange={setUiFontSize}
          />
          <SliderRow
            label={t("settingsEditorFont")}
            value={editorFontSize}
            min={14}
            max={22}
            step={0.5}
            unit="px"
            defaultValue={16}
            resetLabel={t("settingsFontReset")}
            onChange={setEditorFontSize}
          />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t("settingsAccent")}</h3>
          <button className="settings-reset" onClick={() => setAccent({ ...DEFAULT_ACCENT })}>
            {t("accentReset")}
          </button>
        </div>
        <p className="settings-hint">{t("settingsAccentHint")}</p>
        <div className="settings-col gap-1.5">
          <ColorRow label={t("accentLight")} value={accent.light} onChange={(v) => changeAccent("light", v)} />
          <ColorRow label={t("accentDark")} value={accent.dark} onChange={(v) => changeAccent("dark", v)} />
        </div>
      </section>
    </div>
  );
}

function CaretPanel() {
  const {
    t,
    caretWidth,
    setCaretWidth,
    caretRatio,
    setCaretRatio,
    caretColor,
    setCaretColor,
    typewriter,
    setTypewriter,
    caretAnimate,
    setCaretAnimate,
  } = useSettings();

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>{t("caretPreview")}</h3>
        </div>
        <CaretPreview width={caretWidth} ratio={caretRatio} color={caretColor} />
      </section>

      <section className="settings-section">
        <h3>{t("caretWidth")}</h3>
        <SliderRow
          label={t("caretWidth")}
          value={caretWidth}
          min={1}
          max={6}
          unit="px"
          defaultValue={3}
          resetLabel={t("settingsFontReset")}
          onChange={setCaretWidth}
        />
      </section>

      <section className="settings-section">
        <div className="settings-col gap-2.5">
          <SliderRow
            label={t("caretLength")}
            value={Math.round(caretRatio * 100)}
            min={45}
            max={100}
            step={5}
            unit="%"
            defaultValue={85}
            resetLabel={t("settingsFontReset")}
            onChange={(n) => setCaretRatio(n / 100)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="settings-label">{t("caretColorLabel")}</span>
            <div className="flex items-center gap-2">
              <Segment<string>
                value={caretColor === "accent" || caretColor === "ink" ? caretColor : "custom"}
                onChange={(v) => setCaretColor(v === "custom" ? "#b45309" : v)}
                options={[
                  { value: "accent", label: t("caretColorAccent") },
                  { value: "ink", label: t("caretColorInk") },
                  { value: "custom", label: t("caretColorCustom") },
                ]}
              />
              <span className="color-swatch">
                <input
                  type="color"
                  value={caretColor.startsWith("#") ? caretColor : "#b45309"}
                  onChange={(e) => setCaretColor(e.target.value)}
                />
                <span
                  className="color-swatch-dot"
                  style={{
                    background:
                      caretColor === "accent"
                        ? "var(--accent)"
                        : caretColor === "ink"
                          ? "var(--ink)"
                          : caretColor,
                  }}
                />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-col gap-2.5">
          <Toggle label={t("caretTypewriter")} value={typewriter} onChange={setTypewriter} />
          <Toggle label={t("caretAnimate")} value={caretAnimate} onChange={setCaretAnimate} />
        </div>
      </section>
    </div>
  );
}

function SchemePanel() {
  const { t } = useSettings();
  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3>{t("themeScheme")}</h3>
        <p className="settings-hint">{t("themeSchemeHint")}</p>
        <ThemeManager />
      </section>
    </div>
  );
}

function AboutPanel() {
  const { t } = useSettings();
  const upd = useUpdates();
  const busy =
    upd.phase === "checking" || upd.phase === "downloading" || upd.phase === "installing";
  const ready = upd.clientVersion !== null || upd.hotVersion !== null;

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3>{t("versionSection")}</h3>
        <div className="settings-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="settings-label">{t("versionClient")}</span>
            <span className="settings-value">
              {upd.inApp && upd.appVersion ? `v${upd.appVersion}` : "—"}
            </span>
          </div>
          {upd.inApp && (
            <div className="flex items-center justify-between">
              <span className="settings-label">{t("versionHot")}</span>
              <span className="settings-value">
                {upd.installedHot
                  ? `v${upd.installedHot}${upd.runningHot ? t("versionHotRunning") : ""}`
                  : t("versionHotNone")}
              </span>
            </div>
          )}
        </div>
      </section>

      {upd.inApp && (
        <section className="settings-section">
          {upd.canAuto ? (
            <div className="settings-col gap-2">
              {(upd.phase === "downloading" || upd.phase === "installing") && (
                <div className="update-progress">
                  <i style={{ width: `${updatePercent(upd) ?? 100}%` }} />
                </div>
              )}
              {upd.phase === "checking" && (
                <div className="settings-hint">{t("updateChecking")}</div>
              )}
              {upd.phase === "uptodate" && (
                <div className="settings-hint">{t("updateUpToDate")}</div>
              )}
              {upd.phase === "error" && (
                <div className="text-[0.8rem]" style={{ color: "#dc2626" }}>
                  {t("updateError")}
                  {upd.error ? `：${upd.error}` : ""}
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="settings-hint">
                  {upd.phase === "downloading"
                    ? `${t("updateDownloading")}${
                        updatePercent(upd) !== null ? ` ${updatePercent(upd)}%` : ""
                      }`
                    : upd.phase === "installing"
                      ? t("updateInstalling")
                      : ""}
                </span>
                {ready ? (
                  <button className="btn-primary text-[0.833rem]" disabled={busy} onClick={startUpdate}>
                    {upd.clientVersion
                      ? `${t("updateDownload")} v${upd.clientVersion}`
                      : `${t("updateHotApply")} v${upd.hotVersion}`}
                  </button>
                ) : (
                  <button
                    className="btn-outline text-[0.833rem]"
                    disabled={upd.phase === "checking"}
                    onClick={() => void checkForUpdates()}
                  >
                    {t("updateCheck")}
                  </button>
                )}
              </div>
              {upd.installedHot && (
                <button
                  className="settings-reset justify-start text-left"
                  onClick={() => void clearHotUpdate()}
                >
                  {t("updateHotClear")}
                </button>
              )}
            </div>
          ) : (
            <p className="settings-hint">{t("updateMacManual")}</p>
          )}
        </section>
      )}
    </div>
  );
}

/* ---------- 弹窗骨架 ---------- */

type NavKey = "appearance" | "caret" | "scheme" | "about";

const NAV: { key: NavKey; labelKey: string; icon: IconName }[] = [
  { key: "appearance", labelKey: "settingsAppearance", icon: "palette" },
  { key: "caret", labelKey: "settingsCaret", icon: "caretThick" },
  { key: "scheme", labelKey: "themeScheme", icon: "swatch" },
  { key: "about", labelKey: "settingsAbout", icon: "info" },
];

const DESC_KEY: Record<NavKey, string> = {
  appearance: "settingsAppearanceDesc",
  caret: "settingsCaretDesc",
  scheme: "themeSchemeDesc",
  about: "settingsAboutDesc",
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const [active, setActive] = useState<NavKey>("appearance");

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
        <div className="settings-head">
          <span className="settings-title">{t("settings")}</span>
          <button className="top-icon-btn" data-tip={t("closeEsc")} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label={t("settings")}>
            {NAV.map((item) => (
              <button
                key={item.key}
                className={`settings-nav-item ${active === item.key ? "active" : ""}`}
                onClick={() => setActive(item.key)}
              >
                <Icon name={item.icon} size="sm" />
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </nav>
          <div className="settings-body">
            <div className="settings-panel-head">
              <h2>{t(NAV.find((n) => n.key === active)!.labelKey)}</h2>
              <p>{t(DESC_KEY[active])}</p>
            </div>
            {active === "appearance" && <AppearancePanel />}
            {active === "caret" && <CaretPanel />}
            {active === "scheme" && <SchemePanel />}
            {active === "about" && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
