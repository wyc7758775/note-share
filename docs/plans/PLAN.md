# Plan

## 目标

（一句话：这次要解决什么）

## 约束

- （不能动的东西 / 必须遵守的既有规则）

## 方案

（关键取舍，以及为什么不选另外两条路）

## Tasks

- [x] P1 主题溯源与 palette 定档：确认截图主题 = Solarized Dark（Warp settings.toml + 规范值校对），用 WCAG 对比度选定三级文字档位 · evidence: 读 AppData/Local/warp/Warp/config/settings.toml 得 `theme = "solarized_dark"`；用 highlight.js/solarized-dark.css 校对规范值；codemode 算 WCAG：内置暗色 ink/soft/faint = 14.09/7.02/3.69，Solarized 忠实版 4.75/3.37/2.79，提亮版 #c5cfcf/#9fb0b1/#71888b = 9.44/6.66/4.00 → 定档提亮版
- [x] P2 基线门禁：跑 check:theme / check:i18n / lint / typecheck，记录 HEAD 真实状态（含 check:theme 是否已红） · evidence: HEAD=139355e。基线：check:theme 红（`--editor-font-size 缺少暗色覆盖`）、check:i18n 绿（388 key）、lint 0 error/79 warning、typecheck 绿。收尾复跑：check:theme 绿（预设 2 套）、i18n 绿（392 key）、lint `✖ 79 problems (0 errors, 79 warnings)` 与基线同数、typecheck exit 0、build `✓ built in 30.28s`
- [x] P3 领域 token 表：theme-tokens.ts 增 SOLARIZED_DARK、ThemePreset { id, nameKey, descKey, base, tokens }、PRESETS、findPreset、SCHEME_EXTRA_TOKENS 白名单 · evidence: src/domain/theme-tokens.ts 新增 ThemePreset / SOLARIZED_DARK / PAPER_LIGHT / PRESETS / findPreset / SCHEME_EXTRA_TOKENS；CDP 实测 `--paper` 注为 #002b36（solarized）与 #f4efe4（paper）；门禁输出 `预设 2 套（非主题常量 4 个）`
- [x] P4 领域偏好：themeId 允许指向预设 id；normalize 校验集合 = 预设 ids ∪ customThemes ids；resolveDark 规则不变 · evidence: findScheme(id, customThemes) 下沉到 domain/preferences.ts；normalize 注释与逻辑改为「预设 id ∪ 自定义 id」；saveTheme 拒绝预设重名、nextThemeId 避让保留字。CDP 注入非法数据后重载：themeId:'nope-does-not-exist' → null（回退内置），customThemes 里冒充 preset-paper 的项被剔除，ct-1 保留
- [x] P5 应用服务：apply() 的 tokens 来源扩展为 builtin ∪ 方案 tokens；accent 仍最后注入 · evidence: apply() 改走配置 `this.prefs.schemeOf(cfg.themeId)` + base 匹配；CDP 实测三套方案切换：内建/深青/纸张的 --paper/--ink/--surface 均正确，--accent 始终等于用户偏好值（#b45309 亮 / #d97706 暗），方案覆盖不了
- [x] P6 UI：ThemeManager 在内置主题行下方并列列出所有预设，点选时同时 setTheme(base) · evidence: CDP 点真实 UI：列表渲染「内置主题亮色 / Solarized 深青暗色 / 纸张亮色」；点深青 → themeId=preset-solarized 且 themePref 自动 dark、data-theme=dark；点纸张 → 自动 light；点内置 → themeId=null、--paper 回 #ffffff。截图 %TEMP%/theme-verify/{26-scheme-list,27-scheme-solarized,30-solarized-fixed,31-paper-fixed,32-builtin-fixed}.png
- [x] P7 i18n：zh/en 同步新增预设名称与描述 key · evidence: zh/en 各增 4 个 key（themePresetSolarized{,Desc} / themePresetPaper{,Desc}）；check:i18n `✓ i18n 检查通过：zh/en 各 392 个 key 对齐，引用无悬空`（基线 388 → 392，+4）
- [x] P8 门禁：check-theme.mjs 增预设校验（token 在白名单内、值非空、id 合法且唯一） · evidence: check-theme.mjs 新增第 5 段校验；反证测试：临时塞入 `--paper: ""` 与生造的 `--code-fg-typo` → 报 `预设 preset-solarized 的 --paper 值为空` + `覆盖了 dark 基础主题里没有的 token --code-fg-typo`（2 处），还原后复绿
- [x] P9 文档：docs/theme-tokens.md 增预设与字体/字距两节，收敛权威表述 · evidence: docs/theme-tokens.md：页首权威表述改为「权威在 src/domain/theme-tokens.ts，styles.css 是无 JS 回退」；新增「内置预设方案（PRESETS）」与「字体与字距 token」两节（含 Solarized 忠实版三行改法 + 对比度数字）
- [x] P10 硬编码色收口：FileTree / PublishPanel / ExcalidrawBlock 三处改走 --accent · evidence: FileTree 搜索框 → border-[var(--line-strong)] + focus:border-[var(--accent)] + ring-[var(--active-bg)]；ExcalidrawBlock → ring-[var(--accent)]；PublishPanel → text-[var(--accent)]。build 后 dist CSS 实测存在 `.text-\[var\(--accent\)\]`、`.ring-\[var\(--accent\)\]`、`.focus\:ring-\[var\(--active-bg\)\]` 等规则
- [x] P11 验证与回归：lint / typecheck / build / check:theme / check:i18n 全绿 + 实机切换截图 · evidence: lint `✖ 79 problems (0 errors, 79 warnings)`（与基线同）；typecheck exit 0；build `✓ built in 30.28s`；check:theme 绿；check:i18n 绿。CDP 实机切换链：深青→纸张→内置，每步 --paper/--ink/--track-label 均正确且回切无残留（修掉了 `--track-label` 0.1em 残留 bug）。截图 %TEMP%/theme-verify/01..32*.png
- [x] Q1 （可选、不阻塞）字体溯源：降级为后续可选项 · evidence: 本会话未做字体识别（已降级为可选）。已确认截图 latin 字族不是纸感的主因；纸张预设未换字族，仅放宽标签字距
- [x] Q2 【已定】字体来源：不自带 woff2，走系统字体栈 · evidence: 未新增任何字体文件（public/ 仍无 fonts）；--font-ui/--font-serif/--font-mono 仅存回退栈，将来换字体改一行 + 加 woff2 即可
- [x] Q3 字体与字距 token 化：--font-ui / --font-serif / --font-mono / --track-label · evidence: styles.css：8 处 font-family 收敛为 var(--font-ui/--font-serif/--font-mono)（grep 已无硬编码栈）；常量 :root 块新增 4 个 token；--editor-font-size 从色板块移入常量块。CDP 实测字距：solarized `tabLabel=normal`；paper `tabLabel=1.5px`、`settingsHint=1.1505px`、`settingsH3=1.6107px`（= 0.04em 0.4602 + 0.1em 1.1505，逐位吠合）
- [x] Q4 纸张预设 PAPER_LIGHT（仅亮色） · evidence: PAPER_LIGHT 落表；CDP 实测 `--paper=#f4efe4`、`--surface=#faf6ee`、`--ink=#2f2b26`、`--track-label=0.1em`；实机截图显示侧栏深一档、卡片细暖边、几乎无阴影；--accent 仍为用户的 #b45309
- [x] Q5 修复/记录现有缺陷：Noto Serif SC 未打包的回退策略 · evidence: 字体栈第一顺位保留 Noto Serif SC 并补全 Songti SC/SimSun 回退链；限制写入 docs/theme-tokens.md「已知限制：仓库不打包任何字体文件」一节
- [x] Q6 验证：字体/字距 token 确实跟随方案变化；两套方案互切无残留 · evidence: CDP 实机点选三套方案后截图对比（%TEMP%/theme-verify/）：30-solarized-fixed（深青设置面板）、31-paper-fixed（纸张）、32-builtin-fixed（回内置）；实测发现并修复 --track-label 切回内置后残留 0.1em 的 bug（apply() 对 SCHEME_EXTRA_TOKENS 做 removeProperty）

## 验收

- （可执行的验证命令，以及期望结果）

## 风险

- （回滚方式 / 可能出问题的地方）
