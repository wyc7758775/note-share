import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
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
  EditorStateContext,
  EMPTY_SCENE_JSON,
  EDIT_SCENE_EVENT,
  VIEW_IMAGE_EVENT,
} from "./ExcalidrawBlock";
import { SmartTaskInput } from "./SmartTaskInput";
import PublishPanel from "./PublishPanel";
import ImageViewer, { type ViewerImage } from "./ImageViewer";
import { showContextMenu } from "./ContextMenu";
import { createSlashMenu } from "./SlashMenu";
import { I } from "./icons";

type SaveState = "saved" | "dirty" | "saving" | "error";
type View = "note" | "publish" | "scene";

interface Props {
  initialPath: string;
  onRenamed: (newPath: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onToggleSidebar: () => void;
}

export default function Editor({ initialPath, onRenamed, onDeleted, onToggleSidebar }: Props) {
  const pathRef = useRef(initialPath);
  const fmRef = useRef<Record<string, unknown>>({});
  const titleRef = useRef("");
  const tagsRef = useRef("");
  const loadingRef = useRef(true);
  const savingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false); // 默认可编辑
  const [view, setView] = useState<View>("note");
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [sceneRev, setSceneRev] = useState(0);
  const [delArmed, setDelArmed] = useState(false);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);

  // 斜杠菜单里"图片/画板"两项的落点（延迟绑定到本组件的方法）
  const slashActionsRef = useRef<{ insertImage: () => void; insertScene: () => void } | null>(null);

  titleRef.current = title;
  tagsRef.current = tagsText;

  const slashExtension = useMemo(
    () =>
      createSlashMenu([
        {
          title: "图片",
          desc: "上传本地图片插入笔记",
          icon: "🖼",
          keywords: "image tupian photo",
          onSelect: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            slashActionsRef.current?.insertImage();
          },
        },
        {
          title: "画板",
          desc: "插入 Excalidraw 手绘图",
          icon: "✏",
          keywords: "huaban draw excalidraw shouhui",
          onSelect: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            slashActionsRef.current?.insertScene();
          },
        },
        {
          title: "待办清单",
          desc: "可勾选的任务列表",
          icon: "☑",
          keywords: "todo task daiban",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleTaskList().run(),
        },
        {
          title: "代码块",
          desc: "带语法高亮",
          icon: "{ }",
          keywords: "code daima",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
        },
        {
          title: "引用",
          desc: "摘录或批注",
          icon: "❝",
          keywords: "quote yinyong",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
        },
        {
          title: "分隔线",
          desc: "章节之间的水平线",
          icon: "―",
          keywords: "hr fengexian",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
        },
        {
          title: "一级标题",
          desc: "大标题",
          icon: "H1",
          keywords: "heading biaoti",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
        },
        {
          title: "二级标题",
          desc: "中标题",
          icon: "H2",
          keywords: "heading biaoti",
          onSelect: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
        },
      ]),
    []
  );

  const editor = useEditor({
    extensions: [
      SmartTaskInput,
      slashExtension,
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({
        lowlight: createLowlight(common),
        defaultLanguage: "plaintext",
      }),
      CustomImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始写点什么…（# 标题 · 1. 列表 · - [ ] 待办 · ``` 代码）" }),
      Markdown.configure({ html: false, breaks: false, linkify: false }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "prose-note focus:outline-none", spellcheck: "false" },
    },
  });

  const saveNow = useCallback(async () => {
    if (!editor || savingRef.current || loadingRef.current || locked) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
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
  }, [editor, onRenamed, locked]);

  const scheduleSave = useCallback(() => {
    if (loadingRef.current || locked) return;
    setSaveState("dirty");
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveNow(), 1200);
  }, [saveNow, locked]);

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
      // 把 alt 里的 Obsidian 宽度标记（![alt|300](src)）拆成 width 属性
      if (editor) {
        const tr = editor.state.tr;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "image") {
            const m = String(node.attrs.alt || "").match(/^(.*)\|(\d+)$/);
            if (m) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                alt: m[1],
                width: parseInt(m[2], 10),
              });
            }
          }
          return true;
        });
        if (tr.docChanged) {
          editor.view.dispatch(tr.setMeta("addToHistory", false));
        }
      }
      loadingRef.current = false;
      setLoaded(true);
    })().catch((e) => console.error("读取笔记失败", e));
    return () => {
      cancelled = true;
    };
  }, [initialPath, editor]);

  // 锁定 / 解锁
  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  // 编辑事件 → 自动保存
  useEffect(() => {
    if (!editor) return;
    const cb = () => scheduleSave();
    editor.on("update", cb);
    return () => {
      editor.off("update", cb);
    };
  }, [editor, scheduleSave]);

  // Ctrl/Cmd + S 立即保存
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

  // 画板块请求编辑 / 图片请求查看 / 发布面板请求保存
  useEffect(() => {
    const onEdit = (e: Event) => {
      setEditingScene((e as CustomEvent<string>).detail);
      setView("scene");
    };
    const onViewImg = (e: Event) => {
      const clicked = (e as CustomEvent<string>).detail;
      // 收集当前笔记里的所有普通图片（不含画板预览）组成图片廊
      const imgs = [...document.querySelectorAll(".ProseMirror img")].filter(
        (im) => !(im.parentElement && (im.parentElement as HTMLElement).closest(".excalidraw-fig"))
      );
      const images: ViewerImage[] = imgs.map((im) => ({
        src: (im as HTMLImageElement).src,
        name: (im as HTMLImageElement).alt || undefined,
      }));
      const index = Math.max(0, images.findIndex((x) => x.src === clicked));
      if (images.length) setViewer({ images, index });
    };
    const onSave = () => void saveNow();
    window.addEventListener(EDIT_SCENE_EVENT, onEdit);
    window.addEventListener(VIEW_IMAGE_EVENT, onViewImg);
    window.addEventListener("noteshare:save-now", onSave);
    return () => {
      window.removeEventListener(EDIT_SCENE_EVENT, onEdit);
      window.removeEventListener(VIEW_IMAGE_EVENT, onViewImg);
      window.removeEventListener("noteshare:save-now", onSave);
    };
  }, [saveNow]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const insertExcalidraw = useCallback(async () => {
    if (!editor || locked) return;
    const saved = await backend.saveScene(null, EMPTY_SCENE_JSON, null);
    editor.chain().focus().setImage({ src: saved.scenePath }).run();
    setEditingScene(saved.scenePath);
    setView("scene");
  }, [editor, locked]);

  // 斜杠菜单的两类特殊插入
  useEffect(() => {
    slashActionsRef.current = {
      insertImage: () => fileInputRef.current?.click(),
      insertScene: () => void insertExcalidraw(),
    };
  }, [insertExcalidraw]);

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!editor || locked) return;
      const base64 = await fileToBase64(file);
      const { path } = await backend.saveAsset(file.name, base64);
      editor.chain().focus().setImage({ src: path }).run();
    },
    [editor, locked]
  );

  if (!editor) return null;

  // ---- 视图切换：发布 / 画板（整区推入，返回回到笔记） ----
  if (view === "publish") {
    return (
      <PublishPanel
        editor={editor}
        pathRef={pathRef}
        fmRef={fmRef}
        title={titleRef}
        onBack={() => setView("note")}
      />
    );
  }
  if (view === "scene" && editingScene !== null) {
    return (
      <ExcalidrawPanelLazy
        src={editingScene}
        onBack={() => setView("note")}
        backLabel="← 返回笔记"
        onSaved={() => setSceneRev((v) => v + 1)}
      />
    );
  }

  // ---- 笔记视图 ----
  return (
    <EditorStateContext.Provider value={{ rev: sceneRev, locked }}>
      <div className="flex h-full flex-col">
        {/* 顶栏 */}
        <div
          className="flex h-11 shrink-0 items-center justify-between border-b px-3"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex items-center gap-1">
            <SaveBadge state={saveState} />
          </div>
          <div className="flex items-center gap-1">
            <button
              className={`btn !py-1 ${locked ? "!text-stone-500" : "!text-amber-700 hover:!bg-amber-50"}`}
              title={locked ? "当前锁定，点击切换为可编辑" : "当前可编辑，点击锁定"}
              onClick={() => {
                void saveNow();
                setLocked((v) => !v);
              }}
            >
              {locked ? I.lock : I.unlock}
              <span className="hidden md:inline">{locked ? "已锁定" : "可编辑"}</span>
            </button>
            <span className="mx-1 h-4 w-px bg-stone-300" />
            <button
              className="btn-primary !py-1"
              onClick={async () => {
                await saveNow();
                setDelArmed(false);
                setView("publish");
              }}
            >
              发布 / 导出
            </button>
            {!locked && (
              <button
                className={`btn !py-1 ${delArmed ? "!bg-red-600 !text-white" : "!text-stone-400 hover:!text-red-600"}`}
                title="移入回收站"
                onClick={async () => {
                  if (!delArmed) {
                    setDelArmed(true);
                    window.setTimeout(() => setDelArmed(false), 2600);
                    return;
                  }
                  setDelArmed(false);
                  await backend.deletePath(pathRef.current);
                  await onDeleted();
                }}
              >
                {delArmed ? "确认删除？" : "删除"}
              </button>
            )}
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-200/70 hover:text-stone-700"
              title="收起左侧栏"
              onClick={onToggleSidebar}
            >
              {I.panelLeft}
            </button>
          </div>
        </div>

        {/* 正文滚动区 */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          onContextMenu={(e) => {
            // 画板块有自己的菜单
            if ((e.target as HTMLElement).closest(".excalidraw-fig")) return;
            e.preventDefault();
            const { from, to, empty } = editor.state.selection;
            const selText = empty ? "" : editor.state.doc.textBetween(from, to, " ");
            if (locked) {
              showContextMenu(e.clientX, e.clientY, [
                { label: "复制", disabled: !selText, onClick: () => void navigator.clipboard.writeText(selText) },
                { label: "全选", onClick: () => editor.chain().focus().selectAll().run() },
              ]);
              return;
            }
            showContextMenu(e.clientX, e.clientY, [
              { label: "撤销", disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
              { label: "重做", disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
              { separator: true },
              {
                label: "剪切",
                disabled: !selText,
                onClick: async () => {
                  await navigator.clipboard.writeText(selText);
                  editor.chain().focus().deleteSelection().run();
                },
              },
              { label: "复制", disabled: !selText, onClick: () => void navigator.clipboard.writeText(selText) },
              {
                label: "粘贴",
                onClick: async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    if (t) editor.chain().focus().insertContent(t).run();
                  } catch {
                    /* 剪贴板无权限时静默（Ctrl+V 仍可用） */
                  }
                },
              },
              { separator: true },
              { label: "加粗", checked: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
              { label: "斜体", checked: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
              { label: "删除线", checked: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run() },
              { label: "行内代码", checked: editor.isActive("code"), onClick: () => editor.chain().focus().toggleCode().run() },
              { separator: true },
              { label: "全选", onClick: () => editor.chain().focus().selectAll().run() },
            ]);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (locked) return;
            for (const f of e.dataTransfer.files) {
              if (f.type.startsWith("image/")) void insertImageFile(f);
            }
          }}
        >
          <div className={`mx-auto max-w-3xl px-8 py-10 ${locked ? "read-mode" : ""}`}>
            <input
              className="serif w-full border-none bg-transparent text-3xl font-bold outline-none placeholder:text-stone-300"
              placeholder="无标题"
              readOnly={locked}
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
                readOnly={locked}
                value={loaded ? tagsText : ""}
                onChange={(e) => {
                  setTagsText(e.target.value);
                  scheduleSave();
                }}
              />
            </div>

            <div className="mt-6 pt-0">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImageFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* 共用图片阅览器（图片廊） */}
      {viewer && (
        <ImageViewer
          images={viewer.images}
          index={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </EditorStateContext.Provider>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800"
    >
      {children}
    </button>
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
  return <span className={`px-1 text-xs ${cls}`}>{text}</span>;
}

// 画板面板按需加载（体积大）
const ExcalidrawPanelLazyImpl = lazy(() => import("./ExcalidrawPanel"));
function ExcalidrawPanelLazy(props: {
  src: string;
  onBack: () => void;
  backLabel?: string;
  onSaved: () => void;
}) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-stone-400">画板加载中…</div>}>
      <ExcalidrawPanelLazyImpl {...props} />
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
