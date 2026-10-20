# 图标主题规范 v1

目标：所有线性图标共用一套网格、尺寸、描边和颜色语义。新代码不再在调用处手写
SVG 的 `width` / `height` / `stroke-width`，统一走 `src/components/icons.tsx` 的
`<Icon>`。

## Tokens（`src/styles.css` 的 `:root`）

| token | 值 | 用途 |
| --- | --- | --- |
| `--icon-size-xs` | 12px | 行内元信息、清除按钮 |
| `--icon-size-sm` | 13px | 紧凑工具栏、搜索输入框 |
| `--icon-size-md` | 14px | 顶栏/侧栏默认 |
| `--icon-size-lg` | 16px | 大按钮、空状态 |
| `--icon-stroke-hairline` | 1.1 | 细节密集图标 |
| `--icon-stroke-regular` | 1.4 | 默认 |
| `--icon-stroke-strong` | 1.6 | 需要强调的图标 |

颜色只使用 `currentColor`，由父级决定；不要给图标写死颜色。弱化状态用父级
`color: var(--ink-faint)` / `var(--ink-soft)` 表达，不再增加第二套图标灰。

## 组件用法

```tsx
import { Icon } from "../icons";

<Icon name="search" size="sm" />
<Icon name="search" size="md" stroke="regular" />
<Icon name="search" size="sm" className="home-search-mag" />
```

- `name`：`I` 里的图标名。
- `size`：`xs | sm | md | lg`。
- `stroke`：`hairline | regular | strong`。
- `className`：只加布局/颜色类，不改尺寸/描边。
- 有可访问名称时传 `title`（同时提供 `role="img"`），否则默认 `aria-hidden`。

## 绘制规则

- 16×16 viewBox，线条图标，`fill="none"`，`stroke="currentColor"`。
- 描边圆头/圆角；视觉中心落在 16 网格上。
- 只有小圆点可以填充，不要用实心块。
- 图标 SVG 保留历史描边值即可，`<Icon>` 会通过 `--icon-stroke` 统一覆盖；
  但新图标建议直接写目标描边，便于单独复用。

## 迁移记录

- `search`：搜索框使用 `sm`（13px），侧栏搜索 Tab 使用 `md`（14px）；不再有
  手写的放大镜 SVG。
- 后续可按同一方式迁移顶栏眼睛/日历、筛选图标等，逐个替换并目检亮/暗主题。
