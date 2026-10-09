import { useSettings } from "../i18n";

export default function EmptyState({ vaultName, onNewNote }: { vaultName: string; onNewNote: () => void }) {
  const { t } = useSettings();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-faint">
      <div className="serif text-xl text-soft">{vaultName}</div>
      <p className="text-sm">{t("emptyHint")}</p>
      <button className="btn-outline" onClick={onNewNote}>
        {t("newNote")}
      </button>
    </div>
  );
}
