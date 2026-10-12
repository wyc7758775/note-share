// 默认界面（空栏时）：个人 logo（线条皮卡丘）+ 新建入口。
// 新建笔记 / 新建白板（行内命名） / 新建手绘；标签条的 ＋ 已移除，这里是主入口。
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../i18n";
import { PikachuLogo, I } from "./icons";

interface Props {
  vaultName: string;
  onNewNote: () => void;
  /** 打开 Home 大纲（固定入口） */
  onOpenHome: () => void;
  /** 白板命名回车后创建（建在库根目录）并打开 */
  onNewCanvas: (name: string) => void;
  /** 新建手绘画板（自动命名）并打开 */
  onNewScene: () => void;
}

export default function EmptyState({ vaultName, onNewNote, onOpenHome, onNewCanvas, onNewScene }: Props) {
  const { t } = useSettings();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

  const commitCanvas = () => {
    setNaming(false);
    const n = name.trim();
    setName("");
    if (n) onNewCanvas(n);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <PikachuLogo size={104} className="text-ink" />
      <div className="serif text-xl text-soft">{vaultName}</div>

      {/* 四个入口等宽（Ctrl+N 角标只占右端，不撑宽差异） */}
      <div className="flex w-[248px] flex-col gap-2">
        <button className="empty-action" onClick={onOpenHome}>
          <span className="empty-action-ico">{I.home}</span>
          <span>{t("homeOpenEntry")}</span>
          <span className="empty-kbd">Ctrl+Shift+H</span>
        </button>

        <button className="empty-action" onClick={onNewNote}>
          <span className="empty-action-ico">{I.note}</span>
          <span>{t("newNote")}</span>
          <span className="empty-kbd">Ctrl+N</span>
        </button>

        {naming ? (
          <input
            ref={inputRef}
            className="empty-input"
            placeholder={t("newCanvasPh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCanvas();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setNaming(false);
                setName("");
              }
              e.stopPropagation();
            }}
            onBlur={commitCanvas}
          />
        ) : (
          <button className="empty-action" onClick={() => setNaming(true)}>
            <span className="empty-action-ico">{I.canvas}</span>
            <span>{t("newCanvas")}</span>
          </button>
        )}

        <button className="empty-action" onClick={onNewScene}>
          <span className="empty-action-ico">{I.pen}</span>
          <span>{t("newScene")}</span>
        </button>
      </div>
    </div>
  );
}
