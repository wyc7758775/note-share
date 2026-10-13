// Home 视图：Workflowy 式大纲（固定入口）。
// 顶部面包屑（zoom 路径）+ 搜索框 + 展开/折叠；正文是 TipTap 大纲编辑器。
// 数据走 OutlineStore（Home.md 内存权威）：编辑防抖落盘、外部改写灌回；
// 缩放/折叠/搜索是文档装饰而非切片，命令与撤销都作用于真实文档。
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { useDomain } from "../../domain/provider";
import { useSettings, currentLang, translate } from "../../i18n";
import HomeBoard from "./HomeBoard";
import HomeToday from "./HomeToday";
import { forEditor, forSave } from "../../lib/markdown";
import { Wikilink, emitOpenNote } from "../WikiLink";
import { InlineAudio, insertVoiceAfterCurrentItem } from "../AudioBlock";
import { createSlashMenu } from "../SlashMenu";
import type { SlashItem } from "../SlashMenu";

import { I } from "../icons";
import {
  consumePendingZoom,
  requestOpenHome,
  requestZoomHome,
  ZOOM_HOME_EVENT,
  type HomeZoomTarget,
} from "../../outline/home-bus";
import {
  OutlineItem,
  OutlineKeys,
  OutlineConflictKeys,
  OutlineDates,
  OutlineNormalize,
  OutlineRibbonHost,
  OutlineStructure,
  OutlineTagSuggest,
  OutlineTags,
  NODE_MIME,
  appendItemCommand,
  applyHomeNodeDrop,
  clearDragSrcHl,
  createOutlineController,
  ensureTodayTarget,
  outlineStructureKey,
  resolveOutlineDropTarget,
  setActiveOutlineController,
  setNodeBoard,
  zoomIsBoard,
  type OutlineController,
  type OutlineCrumb,
} from "./outlineKit";

interface DropHint {
  top: number;
  left: number;
  width: number;
}

