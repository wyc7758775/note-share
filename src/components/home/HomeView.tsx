// Home 视图：Workflowy 式大纲（固定入口）。
// 顶部面包屑（zoom 路径）+ 搜索框 + 展开/折叠；正文是 TipTap 大纲编辑器。
// 数据走 OutlineStore（Home.md 内存权威）：编辑防抖落盘、外部改写灌回；
// 缩放/折叠/搜索是文档装饰而非切片，命令与撤销都作用于真实文档。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { useDomain } from "../../domain/provider";
import { useSettings, currentLang, translate } from "../../i18n";
import { backend } from "../../backend";
import { useCustomCaret } from "../editorCaret";
import type { SearchHit } from "../../backend/types";
import { HOME_PATH } from "../../outline/store";
import HomeToday from "./HomeToday";
import HomeSearchFilters, { type SearchFilter } from "./HomeSearchFilters";
import { forEditor, forSave } from "../../lib/markdown";
import { Wikilink, emitOpenNote } from "../WikiLink";
import { InlineAudio, insertVoiceAfterCurrentItem } from "../AudioBlock";
import { createSlashMenu } from "../SlashMenu";
import type { SlashItem } from "../SlashMenu";
import { I, Icon } from "../icons";
import {
  consumePendingZoom,
  requestOpenHome,
  requestZoomHome,
  NAV_BACK_EVENT,
  NAV_FORWARD_EVENT,
  RESET_HOME_EVENT,
  ZOOM_HOME_EVENT,
  type HomeZoomTarget,
} from "../../outline/home-bus";
import {
  OutlineItem,
  OutlineKeys,
  OutlineConflictKeys,
  OutlineDateChips,
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
  dayEntryDate,
  ensureTodayTarget,
  itemAddressAt,
  itemPosAround,
  resolveOutlineDropTarget,
  setActiveOutlineController,
  type OutlineController,
  type OutlineCrumb,
} from "./outlineKit";
import { openDateChipPicker } from "./DateChipPick";

function hideTagSuggestion() {
  document.querySelector<HTMLElement>(".outline-tag-suggest")?.removeAttribute("data-show");
}

interface DropHint {
  top: number;
  left: number;
  width: number;
}

