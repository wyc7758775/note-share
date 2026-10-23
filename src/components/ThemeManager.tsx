// 主题方案管理（Phase 2）：内置主题 + 自定义主题列表，新建/重命名/删除/复制 JSON/粘贴导入。
// 只发命令给 Preferences 聚合（useSettings 投影），不碰 localStorage/DOM。
// 自定义主题的 base 与当前亮/暗模式不匹配时回退内置（服务端 apply 时判定），这里给提示。

import { useState } from "react";
import { useSettings, type CustomTheme } from "../i18n";
import { BUILTIN_DARK, BUILTIN_LIGHT } from "../domain/theme-tokens";

function ThemeRow({
  label,
  sub,
  active,
  onSelect,
  actions,
}: {
  label: React.ReactNode;
  sub: string;
  active: boolean;
  onSelect: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
        active ? "bg-[var(--active-bg)]" : "hover:bg-[var(--surface-hover)]"
      }`}
      onClick={onSelect}
    >
      <span
        className="h-2.5 w-2.5 flex-none rounded-full border"
        style={{
          borderColor: active ? "var(--accent)" : "var(--line-strong)",
          background: active ? "var(--accent)" : "transparent",
        }}
      />
      <span className="min-w-0 flex-1">
        <span
          className="block text-[12.5px] leading-snug"
          style={{ color: "var(--ink)", overflowWrap: "anywhere" }}
        >
          {label}
        </span>
        <span
          className="block text-[11px] leading-snug"
          style={{ color: "var(--ink-faint)", overflowWrap: "anywhere" }}
        >
          {sub}
        </span>
      </span>
      {actions && (
        <span className="flex flex-none items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  );
}

const MiniBtn = ({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) => (
  <button
    className="rounded px-1.5 py-0.5 text-[11px] text-faint hover:bg-[var(--surface-hover)] hover:text-soft"
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
);

export default function ThemeManager() {
  const {
    t,
    dark,
    themeId,
    setThemeId,
    customThemes,
    saveTheme,
    removeTheme,
    nextThemeId,
  } = useSettings();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyJson = async (theme: CustomTheme) => {
    await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
    setCopiedId(theme.id);
    window.setTimeout(() => setCopiedId((v) => (v === theme.id ? null : v)), 1500);
  };

  const copyBuiltin = async () => {
    const tpl: CustomTheme = {
      id: "",
      name: dark ? t("themeBaseDark") : t("themeBaseLight"),
      base: dark ? "dark" : "light",
      tokens: { ...(dark ? BUILTIN_DARK : BUILTIN_LIGHT) },
    };
    await navigator.clipboard.writeText(JSON.stringify(tpl, null, 2));
    setCopiedId("builtin");
    window.setTimeout(() => setCopiedId((v) => (v === "builtin" ? null : v)), 1500);
  };

  const commitRename = (id: string) => {
    const theme = customThemes.find((x) => x.id === id);
    const name = nameDraft.trim();
    if (theme && name) saveTheme({ ...theme, name });
    setRenamingId(null);
  };

  const commitImport = () => {
    try {
      const parsed: unknown = JSON.parse(importText);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      let ok = 0;
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const o = item as Partial<CustomTheme>;
        if (!o.tokens || typeof o.tokens !== "object") continue;
        const base = o.base === "dark" ? "dark" : "light";
        const name =
          typeof o.name === "string" && o.name.trim() ? o.name.trim() : t("themeNamePh");
        saveTheme({ id: nextThemeId(), name, base, tokens: o.tokens as CustomTheme["tokens"] });
        ok++;
      }
      if (ok) {
        setImporting(false);
        setImportText("");
      }
    } catch {
      /* JSON 不合法：保留输入让用户修改 */
    }
  };

  const newTheme = () => {
    const name = t("themeNew");
    const id = nextThemeId();
    saveTheme({ id, name: `${name} ${customThemes.length + 1}`, base: dark ? "dark" : "light", tokens: {} });
  };

  const mode = dark ? "dark" : "light";

  return (
    <div className="grid gap-1.5">
      <ThemeRow
        label={t("themeBuiltin")}
        sub={dark ? t("themeBaseDark") : t("themeBaseLight")}
        active={themeId === null}
        onSelect={() => setThemeId(null)}
        actions={
          <MiniBtn onClick={() => void copyBuiltin()} title={t("themeExport")}>
            {copiedId === "builtin" ? t("themeCopied") : t("themeExport")}
          </MiniBtn>
        }
      />
      {customThemes.map((th) => (
        <ThemeRow
          key={th.id}
          label={
            renamingId === th.id ? (
              <input
                autoFocus
                className="w-full rounded border-none bg-transparent px-0.5 py-0 text-[12.5px] outline-none"
                style={{ color: "var(--ink)", boxShadow: "inset 0 0 0 1px var(--accent)" }}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => commitRename(th.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(th.id);
                  if (e.key === "Escape") setRenamingId(null);
                  e.stopPropagation();
                }}
              />
            ) : (
              th.name
            )
          }
          sub={`${th.base === "dark" ? t("themeBaseDark") : t("themeBaseLight")}${
            th.base !== mode ? ` · ${t("themeNotActive")}` : ""
          }`}
          active={themeId === th.id}
          onSelect={() => setThemeId(th.id)}
          actions={
            <>
              <MiniBtn
                onClick={() => {
                  setRenamingId(th.id);
                  setNameDraft(th.name);
                }}
                title={t("themeRename")}
              >
                ✎
              </MiniBtn>
              <MiniBtn onClick={() => void copyJson(th)} title={t("themeExport")}>
                {copiedId === th.id ? t("themeCopied") : "⧉"}
              </MiniBtn>
              <MiniBtn onClick={() => removeTheme(th.id)} title={t("themeDelete")}>
                ✕
              </MiniBtn>
            </>
          }
        />
      ))}
      {importing ? (
        <div className="grid gap-1.5 pt-1">
          <textarea
            autoFocus
            className="h-24 w-full resize-none rounded-md border-none bg-[var(--surface-hover)] p-2 text-[11.5px] outline-none"
            style={{ color: "var(--ink)", boxShadow: "inset 0 0 0 1px var(--line)" }}
            placeholder={t("themeImportPh")}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setImporting(false);
            }}
          />
          <div className="flex justify-end gap-2">
            <button className="text-[11px] text-faint hover:text-soft" onClick={() => setImporting(false)}>
              {t("cancel")}
            </button>
            <button className="btn-primary !px-3 !py-1 text-[11.5px]" onClick={commitImport}>
              {t("themeImport")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 pt-1">
          <button className="btn-outline flex-1 !px-2 !py-1 text-[11.5px]" onClick={newTheme}>
            ＋ {t("themeNew")}
          </button>
          <button
            className="btn-outline flex-1 !px-2 !py-1 text-[11.5px]"
            onClick={() => setImporting(true)}
          >
            ⤓ {t("themeImport")}
          </button>
        </div>
      )}
    </div>
  );
}
