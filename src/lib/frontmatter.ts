import yaml from "js-yaml";

export interface ParsedNote {
  fm: Record<string, unknown>;
  body: string;
}

/** 拆分 YAML frontmatter 与正文；没有 frontmatter 时 fm 为空对象 */
export function parseNote(raw: string): ParsedNote {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const rest = raw.slice(3).replace(/^\r?\n/, "");
  const end = rest.match(/^(---|\.\.\.)\s*(\r?\n|$)/m);
  if (!end || end.index === undefined) return { fm: {}, body: raw };
  const fmText = rest.slice(0, end.index);
  const body = rest.slice(end.index + end[0].length);
  let fm: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(fmText);
    if (parsed && typeof parsed === "object") fm = parsed as Record<string, unknown>;
  } catch {
    // frontmatter 语法不合法时保留原文不炸（交由保存时覆盖）
  }
  // js-yaml 会把日期解析成 Date 对象；统一转回 ISO 字符串，避免显示成 "Thu Oct 08"
  for (const k of Object.keys(fm)) {
    if (fm[k] instanceof Date) fm[k] = (fm[k] as Date).toISOString();
  }
  return { fm, body: body.replace(/^\r?\n/, "") };
}

/** 组装完整文件内容；fm 里过滤掉 undefined 值 */
export function buildRaw(fm: Record<string, unknown>, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fm)) {
    if (v !== undefined) clean[k] = v;
  }
  const keys = Object.keys(clean);
  if (keys.length === 0) return body;
  const fmText = yaml
    .dump(clean, { lineWidth: -1, noRefs: true, quotingType: '"' })
    .trimEnd();
  return `---\n${fmText}\n---\n\n${body}`;
}

export function tagsOf(fm: Record<string, unknown>): string[] {
  const t = fm["tags"];
  if (Array.isArray(t)) return t.map(String);
  if (typeof t === "string") return t.split(/[,\s]+/).filter(Boolean);
  return [];
}

export function setTags(fm: Record<string, unknown>, tags: string[]) {
  if (tags.length === 0) delete fm["tags"];
  else fm["tags"] = tags;
}