export default function HomeView({
  active,
  canBack = false,
  canForward = false,
  onBack,
  onForward,
}: {
  active: boolean;
  canBack?: boolean;
  canForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
}) {
  const { outline, directory } = useDomain();
  const { t } = useSettings();
  const [crumbs, setCrumbs] = useState<OutlineCrumb[]>([{ pos: null, text: "Workflowy" }]);
  const [hint, setHint] = useState<DropHint | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [searchFocus, setSearchFocus] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  const [searchAnchor, setSearchAnchor] = useState<{ right: number; top: number } | null>(null);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTerm = searchQuery.trim();
  const term = useMemo(() => {
    if (!searchTerm) return "";
    if (searchFilter === "tags") return "#" + searchTerm.replace(/^#+/, "");
    if (searchFilter === "mentions") return "[[" + searchTerm.replace(/^[[|]]$/g, "") + "]]";
    return searchTerm;
  }, [searchTerm, searchFilter]);
  const searching = term.length > 0;
  const searchFieldOn = searchFocus || searchTerm.length > 0;
  // Home 自己的 zoom 历史：以“条目树地址”为步，面包屑跳级/双击下钻/搜索定位都算一步。
  // 位置(pos)会被上方编辑平移，地址不会；后退可精确回到上一步的层级。
  const [canZoomBack, setCanZoomBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const backStackRef = useRef<number[][]>([]);
  const fwdStackRef = useRef<number[][]>([]);
  const lastZoomAddrRef = useRef<number[]>([]);
  const navRef = useRef(false);
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
      OutlineDateChips,
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
        mousedown: (view, event) => {
          // 点击 #tag 直接搜索：阻止编辑器落光标，避免同时弹出标签自动补全
          const tagHit = (event.target as HTMLElement).closest?.(".outline-tag");
          if (tagHit) {
            event.preventDefault();
            hideTagSuggestion();
            const tag = (tagHit.textContent ?? "").replace(/^#/, "").trim();
            const q = `#${tag}`;
            setSearchFilter("tags");
            setSearchQuery(q);
            ctlRef.current?.setQuery(q);
            setSearchFocus(true);
            requestAnimationFrame(() => {
              searchInputRef.current?.focus();
              hideTagSuggestion();
            });
            return true;
          }
          // 点击日期 chip（官方 dateChip）：不落光标，原地弹日期选择器
          const el = (event.target as HTMLElement).closest?.(".wf-date-chip");
          if (!el || !editor) return false;
          event.preventDefault();
          const itemPos = itemPosAround(view.state.doc, view.posAtDOM(el, 0));
          if (itemPos == null) return true;
          const date = dayEntryDate(view.state.doc, itemPos);
          if (date) openDateChipPicker({ editor, itemPos, date, anchor: el.getBoundingClientRect() });
          return true;
        },
        click: (_view, event) => {
          // 点击 #tag（官方语义：按该标签过滤，再点同一标签退出过滤）
          const tagEl = (event.target as HTMLElement).closest?.(".outline-tag");
          if (tagEl) {
            // 点标签 = 整页立即进入该标签的搜索；顺手关掉无意义的标签补全弹窗
            hideTagSuggestion();
            const tag = (tagEl.textContent ?? "").replace(/^#/, "").trim();
            const q = `#${tag}`;
            setSearchFilter("tags");
            setSearchQuery(q);
            ctlRef.current?.setQuery(q);
            setSearchFocus(true);
            requestAnimationFrame(() => {
              searchInputRef.current?.focus();
              hideTagSuggestion();
            });
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
    },
  });

  // 自定义光标（与笔记编辑器同一套：3px 圆角短条）；大纲常驻可编辑
  const { caret, wrapRef: caretWrapRef, solid } = useCustomCaret(editor, false);

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
      const nextCrumbs = ctl.crumbs();
      setCrumbs(nextCrumbs);
      setHideDone(ctl.isHideCompleted());
      // 记录 zoom 目标变化（地址不变的事务——纯编辑/移动光标——不算一步）
      const z = nextCrumbs[nextCrumbs.length - 1]?.pos ?? null;
      const addr = z == null ? [] : itemAddressAt(editor.state.doc, z);
      if (!addr) return;
      if (addr.join("/") === lastZoomAddrRef.current.join("/")) return;
      if (navRef.current || loadingRef.current) {
        lastZoomAddrRef.current = addr;
        return;
      }
      backStackRef.current.push(lastZoomAddrRef.current);
      lastZoomAddrRef.current = addr;
      fwdStackRef.current = [];
      setCanZoomBack(true);
      setCanFwd(false);
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

  // 搜索是整页模式：查询直接驱动大纲过滤，结果不再弹在搜索框下面。
  useEffect(() => {
    if (!editor) return;
    ctlRef.current?.setQuery(term || null);
  }, [editor, term]);

  // 过滤行贴在搜索框下方（同一张卡）；位置取输入框底边，宽度固定 320。
  useEffect(() => {
    if (!searchFieldOn) return;
    const r = searchBoxRef.current?.getBoundingClientRect();
    const host = hostRef.current?.getBoundingClientRect();
    if (r) setSearchAnchor({ right: window.innerWidth - r.right, top: r.bottom - (host?.top ?? 0) });
  }, [searchFieldOn]);

  // 非 Workflowy 的其它笔记结果：220ms 防抖，显示在过滤后的大纲下方
  useEffect(() => {
    if (!term) {
      setSearchHits([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const rows = await backend.search(term);
        if (!alive) return;
        setSearchHits(rows.filter((h) => h.path !== HOME_PATH).slice(0, 12));
      } catch {
        if (alive) setSearchHits([]);
      }
    }, 220);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  // Ctrl+K 聚焦搜索框；搜索本身不再有弹层
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const resetSearch = useCallback(() => {
    setSearchQuery("");
    setSearchFilter("all");
    setSearchFocus(false);
    ctlRef.current?.setQuery(null);
    searchInputRef.current?.blur();
    editor?.commands.focus();
  }, [editor]);

  // 点击 Home 标签/侧栏 Home/顶栏房子：清空搜索并回到原始大纲
  useEffect(() => {
    const onReset = () => {
      resetSearch();
      ctlRef.current?.zoomTo(null);
    };
    window.addEventListener(RESET_HOME_EVENT, onReset);
    return () => window.removeEventListener(RESET_HOME_EVENT, onReset);
  }, [resetSearch]);

  // Home 的 zoom 步进（后退/前进）：先恢复上一步地址，再落到 App 路由历史。
  // 失败（目标条目已被删除）时跳过该步，继续找可用的上一步。
  const zoomHistoryBack = useCallback((): boolean => {
    const ctl = ctlRef.current;
    if (!ctl || backStackRef.current.length === 0) return false;
    const cur = lastZoomAddrRef.current;
    while (backStackRef.current.length > 0) {
      const prev = backStackRef.current[backStackRef.current.length - 1];
      navRef.current = true;
      const ok = ctl.zoomToAddress(prev);
      if (ok) {
        backStackRef.current.pop();
        fwdStackRef.current.push(cur);
        lastZoomAddrRef.current = prev;
        setCanZoomBack(backStackRef.current.length > 0);
        setCanFwd(true);
        queueMicrotask(() => {
          navRef.current = false;
        });
        return true;
      }
      backStackRef.current.pop();
    }
    navRef.current = false;
    setCanZoomBack(false);
    return false;
  }, []);

  const zoomHistoryForward = useCallback((): boolean => {
    const ctl = ctlRef.current;
    if (!ctl || fwdStackRef.current.length === 0) return false;
    while (fwdStackRef.current.length > 0) {
      const next = fwdStackRef.current[fwdStackRef.current.length - 1];
      const cur = lastZoomAddrRef.current;
      navRef.current = true;
      const ok = ctl.zoomToAddress(next);
      if (ok) {
        fwdStackRef.current.pop();
        backStackRef.current.push(cur);
        lastZoomAddrRef.current = next;
        setCanZoomBack(true);
        setCanFwd(fwdStackRef.current.length > 0);
        queueMicrotask(() => {
          navRef.current = false;
        });
        return true;
      }
      fwdStackRef.current.pop();
    }
    navRef.current = false;
    setCanFwd(false);
    return false;
  }, []);

  // 鼠标侧键先走 Home 的 zoom 历史（与顶栏后退/前进同一条路），未处理才冒泡给 App
  useEffect(() => {
    if (!active) return;
    const onNavBack = (e: Event) => {
      if (searching) {
        e.preventDefault();
        resetSearch();
        return;
      }
      if (zoomHistoryBack()) e.preventDefault();
    };
    const onNavForward = (e: Event) => {
      if (zoomHistoryForward()) e.preventDefault();
    };
    window.addEventListener(NAV_BACK_EVENT, onNavBack);
    window.addEventListener(NAV_FORWARD_EVENT, onNavForward);
    return () => {
      window.removeEventListener(NAV_BACK_EVENT, onNavBack);
      window.removeEventListener(NAV_FORWARD_EVENT, onNavForward);
    };
  }, [active, searching, resetSearch, zoomHistoryBack, zoomHistoryForward]);

  return (
    <div ref={hostRef} className={`home-view${active ? "" : " home-view-idle"}`} style={{ ["--note-ph" as string]: t("homeNotePh") }}>
      <div className="home-toolbar" contentEditable={false}>
        <button
          className="home-back"
          disabled={!(searching || canZoomBack || canBack)}
          onClick={() => {
            if (searching) {
              resetSearch();
              return;
            }
            if (!zoomHistoryBack()) onBack?.();
          }}
          title={t("homeBack")}
        >
          {I.back}
        </button>
        <button
          className="home-back"
          disabled={!(canFwd || canForward)}
          onClick={() => {
            if (!zoomHistoryForward()) onForward?.();
          }}
          title={t("homeForward")}
        >
          {I.forward}
        </button>
        <div className="home-crumb">
          <button
            className="home-crumb-btn home-crumb-home"
            onClick={() => {
              resetSearch();
              ctlRef.current?.zoomTo(null);
            }}
            title="Workflowy"
          >
            {I.house}
          </button>
          {crumbs.slice(1).map((c, i) => (
            <span key={`${c.pos ?? "root"}-${i}`} className="home-crumb-item">
              <span className="home-crumb-sep">{I.chevron}</span>
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
        {/* 搜索框在顶栏原位；查询直接过滤整页大纲，结果不在这里弹出 */}
        <div
          ref={searchBoxRef}
          className={`home-search-trigger${searchFieldOn ? " is-on" : ""}`}
          data-tip={t("tabSearch")}
          onClick={() => searchInputRef.current?.focus()}
        >
          <Icon name="search" size="sm" className="home-search-mag" />
          <input
            ref={searchInputRef}
            className="home-search-input"
            placeholder={t("searchPanelPh")}
            value={searchQuery}
            spellCheck={false}
            aria-expanded={searchFieldOn}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setSearchQuery("");
              setSearchFocus(false);
              searchInputRef.current?.blur();
              editor?.commands.focus();
            }}
          />
          {searchQuery && (
            <button
              className="home-search-clear"
              title={t("searchClear")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearchQuery("");
                searchInputRef.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </div>
        <button
          className={`home-tool-btn${hideDone ? " is-on" : ""}`}
          data-tip={t("homeHideDone")}
          onClick={() => ctlRef.current?.toggleHideCompleted()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2.5 8s2.2-3.8 5.5-3.8S13.5 8 13.5 8s-2.2 3.8-5.5 3.8S2.5 8 2.5 8z" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="8" cy="8" r="1.6" fill="currentColor" />
            {hideDone && (
              <path d="M3 13.5 13 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            )}
          </svg>
        </button>
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
      </div>
      {searchFieldOn && (
        <div
          className="home-search-panel is-expanded"
          data-open="1"
          style={searchAnchor ?? undefined}
          onMouseDown={(e) => e.preventDefault()}
        >
          <HomeSearchFilters
            value={searchFilter}
            onChange={(f) => {
              setSearchFilter(f);
              searchInputRef.current?.focus();
            }}
          />
        </div>
      )}
      <div className="home-scroll">
        {/* 搜索不另起页面：直接过滤真实大纲，节点/展开箭头/缩进全部沿用原样式 */}
        {!searching && (
          <HomeToday
            editor={editor}
            onLocate={(addr) => {
              if (editor) ctlRef.current?.zoomToAddress(addr);
            }}
          />
        )}
        <div ref={caretWrapRef} className="relative home-editor-wrap">
          {caret && (
            <div
              className="caret-custom"
              style={{
                top: caret.top,
                left: caret.left,
                width: caret.width,
                height: caret.height,
                background: caret.color,
                transition: caret.transition || undefined,
                animation: solid ? "none" : undefined,
              }}
            />
          )}
          <div className="outline-root">
            {editor ? <EditorContent editor={editor} /> : null}
          </div>
          {!searching && (
            <button
              className="outline-add"
              title={t("homeAddItem")}
              style={{ marginLeft: crumbs.length > 1 ? 32 : 0 }}
              onMouseDown={(e) => e.preventDefault()}
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
          )}
          {searching && searchHits.length > 0 && (
            <div className="home-inline-notes">
              <div
                className="home-search-divider"
                role="separator"
                aria-label={t("searchSectionNotes")}
              >
                <span>{t("searchSectionNotes")}</span>
              </div>
              {searchHits.map((h, i) => (
                <button
                  key={h.path}
                  className="home-search-result home-inline-note"
                  style={{ ["--i" as string]: i }}
                  onClick={() => emitOpenNote(h.path, { newTab: true })}
                >
                  <span className="home-search-main">
                    <span className="home-search-title">{h.title || h.path}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
