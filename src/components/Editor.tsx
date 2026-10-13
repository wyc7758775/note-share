import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import NoteToc from "./NoteToc";
import { subtreeMarkdown } from "../outline/parse";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { backend } from "../backend";
import { useSettings, translate, currentLang } from "../i18n";
import type { SlashItem } from "./SlashMenu";
import { buildRaw, parseNote, setTags, tagsOf } from "../lib/frontmatter";
import { forEditor, forSave } from "../lib/markdown";
import { useDomain, useDirectoryVersion } from "../domain/provider";
import { sanitizeFileName } from "../lib/files";
import {
  CustomImage,
  EditorStateContext,
  EMPTY_SCENE_JSON,
  emitEditScene,
  VIEW_IMAGE_EVENT,
} from "./ExcalidrawBlock";
import { SmartTaskInput } from "./SmartTaskInput";
import { Wikilink, WikiPreviewCard, emitOpenNote } from "./WikiLink";
import { HomeEmbed } from "./HomeNodeEmbed";
import { AudioBlock } from "./AudioBlock";
import { NODE_MIME } from "./home/outlineKit";
import { requestOpenHome, requestZoomHome } from "../outline/home-bus";
import { createWikiLinkMenu } from "./WikiLinkMenu";
import PublishPanel from "./PublishPanel";
import ImageViewer, { type ViewerImage } from "./ImageViewer";
import { showContextMenu } from "./ContextMenu";
import { createSlashMenu } from "./SlashMenu";
import { I } from "./icons";

type SaveState = "saved" | "dirty" | "saving" | "error";
type View = "note" | "publish";

// 快捷键修饰键的显示名（苹果设备是 Command）
const MOD_KEY = /mac|iphone|ipad|ipod/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ?? ""
)
  ? "⌘"
  : "Ctrl+";

interface Props {
  initialPath: string;
  /** 是否为活动栏：Ctrl+S/E 快捷键只在活动栏生效 */
  active: boolean;
  /** 顶部左上角悬浮的阅读历史导航（作用于活动栏） */
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

export default function Editor({
  initialPath,
  active,
  canBack,
  canForward,
  onBack,
  onForward,
}: Props) {
  const { t } = useSettings();
  const { directory, notes: noteService, positions, sessions, bus, outline } = useDomain();
  useDirectoryVersion(); // 名录变化触发重渲染（双链存在性等）

  // 编辑会话：锁定模式 + 待落盘快照 + 阅读位置（领域登记簿按路径全局持有，
  // 多栏打开同一笔记共享锁定状态；见 domain/session.ts）
  const session = sessions.get(initialPath);
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
  const [locked, setLocked] = useState(() => sessions.mode(initialPath) === "locked"); // 视图镜像（权威在 SessionBook）
  const [view, setView] = useState<View>("note");
  const [sceneRev, setSceneRev] = useState(0);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);

  // wikilink 悬停预览（100ms 防抖后弹出，跟随链接下方；missing 表示目标不存在）
  const [wikiPreview, setWikiPreview] = useState<
    { name: string; path: string | null; top: number; left: number; missing?: boolean } | null
  >(null);
  const hoverWiki = useRef<{ el: Element | null; timer: number | undefined }>({
    el: null,
    timer: undefined,
  });
  const hideWikiPreview = () => {
    window.clearTimeout(hoverWiki.current.timer);
    hoverWiki.current.el = null;
    setWikiPreview(null);
  };

  // 名录（directory）由领域层事件驱动维护，这里不再自建名单；
  // "[[" 菜单候选、双链解析、缺失检测全部问它。

  /** 在当前笔记的同级目录创建笔记（服务发事件，名录/文件树自动更新） */
  const createNoteByName = useCallback(
    async (name: string): Promise<string | null> => {
      const dir = pathRef.current.split("/").slice(0, -1).join("/");
      return noteService.create(name, dir);
    },
    [noteService]
  );

