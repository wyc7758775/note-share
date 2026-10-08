import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { backend } from "../backend";
import { buildRaw, parseNote, setTags, tagsOf } from "../lib/frontmatter";
import { forEditor, forSave } from "../lib/markdown";
import { sanitizeFileName } from "../lib/files";
import {
  CustomImage,
  SceneRevContext,
  EMPTY_SCENE_JSON,
  EDIT_SCENE_EVENT,
} from "./ExcalidrawBlock";
import Toolbar from "./Toolbar";
import PublishDialog from "./PublishDialog";

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Props {
  initialPath: string;
  onRenamed: (newPath: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

export default function Editor({ initialPath, onRenamed, onDeleted }: Props) {
  const pathRef = useRef(initialPath);
  const fmRef = useRef<Record<string, unknown>>({});
  const titleRef = useRef("");
  const tagsRef = useRef("");
  const loadingRef = useRef(true);
  const savingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [publishOpen, setPublishOpen] = useState(false);
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [sceneRev, setSceneRev] = useState(0);
  const [loaded, setLoaded] = useState(false);

  titleRef.current = title;
  tagsRef.current = tagsText;

  const editor = useEditor({
    extensions: [
      StarterKit,
      CustomImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始写点什么…" }),
      Markdown.configure({ html: false, breaks: false, linkify: false }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "prose-note focus:outline-none", spellcheck: "false" },
    },
  });

  const saveNow = useCallback(async () => {
    if (!editor || savingRef.current || loadingRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      // 标题改了 → 先重命名文件（Obsidian：文件名即标题）
      const fileTitle = decodeURIComponent(pathRef.current.split("/").pop() ?? "").replace(
        /\.md$/i,
        ""
      );
      const wanted = titleRef.current.trim();
      if (wanted && wanted !== fileTitle) {
        const safe = sanitizeFileName(wanted);
        if (safe) {
          const newPath = await backend.renamePath(pathRef.current, `${safe}.md`);
          pathRef.current = newPath;
          await onRenamed(newPath);
        }
      }
      // tiptap-markdown 在 editor.storage 上挂载 markdown 序列化器（包自带类型未覆盖到 Storage）
      const md = forSave((editor.storage as any).markdown.getMarkdown() as string);
      const fm = fmRef.current;
      setTags(fm, splitTags(tagsRef.current));
      const now = new Date().toISOString();
      if (!fm.created) fm.created = now;
      fm.updated = now;
      await backend.writeNote(pathRef.current, buildRaw(fm, md));
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }, [editor, onRenamed]);

  const scheduleSave = useCallback(() => {
    if (loadingRef.current) return;
    setSaveState("dirty");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveNow(), 1200);
  }, [saveNow]);

  // 载入笔记
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { raw } = await backend.readNote(initialPath);
      if (cancelled) return;
      const { fm, body } = parseNote(raw);
      fmRef.current = fm;
      loadingRef.current = true;
      setTitle(initialPath.split("/").pop()?.replace(/\.md$/i, "") ?? "");
      setTagsText(tagsOf(fm).join(", "));
      editor?.commands.setContent(forEditor(body));
      loadingRef.current = false;
      setLoaded(true);
    })().catch((e) => console.error("读取笔记失败", e));
    return () => {
      cancelled = true;
    };
  }, [initialPath, editor]);

  // 编辑即触发自动保存
  useEffect(() => {
    if (!editor) return;
    const cb = () => scheduleSave();
    editor.on("update", cb);
    return () => {
      editor.off("update", cb);
    };
  }, [editor, scheduleSave]);

  // Ctrl/Cmd + S 立即保存；卸载前保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  // 画板块请求编辑 / 发布对话框请求保存
  useEffect(() => {
    const onEdit = (e: Event) => setEditingScene((e as CustomEvent<string>).detail);
    const onSave = () => void saveNow();
    window.addEventListener(EDIT_SCENE_EVENT, onEdit);
    window.addEventListener("noteshare:save-now", onSave);
    return () => {
      window.removeEventListener(EDIT_SCENE_EVENT, onEdit);
      window.removeEventListener("noteshare:save-now", onSave);
    };
  }, [saveNow]);

  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current);
    };
  }, []);

  const insertExcalidraw = useCallback(async () => {
    if (!editor) return;
    const saved = await backend.saveScene(null, EMPTY_SCENE_JSON, null);
    editor.chain().focus().setImage({ src: saved.scenePath }).run();
    setEditingScene(saved.scenePath);
  }, [editor]);

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      const base64 = await fileToBase64(file);
      const { path } = await backend.saveAsset(file.name, base64);
      editor.chain().focus().setImage({ src: path }).run();
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <SceneRevContext.Provider value={sceneRev}>
      <div className="flex h-full flex-col">
        {/* 顶栏 */}
        <div
          className="flex h-11 shrink-0 items-center justify-between border-b px-4"
          style={{ borderColor: "var(--line)" }}
        >
          <SaveBadge state={saveState} />
          <div className="flex items-center gap-2">
            <button
              className="btn-primary !py-1"
              onClick={async () => {
                await saveNow();
                setPublishOpen(true);
              }}
            >
              发布 / 导出
            </button>
            <button
              className="btn-ghost !py-1 text-stone-400 hover:!text-red-600"
              title="移入回收站"
              onClick={async () => {
                if (!window.confirm("确定把这篇笔记移入回收站（.trash）吗？")) return;
                await backend.deletePath(pathRef.current);
                await onDeleted();
              }}
            >
              删除
            </button>
          </div>
        </div>

        {/* 正文滚动区 */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            for (const f of e.dataTransfer.files) {
              if (f.type.startsWith("image/")) void insertImageFile(f);
            }
          }}
        >
          <div className="mx-auto max-w-3xl px-8 py-10">
            <input
              className="serif w-full border-none bg-transparent text-3xl font-bold outline-none placeholder:text-stone-300"
              placeholder="无标题"
              value={loaded ? title : ""}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave();
              }}
            />
            <div className="mt-2 flex items-center gap-2 text-[13px] text-stone-400">
              <span>#</span>
              <input
                className="flex-1 border-none bg-transparent outline-none placeholder:text-stone-300"
                placeholder="标签，用逗号分隔"
                value={loaded ? tagsText : ""}
                onChange={(e) => {
                  setTagsText(e.target.value);
                  scheduleSave();
                }}
              />
            </div>

            <div
              className="mt-4 border-b pb-3"
              style={{ borderColor: "var(--line)" }}
            >
              <Toolbar
                editor={editor}
                onInsertExcalidraw={insertExcalidraw}
                onInsertImageFile={insertImageFile}
              />
            </div>

            <div className="pt-6">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        {editingScene !== null && (
          <ExcalidrawModalLazy
            src={editingScene}
            onClose={() => setEditingScene(null)}
            onSaved={() => setSceneRev((v) => v + 1)}
          />
        )}
        {publishOpen && (
          <PublishDialog
            editor={editor}
            pathRef={pathRef}
            fmRef={fmRef}
            title={titleRef}
            onClose={() => setPublishOpen(false)}
          />
        )}
      </div>
    </SceneRevContext.Provider>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    saved: { text: "已保存", cls: "text-stone-400" },
    dirty: { text: "未保存…", cls: "text-amber-700" },
    saving: { text: "保存中…", cls: "text-stone-400" },
    error: { text: "保存失败（重试：Ctrl+S）", cls: "text-red-600" },
  };
  const { text, cls } = map[state];
  return <span className={`text-xs ${cls}`}>{text}</span>;
}

// Excalidraw 弹窗按需加载（它的体积很大，不该阻塞首屏）
const ExcalidrawModalLazyImpl = lazy(() => import("./ExcalidrawModal"));
function ExcalidrawModalLazy(props: {
  src: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black/30" />}>
      <ExcalidrawModalLazyImpl {...props} />
    </Suspense>
  );
}

function splitTags(s: string): string[] {
  return s
    .split(/[,，]/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
