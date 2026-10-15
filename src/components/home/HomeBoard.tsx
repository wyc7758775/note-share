// 看板（对齐官方 Boards 语义）：看板条目的子条目 = 列，孙条目 = 卡片。
// 官方看板是内联的——和大纲其他条目同层共存（父视图里直接展开成列），
// 本组件由条目 NodeView 内联渲染（zoom 进去看板节点也是同一份，标题+看板）。
// - 列底 + 内联输入新卡片（挂为该列末位子级）；看板右缘 + 新列
// - 卡片右侧圆点是拖拽手柄（官方：bullet 在卡片右侧）；拖到别的列 = 移动条目
// - 列间分隔线可拖宽窄；一切修改直接写大纲文档（单一数据源 Home.md）
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { fixZoomOnRemoval, itemDeleteRange, withFlip } from "./outlineKit";
import { useSettings } from "../../i18n";

interface Card {
  pos: number;
  address: number[];
  text: string;
  done: boolean;
  childCount: number;
}
interface Column {
  pos: number;
  title: string;
  cards: Card[];
  /** 新卡片插入位（有子列表=其内容末尾；无=item 内容末尾，将新建子列表） */
  insertEnd: number;
  needNewList: boolean;
}

const CARD_MIME = "application/x-noteshare-card";
const COL_W_DEFAULT = 248;

function ownFirstText(item: PMNode): string {
  let first = "";
  item.forEach((c) => {
    if (c.type.name === "paragraph" && !first) first = c.textContent.trim();
  });
  return first;
}
function nestedOf(item: PMNode): { off: number; node: PMNode } | null {
  let off = 0;
  for (let i = 0; i < item.childCount; i++) {
    const n = item.child(i);
    if (n.type.name === "taskList") return { off, node: n };
    off += n.nodeSize;
  }
  return null;
}
function addressAt(doc: PMNode, pos: number): number[] {
  const $ = doc.resolve(pos + 1);
  const out: number[] = [];
  for (let d = $.depth; d >= 1; d--) {
    if ($.node(d).type.name === "taskItem") out.unshift($.index(d - 1));
  }
  return out;
}

/** 看板条目（rootPos）的列/卡推导：root 首个嵌套任务列表 = 列集 */
function deriveColumns(editor: Editor, rootPos: number): Column[] {
  const doc = editor.state.doc;
  const root = doc.nodeAt(rootPos);
  if (!root || root.type.name !== "taskItem") return [];
  let listNode: PMNode | null = null;
  let listPos = 0;
  root.forEach((c, off) => {
    if (c.type.name === "taskList" && !listNode) {
      listNode = c;
      listPos = rootPos + 1 + off;
    }
  });
  if (!listNode) return [];
  const out: Column[] = [];
  let childOff = 0;
  (listNode as PMNode).forEach((col) => {
    if (col.type.name === "taskItem") {
      const colPos = listPos + 1 + childOff;
      const nested = nestedOf(col);
      const cards: Card[] = [];
      if (nested) {
        let cardOff = 0;
        nested.node.forEach((card) => {
          if (card.type.name === "taskItem") {
            cards.push({
              pos: colPos + 1 + nested.off + 1 + cardOff,
              address: addressAt(doc, colPos + 1 + nested.off + 1 + cardOff),
              text: ownFirstText(card),
              done: !!card.attrs.checked,
              childCount: Math.max(0, card.childCount - 1),
            });
          }
          cardOff += card.nodeSize;
        });
      }
      out.push({
        pos: colPos,
        title: ownFirstText(col) || " ",
        cards,
        insertEnd: nested
          ? colPos + 1 + nested.off + nested.node.nodeSize - 1
          : colPos + col.nodeSize - 1,
        needNewList: !nested,
      });
    }
    childOff += col.nodeSize;
  });
  return out;
}