export default function HomeView({ active }: { active: boolean }) {
  const { outline, directory } = useDomain();
  const { t } = useSettings();
  const [crumbs, setCrumbs] = useState<OutlineCrumb[]>([{ pos: null, text: "Workflowy" }]);
  const [query, setQuery] = useState("");
  const [hint, setHint] = useState<DropHint | null>(null);
  const [hideDone, setHideDone] = useState(false);
  /** 视图模式：由当前 zoom 节点的 board 属性驱动（看板是节点属性，非全局） */
  const [viewTick, setViewTick] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<OutlineController | null>(null);
  const loadingRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        link: false,
        trailingNode: false,
      }),
      TaskList,
      OutlineItem,
      OutlineStructure,
      OutlineNormalize,
      OutlineKeys,
      OutlineConflictKeys.configure({
        // Ctrl+O 在 Home 内 = 隐藏/显示已完成（阻断全局"聚焦搜索"）
        onToggleHideCompleted: () => ctlRef.current?.toggleHideCompleted(),
      }),
      OutlineTags,
      OutlineTagSuggest,
      OutlineDates,
      OutlineRibbonHost,
      Wikilink,
      InlineAudio,
      // 大纲斜杠菜单：目前只有语音（其余格式在大纲里就是文字/待办语义，不需要块）
      createSlashMenu((): SlashItem[] => [
        {
          title: translate(currentLang(), "slVoice"),
          desc: translate(currentLang(), "slVoiceDesc"),
          icon: "🎙",
          keywords: "yuyin voice audio record luzhi mic luyin",
          onSelect: ({ editor, range }) => insertVoiceAfterCurrentItem(editor, range),
        },
      ]),
      Placeholder.configure({
        // 全文没有任何文字时才提示（每个空行都提示太吵；isEmpty 对列表文档不可靠）
        placeholder: ({ editor }: { editor: { state: { doc: { textContent: string } } } }) =>
          editor.state.doc.textContent.trim() === ""
            ? translate(currentLang(), "homeEmptyHint")
            : "",
      }),
      Markdown.configure({ html: false, breaks: false, linkify: false }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "outline-doc focus:outline-none", spellcheck: "false" },
      handleDOMEvents: {
        click: (_view, event) => {
          // 点击 #tag（官方语义：按该标签过滤，再点同一标签退出过滤）
          const tagEl = (event.target as HTMLElement).closest?.(".outline-tag");
          if (tagEl) {
            // 装饰文本自带 #，剥掉再拼，避免 ## 重复
            const tag = (tagEl.textContent ?? "").replace(/^#/, "").trim();
            const cur = (outlineStructureKey.getState(_view.state)?.query ?? "").replace(/^#/, "");
            const next = cur === tag ? "" : `#${tag}`;
            setQuery(next);
            ctlRef.current?.setQuery(next || null);
            return true;
          }
          const el = (event.target as HTMLElement).closest?.(".wikilink");
          const name = el?.getAttribute("data-name");
          if (!name) return false;
          const ctrl = (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey;
          const opts = { newTab: ctrl, newPane: ctrl && (event as MouseEvent).shiftKey };
          const homeRef = /^Home#\^([\w-]+)$/.exec(name);
          if (homeRef) {
            requestOpenHome(opts);
            requestZoomHome({ blockId: homeRef[1] });
            return true;
          }
          const hit = directory.resolve(name);
          if (hit.kind === "resolved") emitOpenNote(hit.path, opts);
          return true;
        },
        dragover: (view, event) => {
          if (!event.dataTransfer?.types.includes(NODE_MIME)) return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const t = resolveOutlineDropTarget(view, event);
          const host = hostRef.current;
          if (!t || !host) {
            setHint(null);
            return false;
          }
          const hostR = host.getBoundingClientRect();
          // 官方同款三态线：top=目标行上缘、bottom=目标行下缘、child=下缘右移一级(36px)
          const lineTop = t.mode === "top" ? t.rect.top : t.rect.bottom;
          const lineLeft = t.mode === "child" ? t.rect.left + 36 : t.rect.left + 4;
          setHint({
            top: lineTop - hostR.top,
            left: lineLeft - hostR.left,
            width: hostR.right - lineLeft,
          });
          return false;
        },
        dragleave: (view, event) => {
          if (!hostRef.current?.contains(event.relatedTarget as Node)) setHint(null);
          return false;
        },
        dragend: () => {
          setHint(null); // 拖拽取消/结束都要熄掉提示线
          return false;
        },
      },
      handleDrop: (view, event, _slice, _moved) => {
        if (!event.dataTransfer?.types.includes(NODE_MIME)) return false;
        event.preventDefault();
        setHint(null);
        const raw = event.dataTransfer.getData(NODE_MIME);
        if (!raw) return true;
        try {
          const payload = JSON.parse(raw) as { source?: string; pos?: number; address?: number[] };
          // 注意不能用 moved 短路：圆点拖拽发生在编辑器内，PM 必然把它当
          // 内部拖拽（moved=true），短路等于永远吞掉 drop——落点语义由这里全权决定
          const t = resolveOutlineDropTarget(view, event);
          if (!t) return true;
          if (payload.source === "home") {
            return applyHomeNodeDrop(view, payload, t);
          }
          // 侧栏搜索行拖进大纲：不带 pos，按树地址换算当前条目位置后同样移动
          if (payload.source === "search" && Array.isArray(payload.address)) {
            return applyHomeNodeDrop(view, { address: payload.address }, t);
          }
        } catch {
          /* 非法数据忽略 */
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (loadingRef.current) return;
      const md = (editor.storage as any).markdown.getMarkdown() as string;
      outline.edit(forSave(md));
      setCrumbs(ctlRef.current?.crumbs() ?? [{ pos: null, text: "Workflowy" }]);
      setViewTick((x) => x + 1);
    },
  });

  const view: "outline" | "board" = editor && zoomIsBoard(editor) ? "board" : "outline";
  void viewTick;

  // 拖放提示兜底清理：drop 落在编辑器外（工具栏/+按钮/别的分栏）时 PM 的
  // handleDrop 收不到事件，线与源高亮会残留——挂 window 捕获层，落到哪都熄
  useEffect(() => {
    const clear = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(NODE_MIME)) return;
      setHint(null);
      clearDragSrcHl();
    };
    window.addEventListener("drop", clear, true);
    window.addEventListener("dragend", clear, true);
    return () => {
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("dragend", clear, true);
    };
  }, []);

  // Alt+T（官方快捷键）：打开今天的每日笔记
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        if (!editor) return;
        const pos = ensureTodayTarget(editor);
        ctlRef.current?.zoomTo(pos);
        editor.commands.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editor]);

  // ---- 载入 + 控制器装配 ----
  useEffect(() => {
    if (!editor) return;
    const ctl = createOutlineController(editor);
    ctlRef.current = ctl;
    // 载入不进 undo 历史：否则用户 Ctrl+Z 一下会把大纲直接清空回初始空文档
    const loadInto = (md: string) => {
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false);
          return true;
        })
        .setContent(md)
        .run();
    };
    let dead = false;
    void outline.init().then(() => {
      if (dead) return;
      loadingRef.current = true;
      loadInto(forEditor(outline.markdown));
      loadingRef.current = false;
      // 加载期规整（散段收编等）产生的差异直接写回，磁盘格式自愈
      const md = forSave((editor.storage as any).markdown.getMarkdown() as string);
      if (md !== outline.markdown) outline.edit(md);
      setCrumbs(ctl.crumbs());
      applyZoom(consumePendingZoom());
    });
    const onTr = () => {
      setCrumbs(ctl.crumbs());
      setHideDone(ctl.isHideCompleted());
      setViewTick((x) => x + 1); // zoom/节点属性变化 → 视图（board/outline）跟随
    };
    editor.on("transaction", onTr);
    const onZoom = (e: Event) => applyZoom((e as CustomEvent<HomeZoomTarget>).detail);
    window.addEventListener(ZOOM_HOME_EVENT, onZoom);
    return () => {
      dead = true;
      editor.off("transaction", onTr);
      window.removeEventListener(ZOOM_HOME_EVENT, onZoom);
    };
  }, [editor, outline]);

  // 控制器全局注册 + 卸载兜底（flush + 摘牌）
  useEffect(() => {
    if (!editor) return;
    setActiveOutlineController(ctlRef.current);
    (window as unknown as { __oe?: unknown }).__oe = editor; // 调试：E2E 断言用，发布无影响
    outline.registerSync((md) => {
      loadingRef.current = true;
      // 外部改写灌回同样不进历史（不是用户编辑，不能被 undo 撤掉）
      editor
        .chain()
        .command(({ tr }) => {
          tr.setMeta("addToHistory", false);
          return true;
        })
        .setContent(forEditor(md))
        .run();
      loadingRef.current = false;
    });
    return () => {
      clearDragSrcHl();
      delete (window as unknown as { __oe?: unknown }).__oe;
      setActiveOutlineController(null);
      outline.registerSync(null);
      void outline.flush();
    };
  }, [editor, outline]);

  function applyZoom(target: HomeZoomTarget | null) {
    if (!target) return;
    if (target.blockId) ctlRef.current?.zoomToBlockId(target.blockId);
    else if (target.address) ctlRef.current?.zoomToAddress(target.address);
  }

  const onQuery = (q: string) => {
    setQuery(q);
    ctlRef.current?.setQuery(q);
  };

  return (
    <div ref={hostRef} className={`home-view${active ? "" : " home-view-idle"}`} style={{ ["--note-ph" as string]: t("homeNotePh") }}>
      <div className="home-toolbar" contentEditable={false}>
        <div className="home-crumb">
          <button
            className="home-crumb-btn home-crumb-home"
            onClick={() => ctlRef.current?.zoomTo(null)}
            title="Workflowy"
          >
            {I.home}
          </button>
          {crumbs.slice(1).map((c, i) => (
            <span key={`${c.pos ?? "root"}-${i}`} className="home-crumb-item">
              <span className="home-crumb-sep">›</span>
              <button
                className="home-crumb-btn"
                title={c.text}
                onClick={() => ctlRef.current?.zoomTo(c.pos)}
              >
                {c.text}
              </button>
            </span>
          ))}
        </div>
        <span className="flex-1" />
        {/* 看板是节点属性：看板态（=当前 zoom 节点开了 board）显示返回开关，
            返回 = 关掉该节点的 board 属性（写盘持久化） */}
        {view === "board" && editor ? (
          <button
            className="home-view-back"
            contentEditable={false}
            data-tip={t("homeViewOutline")}
            onClick={() => {
              const zoomPos = outlineStructureKey.getState(editor.state)?.zoomPos;
              if (zoomPos != null) setNodeBoard(editor, zoomPos, false);
              editor.commands.focus();
            }}
          >
            <svg width="14" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3h10M3 8h10M3 13h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span>{t("homeBackToList")}</span>
          </button>
        ) : null}
        <button
          className="home-tool-btn"
          data-tip={t("homeToday")}
          onClick={() => {
            if (!editor) return;
            // 官方：菜单栏日历图标 = 打开今天的每日笔记（自动生成），Alt+T 同
            const pos = ensureTodayTarget(editor);
            ctlRef.current?.zoomTo(pos);
            editor.commands.focus();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M2 6.5h12M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="10" r="1.4" fill="currentColor" />
          </svg>
        </button>
        <button
          className={`home-tool-btn${hideDone ? " is-on" : ""}`}
          data-tip={t("homeHideDone")}
          onClick={() => ctlRef.current?.toggleHideCompleted()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 8s2.2-3.8 5.5-3.8S13.5 8 13.5 8s-2.2 3.8-5.5 3.8S2.5 8 2.5 8z" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
          </svg>
        </button>
        <input
          className="home-search"
          placeholder={t("homeSearchPh")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              editor?.commands.focus();
            }
          }}
        />
      </div>
      {view === "outline" ? (
        <div className="home-scroll">
          {/* 官方 Calendar ribbon：仅在 zoom 到日期条目（每日笔记）时出现在编辑区上方 */}
          <HomeToday
            editor={editor}
            onLocate={(addr) => {
              if (editor) ctlRef.current?.zoomToAddress(addr);
            }}
          />
          <div className="home-editor-wrap">
            <div className="outline-root">{editor ? <EditorContent editor={editor} /> : null}</div>
            {/* 列表末尾的 + 快捷新建（Workflowy）：点击在当前视图层级末尾加条目 */}
            <button
              className="outline-add"
              title={t("homeAddItem")}
              style={{ marginLeft: crumbs.length > 1 ? 32 : 0 }}
              onMouseDown={(e) => e.preventDefault()} // 不抢编辑器焦点
              onClick={() => {
                if (!editor) return;
                appendItemCommand(editor);
                editor.commands.focus();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="home-scroll">
          <HomeBoard
            editor={editor}
            onLocate={(addr) => {
              // zoom 切换目标节点，视图由该节点 board 属性自动决定
              if (editor) ctlRef.current?.zoomToAddress(addr);
            }}
          />
        </div>
      )}
      {hint && (
        <div
          className="outline-drop-hint"
          style={{ top: hint.top, left: hint.left, width: hint.width }}
          contentEditable={false}
        />
      )}
    </div>
  );
}
