export default function EmptyState({ vaultName, onNewNote }: { vaultName: string; onNewNote: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-stone-400">
      <div className="serif text-xl text-stone-600">{vaultName}</div>
      <p className="text-sm">左侧选择一篇笔记，或</p>
      <button className="btn-outline" onClick={onNewNote}>
        新建笔记
      </button>
    </div>
  );
}
