import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { backend, type TreeNode } from "../backend";
import { useSettings, translate, currentLang } from "../i18n";
import type { SlashItem } from "./SlashMenu";
import { buildRaw, parseNote, setTags, tagsOf } from "../lib/frontmatter";
import { forEditor, forSave } from "../lib/markdown";
import { rememberScroll, recallScroll, moveScrollMemory, forgetScroll } from "../lib/scroll-memory";
import { sanitizeFileName } from "../lib/files";
import {
  CustomImage,
  EditorStateContext,
  EMPTY_SCENE_JSON,
  EDIT_SCENE_EVENT,
  VIEW_IMAGE_EVENT,
} from "./ExcalidrawBlock";
import { SmartTaskInput } from "./SmartTaskInput";
import { Wikilink, emitOpenNote } from "./WikiLink";
import { createWikiLinkMenu, type NoteEntry } from "./WikiLinkMenu";
import PublishPanel from "./PublishPanel";
import ImageViewer, { type ViewerImage } from "./ImageViewer";
import { showContextMenu } from "./ContextMenu";
import { createSlashMenu } from "./SlashMenu";
import { I } from "./icons";

type SaveState = "saved" | "dirty" | "saving" | "error";
type View = "note" | "publish" | "scene";

// 快捷键修饰键的显示名（苹果设备是 Command）
const MOD_KEY = /mac|iphone|ipad|ipod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ?? ""
)
  ? "⌘"
  : "Ctrl+";

