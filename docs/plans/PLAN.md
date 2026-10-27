# Plan

## 目标

（一句话：这次要解决什么）

## 约束

- （不能动的东西 / 必须遵守的既有规则）

## 方案

（关键取舍，以及为什么不选另外两条路）

## Tasks

- [x] Z1 探针：dump pele 渲染出的 .pele/svg 真实结构，确定缩放实现路线 · evidence: CDP 探针：svg 为 <svg class="pele pele-flowchart" viewBox="0 0 409 152" width="409" height="152" style="max-width:100%;height:auto">，自然尺寸 409×152；旧实现滚轮 6 次后 stage 仍 457×200、inner 变 946×352 且溢出被裁 → 确认根因是 transform 不参与布局
- [x] Z2 MermaidZoom 尺寸模型重构：内容盒 layout 尺寸 = base × scale，窗口随之长大/缩小 · evidence: 实测 stage 尺寸：1x 457×200 → 2.46x 1054×422 → 0.41x 214×110；内容盒 = 409×1 → 1006×374；inner 与 box 同尺寸（不再溢在盒外）
- [x] Z3 窗口上限 + 拖拽平移 + 双击复位 · evidence: 5x 时 stage 封顶 1472×774、内容 2045×760；拖拽后 pan=(-310,-17)，maxX=(2045-1424)/2=310.5 被夹住；双击后回 457×200 / scale 1 / pan(0,0) 且弹窗不关闭；cursor 在可拖时 grab、可拖时 default
- [x] Z4 滚轮锚点缩放 + 背后页面不跟着滚 · evidence: 封顶后以光标为锚点：5→3.70 漂移 (1,29)px、3.70→5 漂移 (0,-21)px（y 受限于内容比视口矮时的居中约束）；wheel 用原生 passive:false + preventDefault，连滚 6 格后编辑器 scrollTop 仍为 0
- [x] Z5 验证与回归 · evidence: npm run lint -> exit 0（0 errors/79 warnings）；npm run typecheck -> exit 0；npm run build -> exit 0；check:theme -> exit 1 仍是 HEAD 已有的 --editor-font-size；Esc 关闭 ok；暗色卡片底色 rgb(26,24,23)；截图 %TEMP%/pi-pele-verify/{zoom-1x,zoom-2x,zoom-max-anchored,zoom-dark-2x,zoom-dark-out}.png

## 验收

- （可执行的验证命令，以及期望结果）

## 风险

- （回滚方式 / 可能出问题的地方）