export default function HomeBoard({
  editor,
  rootPos,
  onLocate,
}: {
  editor: Editor | null;
  /** 看板节点自身位置（列=其子级，卡=孙级） */
  rootPos: number;
  onLocate: (address: number[]) => void;
}) {
  const { t } = useSettings();
  const [tick, setTick] = useState(0);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [adding, setAdding] = useState<number | null>(null); // 正在输入新卡片的列 pos
  const [draft, setDraft] = useState("");
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const resizeRef = useRef<{ colPos: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const onTr = () => setTick((x) => x + 1);
    editor.on("transaction", onTr as never);
    return () => {
      editor.off("transaction", onTr as never);
    };
  }, [editor]);

  // 列宽拖拽（分隔线）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(180, Math.min(460, r.startW + e.clientX - r.startX));
      setWidths((s) => ({ ...s, [r.colPos]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const columns = useMemo(
    () => (editor ? deriveColumns(editor, rootPos) : [] as Column[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, rootPos, tick]
  );
  if (!editor) return null;

  const schema = editor.state.schema;
  const mkItem = (text: string) =>
    schema.nodes.taskItem.create(
      null,
      // 空文本不能走 schema.text("")（PM 拒绝空 text node）
      text ? schema.nodes.paragraph.create(null, schema.text(text)) : schema.nodes.paragraph.create()
    );

  const addCard = (col: Column) => {
    if (!draft.trim()) return;
    const tr = editor.state.tr;
    if (col.needNewList) {
      tr.insert(col.insertEnd, schema.nodes.taskList.create(null, mkItem(draft)));
    } else {
      tr.insert(col.insertEnd, mkItem(draft));
    }
    withFlip(editor, () => editor.view.dispatch(tr));
    setDraft("");
    setAdding(null);
  };

  const addColumn = () => {
    const root = editor.state.doc.nodeAt(rootPos);
    if (!root || root.type.name !== "taskItem") return;
    let listPos = -1;
    let listEnd = 0;
    root.forEach((c, off) => {
      if (c.type.name === "taskList" && listPos < 0) {
        listPos = rootPos + 1 + off;
        listEnd = listPos + c.nodeSize - 1;
      }
    });
    if (listPos < 0) {
      // 看板节点还没有子列表：新建一层（必须放在段落后，否则列渲染到标题上方）
      listEnd = rootPos + root.nodeSize - 1;
      editor.view.dispatch(
        editor.state.tr.insert(listEnd, editor.state.schema.nodes.taskList.create(null, mkItem("")))
      );
      return;
    }
    editor.view.dispatch(editor.state.tr.insert(listEnd, mkItem("")));
  };

  /** 卡片拖到列：移动条目（delete + 插到该列末位子级） */
  const dropCardOn = (col: Column, cardPos: number) => {
    const doc = editor.state.doc;
    const node = doc.nodeAt(cardPos);
    if (!node || node.type.name !== "taskItem") return;
    if (cardPos >= col.pos && cardPos < col.pos + node.nodeSize + 2) return; // 已在该列
    const tr = editor.state.tr;
    const range = itemDeleteRange(doc, cardPos);
    tr.delete(range.from, range.to);
    const insertAt = tr.mapping.map(col.insertEnd);
    if (col.needNewList) {
      tr.insert(insertAt, schema.nodes.taskList.create(null, node));
    } else {
      tr.insert(insertAt, node);
    }
    // 缩放根在被拖卡片子树内：跟到新列（新列包了列表，节点起点 +1）
    fixZoomOnRemoval(
      tr,
      editor.state,
      cardPos,
      node.nodeSize,
      col.needNewList ? insertAt + 1 : insertAt
    );
    withFlip(editor, () => editor.view.dispatch(tr));
  };

  const colWidth = (pos: number) => widths[pos] ?? COL_W_DEFAULT;

  return (
    <div className="home-board" contentEditable={false}>
      {columns.length === 0 && <div className="home-board-empty">{t("homeBoardEmptyNode")}</div>}
      {columns.map((col, i) => (
        <div
          key={col.pos}
          className={`home-board-col${dragOverCol === col.pos ? " is-over" : ""}`}
          style={{ width: colWidth(col.pos) }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(CARD_MIME)) {
              e.preventDefault();
              setDragOverCol(col.pos);
            }
          }}
          onDragLeave={() => setDragOverCol((c) => (c === col.pos ? null : c))}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverCol(null);
            try {
              const payload = JSON.parse(e.dataTransfer.getData(CARD_MIME)) as { pos: number };
              // drop 时按地址重解析（拖拽窗口中文档未变，直接用 pos 也行，双保险走地址）
              dropCardOn(col, payload.pos);
            } catch {
              /* 非法数据忽略 */
            }
          }}
        >
          <div className="home-board-col-head">
            <span className="home-board-col-title">{col.title}</span>
            <span className="home-board-col-count">{col.cards.length}</span>
          </div>
          <div className="home-board-cards">
            {col.cards.map((c) => (
              <div
                key={c.pos}
                className={`home-board-card${c.done ? " is-done" : ""}`}
                onClick={() => onLocate(c.address)}
              >
                <span className="home-board-card-text">{c.text}</span>
                {c.childCount > 0 && <span className="home-board-card-sub">{c.childCount}</span>}
                {/* 官方：卡片 bullet 在右侧，作为拖拽手柄 */}
                <span
                  className="home-board-card-handle"
                  draggable
                  title={t("homeBoardDrag")}
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    const node = editor.state.doc.nodeAt(c.pos);
                    if (!node) return;
                    e.dataTransfer.setData(CARD_MIME, JSON.stringify({ pos: c.pos }));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <span className="home-board-handle-dot" />
                </span>
              </div>
            ))}
            {adding === col.pos ? (
              <input
                className="home-board-input"
                autoFocus
                value={draft}
                placeholder={t("homeNewCard")}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  addCard(col);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCard(col);
                  if (e.key === "Escape") {
                    setDraft("");
                    setAdding(null);
                  }
                }}
              />
            ) : (
              <button
                className="home-board-add"
                title={t("homeBoardAdd")}
                onClick={() => setAdding(col.pos)}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {i < columns.length - 1 && (
            <span
              className="home-board-resize"
              onMouseDown={(e) => {
                resizeRef.current = { colPos: col.pos, startX: e.clientX, startW: colWidth(col.pos) };
              }}
            />
          )}
        </div>
      ))}
      <button className="home-board-newcol" onClick={addColumn} title={t("homeBoardNewCol")}>
        +
      </button>
    </div>
  );
}
