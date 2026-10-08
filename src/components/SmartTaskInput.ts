import { Extension, InputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * 补全待办清单的输入规则。
 *
 * tiptap v3 内置的 taskItem 规则（"[ ] " → 待办）只在普通段落生效：
 * 用户按 Obsidian 习惯输入 "- [ ] " 时，"- " 先把段落转成了无序列表项，
 * 随后的 "[ ] " 在列表项内无法包装（taskItem 的合法父节点是 taskList），
 * 于是停留在字面文本上。这条规则两种情况都处理：
 *   A. 普通空段落里输入 "[ ] " / "[x] " → 包成 taskList > taskItem
 *   B. 无序列表项内输入（即 "- [ ] " 的后半段）→ 把该列表项原地转成待办项
 */
export const SmartTaskInput = Extension.create({
  name: "smartTaskInput",
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[( |x|X)\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const checked = match[1].toLowerCase() === "x";
          const taskListType = state.schema.nodes.taskList;
          const taskItemType = state.schema.nodes.taskItem;
          if (!taskListType || !taskItemType) return;

          chain()
            .deleteRange(range)
            .command(({ tr }) => {
              const $from = tr.selection.$from;

              // 找到光标所在的 paragraph 深度
              let pDepth = -1;
              for (let d = $from.depth; d > 0; d--) {
                if ($from.node(d).type.name === "paragraph") {
                  pDepth = d;
                  break;
                }
              }
              if (pDepth < 0) return false;

              // 情况 B：段落外层是 bulletList > listItem
              if (
                pDepth >= 2 &&
                $from.node(pDepth - 1).type.name === "listItem" &&
                $from.node(pDepth - 2).type.name === "bulletList"
              ) {
                const liNode = $from.node(pDepth - 1);
                const blDepth = pDepth - 2;
                const item = taskItemType.create({ checked }, liNode.content);
                const list = taskListType.create(null, [item]);
                const listStart =
                  $from.node(blDepth).childCount === 1
                    ? $from.before(blDepth)
                    : $from.before(pDepth - 1);
                tr.replaceWith(
                  listStart,
                  listStart === $from.before(blDepth)
                    ? $from.after(blDepth)
                    : $from.after(pDepth - 1),
                  list
                );
                // 光标放回新待办项的段落里
                tr.setSelection(TextSelection.near(tr.doc.resolve(listStart + 2), 1));
                return true;
              }

              // 情况 A：普通段落 → 原地替换为 taskList > taskItem > 原段落
              const pNode = $from.node(pDepth);
              const pStart = $from.before(pDepth);
              const item = taskItemType.create({ checked }, [pNode]);
              const list = taskListType.create(null, [item]);
              tr.replaceWith(pStart, $from.after(pDepth), list);
              tr.setSelection(TextSelection.near(tr.doc.resolve(pStart + 2), 1));
              return true;
            })
            .run();
        },
      }),
    ];
  },
});
