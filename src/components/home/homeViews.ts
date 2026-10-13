// 看板 / 今天视图的数据辅助：从 PM 大纲文档派生条目卡片清单。
// 视图只是文档的另一种渲染；一切修改仍走编辑器命令（单一数据源 Home.md）
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface OutlineCard {
  /** 条目树地址（跳转/定位用，跨视图稳定） */
  address: number[];
  pos: number;
  text: string;
  done: boolean;
  tags: string[];
}

const TAG_RE = /(^|\s)#([A-Za-z0-9\u4e00-\u9fff_-]+)/g;

export function itemTags(item: PMNode): string[] {
  const first = item.childCount ? item.child(0) : null;
  const out: string[] = [];
  if (!first) return out;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(first.textContent))) out.push(m[2]);
  return out;
}

/** 全文档条目卡片清单（看板/今天的底料） */
export function outlineCards(editor: Editor): OutlineCard[] {
  const out: OutlineCard[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "taskItem") return true;
    let first = "";
    node.forEach((c) => {
      if (c.type.name === "paragraph" && !first) first = c.textContent.trim();
    });
    out.push({
      address: addressOf(editor, pos),
      pos,
      text: first,
      done: !!node.attrs.checked,
      tags: itemTags(node),
    });
    return true;
  });
  return out;
}

function addressOf(editor: Editor, pos: number): number[] {
  const $ = editor.state.doc.resolve(pos + 1);
  const out: number[] = [];
  for (let d = $.depth; d >= 1; d--) {
    if ($.node(d).type.name === "taskItem") out.unshift($.index(d - 1));
  }
  return out;
}

/** 条目文本是否匹配某天的日期条目（今天/日历点击定位用；格式同 findTodayTarget 的候选集） */
export function dateCandidates(now: Date): string[] {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = weekdays[now.getDay()];
  const mon = months[now.getMonth()];
  const d = now.getDate();
  const y = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return [`${wd}, ${mon} ${d}`, `${mon} ${d}`, `${now.getMonth() + 1}月${d}日`, `${d}日`, `${y}-${mm}-${dd}`];
}

export function isDateText(text: string, now: Date): boolean {
  const bare = text.replace(/^\ufeff+/, "").replace(/\ufeff+$/, "").trim();
  return dateCandidates(now).includes(bare);
}

/** 月份条目文本（官方结构 Calendar/年/月/日 里的"月"层：Oct、10月、2026年10月）。
 *  返回月份数字，匹配失败返回 null；不猜年份（年份由年条目祖先或当前年决定）。 */
export function monthOfText(text: string): number | null {
  const bare = text.replace(/^\ufeff+/, "").replace(/\ufeff+$/, "").trim();
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const i = en.indexOf(bare);
  if (i >= 0) return i;
  const zh = /^(\d{1,2})月$/.exec(bare) ?? /^(?:\d{4}年)?(\d{1,2})月$/.exec(bare);
  if (zh) {
    const m = Number(zh[1]);
    if (m >= 1 && m <= 12) return m - 1;
  }
  return null;
}

/** 年份条目文本（"2026" / "2026年"） */
export function yearOfText(text: string): number | null {
  const bare = text.replace(/^\ufeff+/, "").replace(/\ufeff+$/, "").trim();
  const m = /^(\d{4})年?$/.exec(bare);
  return m ? Number(m[1]) : null;
}

/** 官方格式日期标题（"Tue, Oct 13"） */
export function dayTitle(d: Date): string {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

/** 相对日前缀（官方 Friendly day names：Today, / Tomorrow, / Yesterday, ） */
export function relativeDayPrefix(d: Date, today: Date): string {
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86400000
  );
  if (diff === 0) return "Today, ";
  if (diff === 1) return "Tomorrow, ";
  if (diff === -1) return "Yesterday, ";
  return "";
}

/** 本地日期键（去时区歧义） */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