  const wikiLinkExtension = useMemo(
    () =>
      createWikiLinkMenu(
        () => directory.all(),
        (ed, item) => {
          if (item.kind === "note") {
            ed
              .chain()
              .focus()
              .insertContent({ type: "wikilink", attrs: { name: item.name } })
              .run();
            return;
          }
          void (async () => {
            const path = await createNoteByName(item.name);
            if (!path) return;
            ed
              .chain()
              .focus()
              .insertContent({ type: "wikilink", attrs: { name: sanitizeFileName(item.name) } })
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
            title: s("slVoice"),
            desc: s("slVoiceDesc"),
            icon: "🎙",
            keywords: "yuyin voice audio record luzhi mic luyin",
            onSelect: ({ editor, range }) =>
              editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertContent({ type: "audioBlock", attrs: { src: null } })
                .run(),
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
      HomeEmbed,
      AudioBlock,
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
        // 点击双链：目标存在则跳转（Ctrl/⌘+点击当前栏新标签，Ctrl+Shift+点击新栏）；已被删则当场重建并跳转
        click: (_view, event) => {
          const el = (event.target as HTMLElement).closest?.(".wikilink");
          const name = el?.getAttribute("data-name");
          if (!name) return false;
          const ctrl = (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey;
          const opts = { newTab: ctrl, newPane: ctrl && (event as MouseEvent).shiftKey };
          // Home 节点引用：打开 Home 并缩放到该节点
          const homeRef = /^Home#\^([\w-]+)$/.exec(name);
          if (homeRef) {
            requestOpenHome(opts);
            requestZoomHome({ blockId: homeRef[1] });
            return true;
          }
          const hit = directory.resolve(name);
          if (hit.kind === "resolved") {
            emitOpenNote(hit.path, opts);
            return true;
          }
          if (el?.hasAttribute("data-missing")) {
            void (async () => {
              const path = await createNoteByName(name);
              if (path) emitOpenNote(path, opts);
            })();
            return true;
          }
          return false;
        },
        // 悬停双链 100ms 后弹预览卡（在链接下方）；缺失的弹"点击创建"提示
        mouseover: (_view, event) => {
          const el = (event.target as HTMLElement).closest?.(".wikilink");
          const h = hoverWiki.current;
          if (el === h.el) return false; // 仍在同一个链接内
          h.el = el;
          window.clearTimeout(h.timer);
          if (!el) {
            setWikiPreview(null);
            return false;
          }
          const name = el.getAttribute("data-name");
          if (!name) return false;
          const r = el.getBoundingClientRect();
          const hit = directory.resolve(name);
          h.timer = window.setTimeout(() => {
            setWikiPreview({
              name,
              path: hit.kind === "resolved" ? hit.path : null,
              top: r.bottom + 8,
              left: r.left,
              missing: hit.kind === "dangling",
            });
          }, 100);
          return false;
        },
      },
    },
  });

  /** 落盘的唯一路径：标题≠文件名时先走应用服务改名（发 noteRenamed，名录/文件树/
   *  栏内标签路径全靠事件局部刷新），再写正文。防抖保存与卸载兜底共用，
   *  保证标题改动在任何出口（包括防抖窗口内切走笔记）都不丢。 */
  const persist = useCallback(
    async (md: string) => {
      const fileTitle = decodeURIComponent(pathRef.current.split("/").pop() ?? "").replace(
        /\.md$/i,
        ""
      );
      const wanted = titleRef.current.trim();
      if (wanted && wanted !== fileTitle) {
        const safe = sanitizeFileName(wanted);
        if (safe) {
          const newPath = await noteService.rename(pathRef.current, safe);
          if (newPath) {
            pathRef.current = newPath;
          }
        }
      }
      const fm = fmRef.current;
      setTags(fm, splitTags(tagsRef.current));
      const now = new Date().toISOString();
      if (!fm.created) fm.created = now;
      fm.updated = now;
      await backend.writeNote(pathRef.current, buildRaw(fm, md));
    },
    [noteService]
  );

  const saveNow = useCallback(async () => {
    if (!editor || savingRef.current || loadingRef.current || locked) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const md = forSave((editor.storage as any).markdown.getMarkdown() as string);
      session.pendingMarkdown = null; // 已落盘，清掉快照
      await persist(md);
      setSaveState("saved");
    } catch (err) {
      console.error(err);
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }, [editor, locked, persist]);

  // 待保存内容快照：编辑事件发生时（编辑器必然存活）立即留存 markdown 文本到会话对象，
  // 卸载兜底直接写快照——销毁中的编辑器再取内容会拿到旧文档。
  const editorRefLive = useRef<any>(null);
  editorRefLive.current = editor;

  const scheduleSave = useCallback(() => {
    if (loadingRef.current || locked) return;
    setSaveState("dirty");
    try {
      session.pendingMarkdown = editorRefLive.current?.storage?.markdown?.getMarkdown();
    } catch {
      /* 快照失败则留给防抖保存 */
    }
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveNow(), 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // 阅读位置恢复：setContent 同步完成后、浏览器绘制之前直接设置——
      // 首帧就在正确位置，不会出现"先顶部再跳下来"的闪动。
      // 图片/画板预览等异步资源会继续撑高内容，300ms / 1200ms 各静默校正一次
      if (scrollRef.current) {
        const target = positions.recall(initialPath);
        scrollRef.current.scrollTop = target;
        for (const delay of [300, 1200]) {
          window.setTimeout(() => {
            if (!cancelled && scrollRef.current) scrollRef.current.scrollTop = target;
          }, delay);
        }
      }
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

  // 卸载兜底：防抖窗口内切走笔记时，把会话里编辑时刻的快照直接落盘（不碰已销毁的编辑器）。
  // 走 persist 而非裸 writeNote：标题/标签改动在防抖未到点时也一并生效，不会随切换丢失
  useEffect(() => {
    return () => {
      const md = session.pendingMarkdown;
      if (md === null) return;
      session.pendingMarkdown = null;
      void persist(forSave(md)).catch((e) => console.error("卸载兜底保存失败", e));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Workflowy 节点拖入（侧栏搜索行 / 大纲圆点跨视图）：**直接复制成正文**——
  // 取节点子树的 markdown 经 tiptap-markdown 解析后插入落点（非嵌入引用）。
  // drop 可能被 ProseMirror 在编辑器层截停（冒泡到不了 React onDrop），也可能被
  // 注入类通道跳层派发——统一挂在 window 捕获层（所有 drop 必经的第一站），
  // 按坐标判定落点归属本文档
  useEffect(() => {
    if (!editor) return;
    (window as unknown as { __ne?: unknown }).__ne = editor; // 调试：E2E 断言用，发布无影响
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(NODE_MIME)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt?.types.includes(NODE_MIME) || locked) return;
      const el = scrollRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const inside =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return; // 落点不在本文档滚动区：让别的实例/区域处理
      e.preventDefault();
      e.stopPropagation();
      let payload: { source?: string; address?: number[] };
      try {
        payload = JSON.parse(dt.getData(NODE_MIME));
      } catch {
        return;
      }
      const known =
        (payload.source === "search" || payload.source === "home") &&
        Array.isArray(payload.address);
      if (!known) return;
      const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      void (async () => {
        await outline.flush();
        const sub = outline.subtreeAt(payload.address!);
        if (!sub) return;
        const md = subtreeMarkdown(sub)
          // 插入的是正文内容而非待办：剥块引用锚、去掉 [] 复选框标记；
          // 完成态降级为 ~~删除线~~ 文字（信息保留，不带方框）
          .replace(/ \^[\w-]+$/gm, "")
          .replace(/^(\s*)- \[ \] /gm, "$1- ")
          .replace(/^(\s*)- \[x\] (.+)$/gm, "$1- ~~$2~~");
        const parser = (
          editor.storage as unknown as {
            markdown?: { parser?: { parse: (content: string) => string } };
          }
        ).markdown?.parser;
        const html = parser ? parser.parse(md) : md;
        // 不能走 insertContentAt(字符串)：tiptap-markdown 会把字符串再当 markdown
        // 转义成纯文本。解析成文档节点后直接插入事务
        const host = document.createElement("div");
        host.innerHTML = html;
        const parsed = PMDOMParser.fromSchema(editor.state.schema).parse(host);
        const at = coords?.pos ?? editor.state.selection.from;
        editor.view.dispatch(editor.state.tr.insert(at, parsed.content));
        editor.commands.focus();
        scheduleSave();
      })();
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, outline, locked]);

  // Ctrl/Cmd + S 立即保存；Ctrl/Cmd + E 锁定/解锁（与 Obsidian 一致）；
  // 锁定切换经 SessionBook 广播（下方镜像由 lockToggled 驱动，菜单/快捷键同一路径）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return; // 多栏时快捷键只作用于活动栏
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        void saveNow();
      } else if (k === "e") {
        e.preventDefault();
        void saveNow();
        sessions.toggle(pathRef.current); // lockToggled 事件驱动下方镜像更新
      }
    };
    const onLock = (ev: { type: string; path?: string; mode?: "editing" | "locked" }) => {
      if (ev.type !== "lockToggled" || ev.path !== pathRef.current) return;
      setLocked(ev.mode === "locked");
    };
    window.addEventListener("keydown", onKey);
    const offLock = bus.on("lockToggled", onLock as (e: import("../domain/events").DomainEvent) => void);
    return () => {
      window.removeEventListener("keydown", onKey);
      offLock();
    };
  }, [saveNow, active, sessions, bus]);

  // 图片请求查看 / 发布面板请求保存 / 画板保存后刷新笔记内预览
  useEffect(() => {
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
    const onSceneSaved = () => setSceneRev((v) => v + 1);
    window.addEventListener(VIEW_IMAGE_EVENT, onViewImg);
    const offSave = bus.on("saveRequested", onSave);
    const offScene = bus.on("sceneSaved", onSceneSaved);
    return () => {
      window.removeEventListener(VIEW_IMAGE_EVENT, onViewImg);
      offSave();
      offScene();
    };
  }, [saveNow, bus]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const insertExcalidraw = useCallback(async () => {
    if (!editor || locked) return;
    const saved = await backend.saveScene(null, EMPTY_SCENE_JSON, null);
    editor.chain().focus().setImage({ src: saved.scenePath }).run();
    // 新标签打开画板（保留当前笔记标签），关闭标签即回到笔记
    emitEditScene(saved.scenePath);
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

  // ---- 视图切换：发布（整区推入，返回回到笔记） ----
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

  // ---- 笔记视图 ----
  return (
    <EditorStateContext.Provider value={{ rev: sceneRev, locked }}>
      <div className="relative flex h-full flex-col">
        {/* 顶部左上角悬浮：返回 / 前进 / 更多操作（作用于本栏当前笔记） */}
        <div className="editor-nav-float">
          <button className="top-icon-btn" data-tip={t("navBack")} disabled={!canBack} onClick={onBack}>
            {I.back}
          </button>
          <button className="top-icon-btn" data-tip={t("navForward")} disabled={!canForward} onClick={onForward}>
            {I.forward}
          </button>
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
                    sessions.toggle(pathRef.current);
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
                          // 事件驱动：名录/树/阅读位置/分栏（Workspace.clearPath）自动清理
                          void noteService.trash(pathRef.current);
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

        {/* 右缘悬浮目录（浅色隐身，hover 点亮；可收起；窄区自动隐藏） */}
        <NoteToc editor={editor} scrollRef={scrollRef} />

        {/* 正文滚动区 */}
        {/* 正文滚动区 */}
        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            positions.remember(pathRef.current, e.currentTarget.scrollTop);
            setWikiPreview(null); // 滚动时预览卡不再跟随，直接关
          }}
          onMouseLeave={hideWikiPreview}
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
            // 注：Workflowy 节点拖入走上方捕获阶段的原生监听（PM 会截停编辑器内的
            // drop，React onDrop 收不到）；这里只处理图片文件
            for (const f of e.dataTransfer.files) {
              if (f.type.startsWith("image/")) {
                // 已被编辑器消费（插图）：阻断冒泡，免得全局拖放再导一份进 vault
                e.stopPropagation();
                void insertImageFile(f);
              }
            }
          }}
        >
          {/* 保存失败悬浮条（无顶栏设计；贴内容顶部居中） */}
          {saveState === "error" && (
            <div className="sticky top-0 z-20 mx-auto w-fit rounded-b-lg border border-red-300/50 bg-[var(--danger-bg)] px-3 py-1 text-xs text-red-600 dark:text-red-400">
              {t("saveErrorHint", { mod: MOD_KEY })}
              <button
                className="ml-2 underline underline-offset-2"
                onClick={() => void saveNow()}
              >
                {t("retry")}
              </button>
            </div>
          )}
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
              // 失焦/回车立即落盘：改名即时生效（树/标签靠事件局部刷新），不等 1.2s 防抖
              onBlur={() => void saveNow()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
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
                onBlur={() => void saveNow()}
              />
            </div>

            <div className="mt-6 pt-0">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>

        {/* 双链悬停预览卡 */}
        {wikiPreview && (
          <WikiPreviewCard
            key={wikiPreview.path ?? wikiPreview.name}
            name={wikiPreview.name}
            path={wikiPreview.path}
            top={wikiPreview.top}
            left={wikiPreview.left}
            missing={wikiPreview.missing}
          />
        )}

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

// 画板面板按需加载（体积大）
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
