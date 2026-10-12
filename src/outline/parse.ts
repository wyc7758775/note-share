// Home 大纲的纯文本层：Home.md（嵌套任务列表）↔ OutlineNode 树。
// 不依赖编辑器，供 OutlineStore 的索引/搜索/引用改写与嵌入渲染使用。
//
// 磁盘行格式（与编辑器序列化一致，Obsidian 兼容）：
//   "- [ ] 文本" / "- [x] 已完成 ^块id"
// 缩进 2 空格一级（tab 按 1 级计）；^id 是 Obsidian 块引用标记，懒分配。

export interface OutlineNode {
  id: string | null;
  /** 行内 markdown 原文（不含列表标记与 ^id）；多行时含 \n 续行 */
  text: string;
  done: boolean;
  children: OutlineNode[];
  /** 树内地址（各级子节点下标），文本层改写（补挂 id）按它定位 */
  address: number[];
}

const ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s?/;
const PLAIN_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const ID_RE = /\s*\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/;

/** 生成短块 id（Home 内引用锚点） */
export function genBlockId(): string {
  return `h${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 行首缩进换算成层级（2 空格 = 1 级，tab = 1 级） */
function indentLevel(line: string): number {
  let units = 0;
  for (const ch of line) {
    if (ch === "\t") units += 2;
    else if (ch === " ") units += 1;
    else break;
  }
  return Math.floor(units / 2);
}

function stripId(text: string): { text: string; id: string | null } {
  const m = ID_RE.exec(text);
  if (!m) return { text, id: null };
  return { text: text.slice(0, m.index), id: m[1] };
}

/** 解析整份大纲文本；非列表行并入上一条目（软换行续行） */
export function parseOutline(md: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // 栈元素：{ node, depth, address }——栈顶是最近一条仍打开的条目
  const stack: { node: OutlineNode; depth: number }[] = [];
  let last: OutlineNode | null = null;

  for (const line of md.split(/\r?\n/)) {
    const m = ITEM_RE.exec(line);
    const plain = m ?? PLAIN_RE.exec(line);
    if (plain) {
      const depth = indentLevel(line);
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1]?.node ?? null;
      const rest = m
        ? stripId(line.slice(m[0].length))
        : stripId(line.slice(plain[0].length));
      const node: OutlineNode = {
        id: rest.id,
        text: rest.text.trim(),
        done: m ? m[2] !== " " : false,
        children: [],
        address: parent ? parent.address.concat(parent.children.length) : [roots.length],
      };
      (parent ? parent.children : roots).push(node);
      stack.push({ node, depth });
      last = node;
      continue;
    }
    if (line.trim() && last) {
      // 续行：保留原文（可能含第二段文字），序列化时按缩进续行写回
      last.text += `\n${line.trim()}`;
    } else if (line.trim() && !last) {
      // 顶层散行（编辑器删光列表后输入的普通段落等）：兜底收编为根条目，避免丢字
      roots.push({
        id: null,
        text: line.trim(),
        done: false,
        children: [],
        address: [roots.length],
      });
    }
  }
  return roots;
}

export interface FlatRow {
  node: OutlineNode;
  depth: number;
  /** 祖先文本（不含自身），面包屑展示用 */
  path: string[];
}

/** 深度优先铺平 */
export function flattenOutline(roots: OutlineNode[]): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: OutlineNode[], depth: number, path: string[]) => {
    for (const n of nodes) {
      out.push({ node: n, depth, path });
      walk(n.children, depth + 1, [...path, firstLine(n.text)]);
    }
  };
  walk(roots, 0, []);
  return out;
}

export function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

/** 按地址取节点 */
export function nodeAtAddress(roots: OutlineNode[], address: number[]): OutlineNode | null {
  let list = roots;
  let node: OutlineNode | null = null;
  for (const idx of address) {
    const hit = list[idx];
    if (!hit) return null;
    node = hit;
    list = hit.children;
  }
  return node;
}

/** 按 id 取节点（返回 null 表示已被删除） */
export function nodeById(roots: OutlineNode[], id: string): OutlineNode | null {
  let found: OutlineNode | null = null;
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      if (n.id === id) {
        found = n;
        return;
      }
      walk(n.children);
      if (found) return;
    }
  };
  walk(roots);
  return found;
}

/** id → 地址（找不到返回 null） */
export function addressById(roots: OutlineNode[], id: string): number[] | null {
  const n = nodeById(roots, id);
  return n ? n.address : null;
}

/** 祖先文本链（含自身），面包屑/嵌入标题用 */
export function breadcrumbOf(node: OutlineNode, roots: OutlineNode[]): string[] {
  const out: string[] = [];
  let list = roots;
  for (const idx of node.address) {
    const hit = list[idx];
    if (!hit) break;
    out.push(firstLine(hit.text));
    list = hit.children;
  }
  return out;
}

/** 子树序列化回 markdown（含 ^id；depth 为起始缩进层级） */
export function subtreeMarkdown(node: OutlineNode, depth = 0): string {
  const pad = "  ".repeat(depth);
  const lines: string[] = [];
  const [head, ...rest] = node.text.split("\n");
  const idSuffix = node.id ? ` ^${node.id}` : "";
  lines.push(`${pad}- [${node.done ? "x" : " "}] ${head.trim()}${idSuffix}`);
  for (const r of rest) lines.push(`${pad}  ${r}`);
  for (const c of node.children) lines.push(subtreeMarkdown(c, depth + 1));
  return lines.join("\n");
}

/** 在磁盘文本里给 address 处条目补挂 ^id（已有则原样返回）。
 *  地址还原与 parseOutline 的建栈逻辑严格同构：栈存已打开条目，各记子计数。 */
export function assignBlockId(md: string, address: number[], id: string): string {
  const lines = md.split(/\r?\n/);
  const stack: { depth: number; address: number[]; childCount: number }[] = [];
  let rootCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM_RE.exec(lines[i]) ?? PLAIN_RE.exec(lines[i]);
    if (!m) continue;
    const depth = indentLevel(lines[i]);
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1] ?? null;
    const addressHere = parent ? [...parent.address, parent.childCount] : [rootCount];
    if (parent) parent.childCount++;
    else rootCount++;
    stack.push({ depth, address: addressHere, childCount: 0 });
    if (addressHere.length === address.length && addressHere.every((v, k) => v === address[k])) {
      const stripped = lines[i].replace(/\s+$/, "");
      if (ID_RE.test(stripped)) return md; // 已有 id
      lines[i] = `${stripped} ^${id}`;
      return lines.join("\n");
    }
  }
  return md;
}