interface Props {
  initialPath: string;
  onRenamed: (newPath: string) => Promise<void>;
  onDeleted: () => Promise<void>;
  onToggleSidebar: () => void;
  sideCollapsed: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export default function Editor({
  initialPath,
  onRenamed,
  onDeleted,
  onToggleSidebar,
  sideCollapsed,
  canBack,
  canForward,
  onBack,
  onForward,
}: Props) {
  const { t } = useSettings();
  const pathRef = useRef(initialPath);
  const fmRef = useRef<Record<string, unknown>>({});
  const titleRef = useRef("");
  const tagsRef = useRef("");
  const loadingRef = useRef(true);
  const savingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false); // 默认可编辑
  const [view, setView] = useState<View>("note");
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [sceneRev, setSceneRev] = useState(0);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);

  // "[[" 双链菜单的笔记列表（挂载时拉取，呼出菜单时异步刷新，下次过滤生效）
  const notesRef = useRef<NoteEntry[]>([]);
  const refreshNotes = useCallback(() => {
    void (async () => {
      const flat: NoteEntry[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (n.kind === "note") flat.push({ name: n.name.replace(/\.md$/i, ""), path: n.path });
          else if (n.kind === "folder") walk(n.children ?? []);
        }
      };
      walk(await backend.tree());
      notesRef.current = flat;
    })();
  }, []);
  useEffect(() => {
    refreshNotes();
  }, [refreshNotes]);

  const wikiLinkExtension = useMemo(
    () =>
      createWikiLinkMenu(
        () => notesRef.current,
        (ed, item) => {
          if (item.kind === "note") {
            ed
              .chain()
              .focus()
              .insertContent({ type: "wikilink", attrs: { name: item.name } })
              .run();
            return;
          }
          // 创建新笔记：放在当前笔记的同级文件夹
          const safe = sanitizeFileName(item.name);
          if (!safe) return;
          void (async () => {
            const dir = pathRef.current.split("/").slice(0, -1).join("/");
            const path = await backend.createNote(dir, safe);
            notesRef.current.push({ name: safe, path });
            ed
              .chain()
              .focus()
              .insertContent({ type: "wikilink", attrs: { name: safe } })
              .run();
          })();
        }
      ),
    []
  );

  // 斜杠菜单里"图片/画板"两项的落点（延迟绑定到本组件的方法）
  const slashActionsRef = useRef<{ insertImage: () => void; insertScene: () => void } | null>(null);

  titleRef.current = title;
  tagsRef.current = tagsText;

  // 词条惰性求值：每次呼出菜单时读当前语言，切换语言即时生效且不重建编辑器
  const slashExtension = useMemo(
    () =>
      createSlashMenu((): SlashItem[] => {
        const s = (k: string) => translate(currentLang(), k);
        return [
          {
            title: s("slImage"),
            desc: s("slImageDesc"),
            icon: "🖼",
            keywords: "image tupian photo",
            onSelect: ({ editor, range }) => {
              editor.chain().focus().deleteRange(range).run();
              slashActionsRef.current?.insertImage();
            },
          },
          {
            title: s("slCanvas"),
            desc: s("slCanvasDesc"),
            icon: "✏",
            keywords: "huaban draw excalidraw shouhui",
            onSelect: ({ editor, range }) => {
              editor.chain().focus().deleteRange(range).run();
              slashActionsRef.current?.insertScene();
            },
          },
          {
            title: s("slTask"),
            desc: s("slTaskDesc"),
            icon: "☑",
            keywords: "todo task daiban",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).toggleTaskList().run(),
          },
          {
            title: s("slCode"),
            desc: s("slCodeDesc"),
            icon: "{ }",
            keywords: "code daima",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
          },
          {
            title: s("slQuote"),
            desc: s("slQuoteDesc"),
            icon: "❝",
            keywords: "quote yinyong",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
          },
          {
            title: s("slHr"),
            desc: s("slHrDesc"),
            icon: "―",
            keywords: "hr fengexian",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
          },
          {
            title: s("slH1"),
            desc: s("slH1Desc"),
            icon: "H1",
            keywords: "heading biaoti",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
          },
          {
            title: s("slH2"),
            desc: s("slH2Desc"),
            icon: "H2",
            keywords: "heading biaoti",
            onSelect: ({ editor, range }) =>
              editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
          },
        ];
      }),
    []
  );

  const editor = useEditor({
    extensions: [
      SmartTaskInput,
      slashExtension,
      wikiLinkExtension,
      Wikilink,
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({
        lowlight: createLowlight(common),
        defaultLanguage: "plaintext",
      }),
      CustomImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      // 占位符用函数式读取当前语言（切换语言后无需重建编辑器）
      Placeholder.configure({
        placeholder: () => translate(currentLang(), "editorPlaceholder"),
      }),
      Markdown.configure({ html: false, breaks: false, linkify: false }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "prose-note focus:outline-none", spellcheck: "false" },
      handleDOMEvents: {
        // 点击双链跳转目标笔记（可编辑/锁定态都生效；走原生 DOM 事件最稳）
        click: (_view, event) => {
          const el = (event.target as HTMLElement).closest?.(".wikilink");
          const name = el?.getAttribute("data-name");
          if (!name) return false;
          const hit = notesRef.current.find((n) => n.name === name);
          if (hit) {
            emitOpenNote(hit.path);
            return true;
          }
          return false;
        },
      },
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
          const oldPath = pathRef.current;
          const newPath = await backend.renamePath(pathRef.current, `${safe}.md`);
          pathRef.current = newPath;
          moveScrollMemory(oldPath, newPath);
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
      // 恢复上次的阅读位置（等内容渲染后下一帧再设，高度才够）
      requestAnimationFrame(() => {
        if (!cancelled && scrollRef.current) {
          scrollRef.current.scrollTop = recallScroll(initialPath);
        }
      });
    })().catch((e) => console.error("读取笔记失败", e));
    return () => {
      cancelled = true;
    };
  }, [initialPath, editor]);

  // 阅读位置记忆：滚动时实时写入内存 Map（不依赖卸载时序），刷新页面自然清空

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

  // Ctrl/Cmd + S 立即保存；Ctrl/Cmd + E 锁定/解锁（与 Obsidian 一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveNow();
      } else if (k === "e") {
        e.preventDefault();
        void saveNow();
        setLocked((v) => !v);
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
      <div className="view-swap h-full">
        <PublishPanel
          editor={editor}
          pathRef={pathRef}
          fmRef={fmRef}
          title={titleRef}
          onBack={() => setView("note")}
        />
      </div>
    );
  }
  if (view === "scene" && editingScene !== null) {
    return (
      <div className="view-swap h-full">
        <ExcalidrawPanelLazy
          src={editingScene}
          onBack={() => setView("note")}
          backLabel={t("backToNote")}
          onSaved={() => setSceneRev((v) => v + 1)}
        />
      </div>
    );
  }

  // ---- 笔记视图 ----
  return (
    <EditorStateContext.Provider value={{ rev: sceneRev, locked }}>
      <div className="view-swap flex h-full flex-col">
        {/* 顶栏 */}
        <div
          className="flex h-11 shrink-0 items-center justify-between border-b px-2.5"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex items-center gap-1">
            <button
              className="top-icon-btn"
              data-tip={sideCollapsed ? t("expandSidebar") : t("collapseSidebar")}
              onClick={onToggleSidebar}
            >
              {I.panelLeft}
            </button>
            <button
              className="top-icon-btn"
              data-tip={t("navBack")}
              disabled={!canBack}
              onClick={onBack}
            >
              {I.back}
            </button>
            <button
              className="top-icon-btn"
              data-tip={t("navForward")}
              disabled={!canForward}
              onClick={onForward}
            >
              {I.forward}
            </button>
            {saveState === "error" && (
              <span className="px-1 text-xs text-red-500">{t("saveErrorHint", { mod: MOD_KEY })}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="top-icon-btn"
              data-tip={t("more")}
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                showContextMenu(Math.round(r.left), Math.round(r.bottom + 6), [
                  {
                    label: locked
                      ? t("unlockEdit", { mod: `${MOD_KEY}E` })
                      : t("lockReading", { mod: `${MOD_KEY}E` }),
                    icon: locked ? I.unlock : I.lock,
                    onClick: () => {
                      void saveNow();
                      setLocked((v) => !v);
                    },
                  },
                  { separator: true },
                  {
                    label: t("publishExportMenu"),
                    onClick: () => {
                      void (async () => {
                        await saveNow();
                        setView("publish");
                      })();
                    },
                  },
                  { separator: true },
                  {
                    label: t("deleteNote"),
                    danger: true,
                    disabled: locked,
                    onClick: () => {
                      // 二级确认菜单（与第一级同位置弹出）
                      showContextMenu(Math.round(r.left), Math.round(r.bottom + 6), [
                        {
                          label: t("confirmTrash"),
                          danger: true,
                          onClick: () => {
                            void (async () => {
                              forgetScroll(pathRef.current);
                              await backend.deletePath(pathRef.current);
                              await onDeleted();
                            })();
                          },
                        },
                        { label: t("cancel") },
                      ]);
                    },
                  },
                ]);
              }}
            >
              {I.more}
            </button>
          </div>
        </div>

        {/* 正文滚动区 */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => rememberScroll(pathRef.current, e.currentTarget.scrollTop)}
          onContextMenu={(e) => {
            // 画板块有自己的菜单
            if ((e.target as HTMLElement).closest(".excalidraw-fig")) return;
            e.preventDefault();
            const { from, to, empty } = editor.state.selection;
            const selText = empty ? "" : editor.state.doc.textBetween(from, to, " ");
            if (locked) {
              showContextMenu(e.clientX, e.clientY, [
                { label: t("copy"), disabled: !selText, onClick: () => void navigator.clipboard.writeText(selText) },
                { label: t("selectAll"), onClick: () => editor.chain().focus().selectAll().run() },
              ]);
              return;
            }
            showContextMenu(e.clientX, e.clientY, [
              { label: t("undo"), disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() },
              { label: t("redo"), disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() },
              { separator: true },
              {
                label: t("cut"),
                disabled: !selText,
                onClick: async () => {
                  await navigator.clipboard.writeText(selText);
                  editor.chain().focus().deleteSelection().run();
                },
              },
              { label: t("copy"), disabled: !selText, onClick: () => void navigator.clipboard.writeText(selText) },
              {
                label: t("paste"),
                onClick: async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) editor.chain().focus().insertContent(text).run();
                  } catch {
                    /* 剪贴板无权限时静默（Ctrl+V 仍可用） */
                  }
                },
              },
              { separator: true },
              { label: t("bold"), checked: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run() },
              { label: t("italic"), checked: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run() },
              { label: t("strike"), checked: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run() },
              { label: t("inlineCode"), checked: editor.isActive("code"), onClick: () => editor.chain().focus().toggleCode().run() },
              { separator: true },
              { label: t("selectAll"), onClick: () => editor.chain().focus().selectAll().run() },
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
              className="serif w-full border-none bg-transparent text-3xl font-bold outline-none placeholder:text-faint"
              placeholder={t("untitled")}
              readOnly={locked}
              value={loaded ? title : ""}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave();
              }}
            />
            <div className="mt-2 flex items-center gap-2 text-[13px] text-faint">
              <span>#</span>
              <input
                className="flex-1 border-none bg-transparent outline-none placeholder:text-faint"
                placeholder={t("tagsPlaceholder")}
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
      className="flex h-7 w-7 items-center justify-center rounded-md text-soft transition-colors hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
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
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-sm text-faint">
          {translate(currentLang(), "sceneLoading")}
        </div>
      }
    >
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
