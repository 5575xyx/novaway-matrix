# TUI 视觉保真补齐 实现计划（Plan 1b）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 `packages/tui` 的真实渲染结果补齐到 v7 原型（`.superpowers/brainstorm/311-1790840200/content/card-design-v7.html`）的视觉水平。上一份计划（`2026-10-01-tui-neon-card-visual.md`）只做了「霓虹卡片原语 + 4 处替换」，覆盖约 4/11 处视觉要素，本计划补齐剩余全部。

**基准原型：** `card-design-v7.html`。对照两张截图确认差距：真实 TUI 的助手正文无卡片、输入区无框、侧栏分区无标题、底部无状态栏、Tab 栏右侧为空。

**用户已拍板的三项取舍：**

1. 助手消息用**完整气泡**（meta 行 + 正文 + 工具卡全部包在同一张卡内），忠于原型。
2. 侧栏**全部分区成卡**（三个页签下每个分区一张卡），接受宽度重算与回归。
3. 本轮**做完全部 11 项**，按视觉冲击分三批。

**终端做不到 1:1、采用的等效手法（逐项对应原型，不做「近似省略」）：**

| 原型效果                               | 终端等效手法                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 毛玻璃 / 光晕 / 半透明叠加             | 终端字符画布只有前景色 + 背景色，无 alpha 合成。玻璃感用**不透明深色实底**（原型设计语言②本来就要求「渐变只出现在边框一圈」）+ 悬停时描边提亮（C1）表达                                                                                                                                                 |
| 背景网格纹理                           | 每字符画一层网格会与文字抢占像素、显著降低可读性，并拖慢重绘。**不做**，理由记录在此                                                                                                                                                                                                                    |
| 阶梯入场（`.stagger` + `--d` 延迟）    | 字符网格没有亚像素位移，1 格的「上移」几乎不可见、超过 1 格会撕裂布局。等效做法：**延迟淡入**——卡片描边颜色在 ~150ms 内从底色插值到渐变色，相邻卡片按索引递增延迟（保留原型的错落节奏）。**关键约束**：只对「真正刚到的消息」触发，窗口补载的历史消息不触发，否则滚动加载新窗口会整屏闪烁（见 Task C0） |
| 视图切换动画（气泡 ↔ 流程图）         | 原型**不是**侧滑换页，而是「旧视图当场消失 + 新视图淡入上移」（`viewIn`:opacity 0→1 + translateY(12px)，.45s）。等效做法见 Task D4：位移按整行折算（12px ≈ 3 行）、透明度用 opentui 的真 `opacity`，`animations_enabled=false` 时直接切换                                                               |
| `❯`（U+276F）                          | East-Asian Ambiguous 宽度，CJK 终端会渲染成宽字符或乱码（`prompt/index.tsx:1398` 已有明确注释）。保留 ASCII `>`，字形差异是终端约束                                                                                                                                                                     |
| HUD 角标                               | `NeonBox` 圆角四字符 `╭╮╰╯` 用渐变端色渲染，即角标                                                                                                                                                                                                                                                      |
| `/layout 切换视图`、`ctrl+o 附件` 提示 | 对应命令在本仓库不存在，不写死假提示                                                                                                                                                                                                                                                                    |

**所有测试命令的工作目录均为 `packages/tui`**（根 `bunfig.toml` 禁止从根跑测试）。提交只在本地，**绝不 push**。

---

## 批次 A —— 核心缺口（视觉冲击最大）

### Task A1: 助手消息完整气泡卡

**Files:**

- Modify: `packages/tui/src/routes/session/index.tsx`（`AssistantMessage` 1836–1978、`TextPart` 2118–2137、工具宽度常量 2236/2543/2881/2928/2993）
- Test: `packages/tui/test/routes/session/assistant-card.test.tsx`（新建）

**目标结构（对齐原型 `card-design-v7.html:922-942`）：** 原型的 `.msg-meta` 在 `.bubble` **外**（上一行），只有 bubble 有渐变描边。所以 wrapper 不带边框，meta 行在卡片上方：

```
<box id={props.message.id} ref={alwaysSeparate.add} marginTop={1} flexShrink={0}>   {/* scrollbox 直接子节点 */}
  <box row gap={1} paddingLeft={1} flexShrink={0}>        {/* meta 行 */}
    <span fg={local.agent.color(props.message.agent)}>◆</span>
    <span fg={theme.text}>{agentDisplayName(props.message.agent)}</span>
    <span fg={theme.textMuted}> · {model()} · {Locale.todayTimeOrDateTime(props.message.time.created)}</span>
  </box>
  <neonbox gradientStops={semanticStops(theme, "assistant")} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={1} width="100%" flexShrink={0}>
    …parts（text / reasoning / tool 全部在此卡内）…
  </neonbox>
</box>
```

`error` 卡与「节标题」（`◇ 模式 · 模型 · 时长`，1928–1958）**留在 wrapper 外**（它们是本轮的结束分隔线，不是气泡内容；保持在 scrollbox 直属层级可最小化间距回归）。

**必须同时处理的三个隐性约束（不做会静默回归）：**

1. **滚动跳转依赖 scrollbox 直接子节点的 `id`**：`findNextVisibleMessage`(550-577)、`jumpToMessage`(1400-1419)、`scrollToMessage`(580-592) 都用 `scroll.getChildren().find(c => c.id === id)`。今天只有 `UserMessage` 的外层 box 有 `id`(1774)。加了 wrapper 后**必须**把 `id={props.message.id}` 挂在 wrapper 上，否则 `scrollToMessage` 找不到助手消息。
2. **消息间距依赖兄弟链**：`setPreLayoutSiblingMargin`（`util/layout.ts:8-18`）在 `el.onLifecyclePass` 里遍历 `parent.getChildren()` 求前一个兄弟的高度。wrapper 内的**第一个** part 其 `previous` 为 `undefined` → 条件为假 → 顶层 margin 变 0。处理方式：wrapper 自身 `marginTop={1}`，并把 wrapper 内首 part 的 `marginTop` 归零（`TextPart` 现在是 `marginTop={1}`，改为由 wrapper 承担）；wrapper 内后续 part 之间的间距仍由现有 `alwaysSeparate` 逻辑产生。
3. **8 个快照测试守着这套间距语义**：`test/cli/tui/inline-tool-wrap-snapshot.test.tsx`（`AssistantSummaryBeforeInlineFixture` 137-148、`AssistantErrorBeforeInlineFixture` 150-167、`StickyScrollFixture` 169-188、sticky-bottom 几何测试 320-344）。改动后必须逐个看 diff 确认差异只来自卡片边框，不得直接 `--update-snapshots`。

**宽度重算**：卡内可用宽度 = `ctx.width` − 边框 2 − padding 3。`GenericTool`(2236)、`Shell`(2543)、`Execute`(2881) 的 `Math.max(20, ctx.width - 6)` 与 `Edit`/`ApplyPatch`(2928/2993) 的 `ctx.width > 120` 阈值需按实测调整，保证工具输出不溢出卡片。`TextPart` 的 `paddingLeft={3}`(2123) 删除（缩进由卡片提供），但要回归 `markdown` 的 `internalBlockMode="top-level"` 嵌套列表缩进。

**TDD：** 先写 `assistant-card.test.tsx`（导出 `AssistantMessage` 需 Session context → 若成本过高则改为对 `TextPart` 单独导出测试 + 快照比对，并在报告里说明），断言 meta 行文本（agent 名 / 模型 / 时间）与卡片边框 `╭` 同时出现在同一帧，且正文未被边框覆盖。

**Commit：** `feat(tui): 助手消息改为完整霓虹气泡卡`

---

### Task A2: 输入区霓虹输入卡

**Files:**

- Modify: `packages/tui/src/ui/card.ts`（`NeonBoxRenderable` 新增 `animated` 属性：描边渐变相位滚动）
- Modify: `packages/tui/src/component/prompt/index.tsx`（anchor 1390 内整体包卡；移除独立 NeonRail 1391-1393；模型行 → 卡内 chip；新增发送按钮与 hints 行）
- Modify: `packages/tui/src/routes/session/index.tsx`（会话页传 `placeholders`）
- Test: `packages/tui/test/component/prompt-card.test.tsx`（新建）

**目标结构（对齐原型 `card-design-v7.html:1114-1131`）：**

```
<box ref={anchor}>                      {/* anchor 保持最外层，autocomplete 依赖它的几何 */}
  <neonbox gradientStops={semanticStops(theme,"input")} animated={promptFocused()} paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1} flexShrink={0}>
    <box row>  {/* 输入行 */}
      <text fg={…}>></text>              {/* 保留 ASCII > */}
      <textarea … />
      <box onMouseUp={submit} backgroundColor={…}><text>发送 ⏎</text></box>   {/* 镜像 queue-dock.tsx:111-126 的按钮手法 */}
    </box>
    <box row gap={2}>  {/* hints 行，全部来自 useCommandShortcut，不硬编码 */}
      <span><b>{tabShortcut}</b> agents</span>
      <span><b>{paletteShortcut}</b> commands</span>
      <span><b>{newlineShortcut}</b> 换行</span>
    </box>
  </neonbox>
</box>
```

**要点：**

- **`animated` 是本任务的前置原语**：`NeonBoxRenderable` 增加 `animated?: boolean`（setter 触发 `requestRender`），`renderSelf` 里描边色用 `gradientAt(stops, (cell.t + phase) % 1)`，`phase` 由 `createEffect` + 80ms 定时器推进（照 `NeonRail` 已落地的模式，复用 `kv.get("animations_enabled", true)` 门控与 `onCleanup`）。在此之上再叠**扫光**（原型的「聚焦流动描边 + 扫光」）：在相位窗口内（如 `cell.t` 落在 `[phase-0.12, phase]`）把描边色向白色插值 55%，形成一道沿边框扫过的高光带。聚焦时输入卡边框渐变**流动 + 扫光**，因此**移除** anchor 内独立的 `<NeonRail>`(1391-1393)（原型输入区没有独立导轨；TabBar 的导轨保留）。`test/component/neon-rail-focus.test.tsx` 是合成 harness，不依赖 prompt 布局，不受影响。
- **模型 chip**：把现有 meta 行（1478–1525：agent 名 / auto / · model / provider / · variant）右移进输入行右侧，渲染为 chip：`◆ {model}`（数据 `local.model.parsed()`）。移出后原 meta 行删除，`props.right` 槽（1520）内容接在 chip 之后。
- **发送按钮**：`onMouseUp` 调已有 `submit()`（950-965；`PromptRef.submit` 627-629），hover 换底色；按钮仅在输入非空且未 disabled 时高亮（复用 977-982 的守卫条件）。
- **hints 行**：键位全部用 `useCommandShortcut`（`keymap.tsx:251-259`）动态取，禁止硬编码字符串。现有的 1687-1701 提示（tab agents / ctrl+p commands / esc 中断）搬进新 hints 行，esc 那条按状态条件显示。
- **高度与 flex**：卡片 padding ≥1 + 边框 → 输入区总高 +2~3 行。给状态行（1528）补 `flexShrink={0}`（现在唯一没钉住的），宿主已是 `flexShrink={0}`。`maxHeight`(1385) 不变。
- **autocomplete 定位**：`autocomplete.tsx:139-153` 用 `anchor.x/y/width`，卡片在 anchor **内部** → anchor 几何不变，弹层仍定位在卡片上方。必须实测确认弹层不被卡片遮挡。
- **placeholder**：会话页今天不传 `placeholders` → `list()` 为空 → 无占位符。给会话页补一份默认列表（含原型里的 `"继续刚才的任务"`）。
- 需要 `import "../../ui/card"`（副作用注册 `neonbox`）。

**TDD：** `prompt-card.test.tsx` 断言（a）聚焦时边框 `━`/`╭` 出现且输入区有卡片边框；（b）`发送` 文案存在；（c）hints 行的键位文案来自 keymap（对比 `useCommandShortcut` 结果）。

**Commit：** `feat(tui): 输入区改为霓虹输入卡（模型 chip + 发送 + hints）`

---

### Task A3: 侧栏分区卡片化

**Files:**

- Modify: `packages/tui/src/routes/session/sidebar.tsx`（三个页签的容器与分区）
- Modify: `packages/tui/src/component/file-tree.tsx`（文件树卡 + 选中文件 signal）
- Modify: `packages/tui/src/component/git-panel.tsx`（分支卡 / 变更卡 + 宽度常量）
- Modify: `packages/tui/src/feature-plugins/sidebar/{context,messages,mcp,lsp,todo,files}.tsx`（各分区自渲染为卡）
- Test: `packages/tui/test/component/sidebar-cards.test.tsx`（新建）

**目标结构（对齐原型 `card-design-v7.html:793-868`）：** 每个分区 = `neonbox`，内部首行是 header（图标 + 标题 + 右对齐 badge），其余是原内容。

| 页签       | 分区卡          | badge 数据源                                                                                                      |
| ---------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| 文件       | `📂 资源管理器` | 目录 basename（`node:path` basename，`sidebar.tsx:125` 已有完整目录）                                             |
| 文件       | `🔍 快速预览`   | 选中文件名（需新 plumbing）                                                                                       |
| 待办与统计 | `☑ 当前任务`   | `completed/total`（`sync.data.todo`，sidebar.tsx:78 已在作用域）                                                  |
| 待办与统计 | `📊 会话统计`   | `live`（连接态用 `component/use-connected.tsx:4-12`）                                                             |
| Git        | `⑂ 分支`        | 分支名（`sync.data.vcs?.branch`）+ 领先数（**需新 plumbing**，今天只在 `GitPanel` 局部 `summary.ahead`，148-157） |
| Git        | `± 变更`        | `session_diff` 文件数（`feature-plugins/sidebar/files.tsx:17` 已在用）                                            |

**必须处理的宽度重算（这是本任务的主要成本）：** 侧栏根卡内容区 = `sidebarWidth(44–60)` − 4；嵌套卡再吃 边框 2 + padding 2 = **4 列** → 分区卡内容区变成 **36–52 列**。需要逐个重算并回归的硬编码：

- `feature-plugins/sidebar/files.tsx:35` 截断宽度硬编码 `36` → `32`
- `component/git-panel.tsx:55` `DASH_RUN = "─".repeat(40)` → `36`；`:38-40` `FILE_LABEL_MAX=19` → `15`；`:51-53` `REMOTE_NAME_MAX=10`/`REMOTE_URL_MAX=20` → `8`/`16`
- `component/file-tree.tsx:181` 文件名 `Locale.truncate(node.name, 20)` → `18`；缩进 `depth*2+3`(160/168/187) 需在卡片内重算
- `feature-plugins/sidebar/messages.tsx:15-16` 的 `MESSAGE_MAX=26` 与「侧栏 42 列」注释已过时 → 同步修正
- `component/todo-item.tsx:11-13` `CONTENT_MAX=200` 与「40 列宽」注释 → 复核

**新 plumbing（各一处，遵循仓库既有「模块级 signal」先例，如 `sidebar.tsx:44-49` 的 `sidebarTab`）：**

- 选中文件名：`sidebar.tsx` 导出模块级 `selectedFilePath` signal；`FileTree` 点击时写入、两处卡片读取。若发现 session/home 已有等价 signal（`routes/session/index.tsx:283`），优先复用而非新增。
- Git 领先数：优先复用 `GitPanel` 已有的 `tracking()`(150-157) 结果，通过把分支卡提到 `GitPanel` 内部渲染来避免新数据通道；只有确实需要跨组件时才提数据。

**Commit：** `feat(tui): 侧栏分区改为独立霓虹卡片`

---

## 批次 B —— 明显缺失

### Task B1: 底部状态栏接线

原型 `card-design-v7.html:1134-1144`：路径 / `✓ LSP` / `⚙ MCP 4` / `🔑 权限 0` …… `⑂ main` / `UTF-8` / `● NovaWay local`。

`packages/tui/src/routes/session/footer.tsx` **是死代码**（全仓无渲染点），但它已经实现了大部分内容（mcp 计数 13、lsp 计数 15-16、权限 16-19、目录 20、连接态 21）。做法：在会话页底部（`routes/session/index.tsx:1666-1739` 区域内，Prompt 之上/之下）挂载 `Footer`，并补齐原型缺的三项：分支（`useDirectory()` 已含 `:branch`）、编码（`UTF-8`，取自 config 或常量）、以及把它改成一行紧凑 pill 样式（复用 `neonbox` 或纯 text + gap）。删除 `footer.tsx:23-50` 的 welcome 闪烁定时器（原型无此元素）。

**Commit：** `feat(tui): 会话页接入底部状态栏`

### Task B2: Tab 栏右侧胶囊

原型 `card-design-v7.html:883-888`：`◱ 视图·气泡`、`/ 命令`、`session #12`、`8.2k ctx`。

`tab-bar.tsx` 已是「列布局 = 标签行 + 导轨行」；在标签行右侧加一个 `flexGrow={1}` 的 spacer + 胶囊组。数据：session 短 id、ctx token（`prompt/index.tsx:281-299` 的 usage memo 已有，需上提到 tab-bar 或经 props 传入）。`◱ 视图·气泡` 属于 `/layout` 命令（第二份计划范围），本任务**只做静态胶囊**并在注释里标注待接命令。

**Commit：** `feat(tui): Tab 栏右侧加状态胶囊`

### Task B3: 提示卡（琥珀框 + 动作按钮）

原型 `card-design-v7.html:906-912`：`● 提示 运行 NovaWay upgrade 更新到最新版本 [升级][稍后]`。

`feature-plugins/home/tips-view.tsx:100-259` 已有随机提示文案表。做法：提示条目渲染为 `neonbox gradientStops={[theme.warning]}` 卡；带动作的提示（upgrade）追加两个可点击按钮（`onMouseUp` + hover 底色，镜像 `queue-dock.tsx:111-126`），动作通过 `api.action` 插件接口派发；无动作的提示只显示文案。amber 语义色用 `theme.warning`。

**Commit：** `feat(tui): 提示改为琥珀霓虹提示卡`

---

## 批次 C —— 动效与打磨

### Task C0: 卡片阶梯入场（延迟淡入）

原型 `.stagger` + `--d`：卡片按顺序错落入场。终端等效做法见开头对照表：**延迟淡入**（描边色 ~150ms 内从 `theme.backgroundPanel` 插值到渐变终点色；相邻卡片按索引递增 40ms 延迟）。

**必须解决的闪烁风险：** 消息列表窗口化（`util/message-window.ts`，`MESSAGE_WINDOW_INITIAL=60`）。向上滚动补载窗口时，历史消息会重新挂载 → 若入场动画挂在 mount 上就会整屏闪烁。判定「真正的新消息」的做法（选一种并写注释说明）：以组件首次挂载时记录的最大消息 id 为基线，只有 id 不在基线集合中的消息才播放入场；或用 `message.time.created` 距今 < N 秒。**基线方案优先**（不依赖时钟）。

实现位置：`ui/card.ts` 给 `NeonBoxRenderable` 增加 `enterDelay?: number`（毫秒）+ 内部 `enterStart` 时间戳，`renderSelf` 在 delay 未到前用底色画描边、之后 150ms 内插值到渐变；`ui/neon.ts` 加纯函数 `fadeIn(from, to, k)` 便于单测。批次 A/B 的卡片按需传入 `enterDelay`（同屏内按索引递增）。

**Commit：** `feat(tui): 卡片增加阶梯入场淡入动画`

### Task C1: 卡片渐变流动（悬停 + 聚焦）

原型设计语言①：「所有卡片粉→紫→青渐变描边，**悬停时光晕加深 + 渐变缓慢流动**」。

A2 已为 `NeonBox` 落下 `animated` 原语。本任务把它接到卡片群：给 `UserMessage` / `BlockTool` / 分区卡等的 `neonbox` 增加 `animated={hover()}`，并把「光晕加深」映射为悬停时描边整体提亮（例如对渐变结果做一次向 `theme.text` 混合 12% 的提亮，纯函数放 `ui/neon.ts`）。注意 `UserMessage` 的 hover 事件在**外层** box 上（`index.tsx:1779-1780`），需要把 hover 状态下传给内层卡。

**Commit：** `feat(tui): 卡片悬停时渐变流动并提亮`

### Task C2: 用户消息与思考块 meta 行

原型：用户 `14:32 你`（:918）、思考 `◆ NovaWay 正在工作`（:946）。用户消息已有时间戳但受 `showTimestamps()` 门控且默认隐藏（`index.tsx:290/313/1821`）——按原型改为**常显**的 meta 行（`{time} 你`），并把 `timestamps` KV 的语义收敛（保留开关但默认值改为 show，或直接去掉门控，需在报告里说明）。思考块在 `ReasoningPart` 顶部加 `◆ {agentDisplayName} 正在工作` meta 行（放在思考卡**外、仍在助手卡内**）。

**颜色按原型的两段规则走**（`card-design-v7.html:397-399`，初版实现漏了，已修正）：

```css
.msg-meta {
  color: var(--muted);
} /* 整行默认 muted:时间戳那一段 */
.msg-meta .who {
  color: var(--cyan);
  font-weight: 700;
}
.msg.user .msg-meta .who {
  color: var(--pink);
} /* 用户那条的「你」是 user 语义色 */
```

即**时间戳 muted、「你」取 `semanticStops(theme, "user")[0]`**（就是 `theme.accent`，novaway 深色 `#ff2d7b`，与用户气泡卡描边首端同色）。助手那条 meta 的 `◆` 仍取 `local.agent.color(agent)` 而非原型固定的 `--cyan`——这是**有意的偏离**：色相编码「哪个子代理答的」，与节标题 ◇、思考/工具卡的语义色同源。

**`timestamps` 旗标的最终处理（选「保留并收敛」）：** 它现在控制**整条 meta 行**，默认从 `hide` 翻成 `show`。不删旗标是因为它外面挂着 `session.toggle.timestamps` 命令、`config/keybind.ts` 的 `session_toggle_timestamps` 键位与命令映射、`keymap.tsx` 的斜杠名与优先级表三处，删它要连带处理用户 `keybind.json` 里已写进去的绑定；而「更紧凑的会话流」是真实需求。命令标题随之改成「显示/隐藏用户消息 meta 行」，命令名与斜杠名保持 `timestamps` 不变。

**Commit：** `feat(tui): 用户与思考块补 meta 行`

### Task C3: 工具卡状态行

原型 `card-design-v7.html:928-933` 的 tool-head 含 `✓ 12 passed · 0 failed`。做法：`BlockTool` 的 head 行追加状态摘要（从工具输出里解析 passed/failed 计数；解析规则要简单且可测，例如统计 `✓`/`✗`/`(fail)` 出现次数），无输出时省略。解析函数放 `util/`，配单测。

**Commit：** `feat(tui): 工具卡补状态摘要`

### Task C4: hero 卡补 slogan 与 chips

原型 `card-design-v7.html:895-903`：`NOVAWAY` 大字 + `/// · 任务拆解 · 多体协作 · 自动推进 · ///` + 3 个 chip（`/new 新建会话`、`/models 切换模型`、`ctrl+alt+k 快捷键`）。`component/empty-session-hero.tsx` 已有 logo，补 slogan 行（`textMuted` + `·` 分隔）与 chips 行（chip 文案用 `useCommandShortcut` 取真实键位，取不到则隐藏该 chip）。

**Commit：** `feat(tui): 空会话 hero 卡补 slogan 与快捷键 chips`

---

## 批次 D —— 流程图双视图（原型 `:955-1102` + `:1109-1113` + `:883-888`）

原型有两个聊天视图，靠 `/layout bubble|flow` 切换，Tab 栏右侧有 `视图·气泡` 状态胶囊。**流程图视图是本批次的重点**，包含：节点卡、链式连线（带箭头）、连线标签、轮次分隔线（`第 2 轮`）、边的流动动画、节点悬浮提亮 + `▸` 展开详情、点击选中。

### 关键取舍（已定，写进实现注释）

- **数据来源：真实会话数据**，不是静态 demo。节点类型映射原型语义：用户消息 → `用户输入`；助手 thinking → `任务拆解`；tool part → `工具调用`；`task` 工具（子代理）→ `子代理`；写文件类工具 → `编辑文件`；助手文本 → `NovaWay` 回复；一轮结束 → `本轮结束`。
- **曲线连线 → 正交/直线连线**：终端字符画布没有曲线与亚像素，用 `─ │ ╭ ╮ ╰ ╯ ├ ┤` 走线 + `▸` 箭头（必要时按方向选 `▶ ▼ ◀`）。边的**流动动画**用短划线段沿路径推进（对应原型 SVG 的 `stroke-dashoffset` 动画）—— ⚠️ **落地改成了一次性渐进揭示**（持续流动在流式刷新下没有预算），偏差与理由见 Task D3 的偏差清单。
- **画布缩放/拖动**：原型画布固定尺寸；TUI 用 `position="absolute"` + left/top 定位节点，超宽时画布可横向滚动（不实现缩放与自由拖动，节点位置由算法算出）。
- **视图切换动效**：⚠️ **本条原先写错，已按原型核实后更正**（原型 `card-design-v7.html:637-639` 与 `:1206-1210`）：
  ```css
  .chat-view.show {
    display: flex;
    animation: viewIn 0.45s var(--ease) both;
  }
  @keyframes viewIn {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  ```
  ```js
  off.classList.remove("show")
  on.classList.remove("show")
  void on.offsetWidth
  on.classList.add("show")
  ```
  也就是说：**旧视图当场消失**（没有退场动画，更没有横向滑动），**只有进场的那一个视图**在动，
  动的是 opacity 0→1 + 12px 上移。原先这里写的「切视图时气泡向左滑出、流程图从右滑入」在原型里
  找不到依据，按它实现出来的横向侧滑换页是错的。终端等效手法见 Task D4。

### Task D1: 侧栏「快速预览」卡

原型 `:809-818` 的第二张卡展示**选中文件的代码内容**（带语法高亮的若干行）。A3 判定「侧栏没有预览内容」而跳过——本任务补上：新增模块级 `selectedFile` signal（先例 `sidebar.tsx:44-49` 的 `sidebarTab`）由 `FileTree` 选中时写入；卡片内用现有代码高亮能力渲染前 N 行（先查 `packages/tui/src/component/file-preview.tsx` 或 `<code>` 组件能否复用；能复用就复用，不要另写高亮器）。徽标 = 文件名。文件过大/二进制/无权限时降级为「无法预览」文案。宽度按 `SIDEBAR_CARD_MIN_CONTENT`（36）截断。

**Commit：** `feat(tui): 侧栏补选中文件快速预览卡`

### Task D2: `/layout` 命令 + 斜杠菜单 + Tab 栏右侧胶囊

- `/layout` 斜杠命令：参数 `bubble|flow`，写入会话级 view 状态（存 KV 以便跨会话保持，与 `timestamps` 旗标同范式）。原型 `:1109-1113` 的命令菜单（`命令菜单 · 切换聊天布局视图` + 两行带说明的选项 + 当前项 `✓` 标记）用现有斜杠菜单机制实现（先查 `src/component/command-palette.tsx` / slash 菜单是否已有可扩展的分组/描述位；能复用就复用）。
- Tab 栏右侧胶囊组（原型 `:883-888`）：`◱ 视图·气泡|流程图`（**可点击，切换视图**）、`/ 命令`（可点击，打开命令面板）、`session #<短 id>`、`<n>k ctx`（上下文占用）。数据：session 短 id + usage（`prompt/index.tsx` 的 usage memo 已有，需上提或经 props 传入）。`◱` 与 `视图` 之间的空格按原型排版。
- 胶囊样式统一（圆角/底色/hover），不要每个胶囊各写一套。

**Commit：** `feat(tui): 新增 /layout 视图切换命令与 Tab 栏状态胶囊`

### Task D3: 流程图画布视图

**Files:** 新建 `src/component/flow/`（画布 + 节点卡 + 连线 + 标签 + 轮次分隔）、修改 `src/routes/session/index.tsx`（在 chat 页内按 view 状态二选一渲染）。

**必须实现（对照原型逐项）：**

1. **节点卡**（原型 `.fcard`）：绝对定位的 `neonbox`，按 `data-kind` 上语义描边色（用户=粉紫、任务拆解=紫、工具调用=青、子代理=紫、编辑文件=琥珀、回复=绿/青、本轮结束=绿）；卡内首行 `● 类型 + meta`（时长/步数/时间），次行标题；`▸` 悬浮时出现；点击选中（选中态描边加亮）。
2. **连线**（原型 `.fedge` + `.flabel`）：节点间连线带箭头，线旁标签（如 `用户请求`、`并行 · 工具`、`测试报告 12 ✓`、`edit +6 −2`、`新消息`），标签用 `textMuted` 小字放在线段中点；标签与线不能重叠其它节点卡。
3. **轮次分隔**（原型 `.fsep` `第 2 轮`）：横贯画布的横线 + 居中标签。
4. **边的流动动画**：短划线段沿路径推进（`animations_enabled` 门控），对应原型的边动画。
5. **悬浮/点击**：节点悬浮提亮描边 + 显示 `▸` + 展开详情（原型 `.fc-pop`；终端实现为节点卡右侧/下方展开一个详情框，或把详情写进节点卡的第二行——选一种并说明）。
6. **无数据/单轮/超长会话**都要有合理表现（空态提示、节点过多时纵向排布并可滚动）。

**落地后的偏差（实现与上面两条原文不一致的地方，如实记在这里）：**

- **第 1 条的「`▸` 悬浮时出现」→ 实现为常显**（`component/flow/canvas.tsx:288`）。悬浮才显形在 CSS 里是免费的成本，在终端里却是错的：悬停是一个**瞬时事件**，而箭头是这一行唯一的「这里可以展开」的可供性提示 —— 只在鼠标压上去的那一瞬间出现，等于对键盘用户与触屏根本不存在。所以 `▸ / ▾` 常驻，展开与否仍由点击/回车切换。
- **第 4 条的「短划线段沿路径推进（持续流动）」→ 实现为一次性渐进揭示，走完即静止**（`component/flow/grid.ts` 的 `edgeReveal` / `edgeRevealDelay`）。理由是预算：持续流动要求每一帧重画整张画布的每一条边，而流式追加消息时这张画布每秒都在变；一次性揭示的总时长被钉死在 `EDGE_STAGGER_FRAMES + EDGE_REVEAL_FRAMES`（28 帧 × 60ms ≈ 1.68s），**与边数无关**。持续流动的语义由 `animations_enabled=false` 时走 `REVEAL_ALL`（全部画出）保住 —— 关动画的语义是「别动」不是「别画」。
- 边标签与节点卡的 z 序、以及「连线标签浮在卡片之上」的取舍不在上面这份清单里，实现细节见 `component/flow/canvas.tsx` 的注释。

**TDD：** 画布布局算法（节点位置计算）与连线几何走纯函数 + 单测（不同轮数/节点数下的位置不重叠、连线端点落在节点边界上、标签位置在节点之外）；渲染层用 `testRender` 断言节点卡边框字符、标签文本、轮次分隔线出现在帧里。

**Commit：** `feat(tui): 新增流程图节点链画布视图`

### Task D4: 聊天视图切换的入场过渡（淡入 + 上移，不是侧滑）

按上面「关键取舍」里更正后的行为实现（`animations_enabled=false` 时直接切换）。测试：入场期间至少两帧内容不同、走完之后停在偏移 0 的终态、关掉动画时第一帧即终态；全部通过 `animate` / `frameMs` / `rows` 三个注入口测，不碰 KV。

**终端等效手法（落地的就是这套）：**

| 原型                                       | 终端                                            | 说明                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `translateY(12px)`                         | `position="relative"` + `top` 从 3 行回到 0     | 单元格没有亚像素位移。12px 按常见终端单元格约 4px 高折成 3 行（`ENTRANCE_ROWS = 3`）。位移量化成 3 档，所以帧数取行数两倍（`ENTRANCE_FRAMES = 6`），每行停 2 帧看起来才是匀速                     |
| `opacity: 0 → 1`（.45s）                   | opentui 的真 `opacity`（整棵子树按 alpha 混合） | 不是近似：实测 `opacity=0.4` 时 `#ffffff` 的正文被采成 `#666666`。唯一不参与的是 NeonBox 自绘描边（走 `buffer.setCell`，不吃 opacity 栈），`ui/card.ts` 里补了一次按 `getCurrentOpacity()` 的折算 |
| `animation: … both` + `off.remove('show')` | 换视图时旧视图**当场销毁**、新视图从头播入场    | 两个视图从不共存：既没有「双视图抢消息区高度」，翻页命令按当前视图挑滚动容器就够                                                                                                                  |
| `.45s`                                     | 300ms（6 帧 × 50ms）                            | 终端每帧都要重排整屏字符，位移又只有 3 行，再长只是让用户等                                                                                                                                       |
| 首次挂载                                   | **不播**                                        | 原型首屏那次 `viewIn` 对应「打开会话」；TUI 里这一层会跟着标签切换反复重挂，挂一次播一次就是每次切文件标签都闪一下                                                                                |

**Commit：** `feat(tui): 聊天视图切换加入过渡动画`（后按核实结果修正为 `fix(tui): 视图切换过渡改为原型实际的淡入上移`）

---

## 跨任务共享原语（批次 A 先落地，后续复用）

在 `packages/tui/src/ui/neon.ts` 增加**语义色板**映射，对齐原型设计语言③（提示=琥珀、用户=粉紫、助手=青蓝、思考=紫青、工具=全段、错误=红）：

```ts
export type NeonRole = "user" | "assistant" | "thinking" | "tool" | "error" | "tip" | "input"
// 语义映射见设计文档 §3.1③；缺省 token 由 resolveTheme 兜底到 primary/secondary/accent。
export function semanticStops(theme: Theme, role: NeonRole): readonly RGBA[]
```

这样「哪种卡片是什么颜色」只有一处定义，A1/A2/A3/B3/C1 共用，避免每处各写一份数组。

---

## 验收标准（每批次结束执行）

1. `bun test --timeout 30000`（workdir `packages/tui`）：无新增失败（基线 4 个 `provider-options.test.ts` 既有失败）。
2. `bun typecheck`：干净。
3. 改动文件 `prettier --check` 通过（**不跑 `./script/format.ts`**，它会格式化整个仓库含 1.9GB 的 `XYMT-AUTO/`）。
4. `bunx oxlint packages/tui`：改动文件 0 error。
5. 视觉对照：把真实 TUI 截图与 `card-design-v7.html` 并排比对，逐项确认本批次的要素已还原，且**没有引入**新问题（截断、溢出、错位、闪烁）。
6. 批次 A 额外核对：长会话滚动时卡片边框不漂移/不残影；窄屏（<120 列）侧栏遮罩模式下布局正常；`ctrl+p` 命令面板与 autocomplete 弹层不被卡片遮挡。

## Self-Review 记录

- **原型覆盖**：11 项差距全部落到任务（A1 助手卡 / A2 输入卡 / A3 侧栏卡 / B1 底部栏 / B2 Tab 胶囊 / B3 提示卡 / C0 入场动画 / C1 流动+扫光+悬停提亮 / C2 meta 行 / C3 工具状态 / C4 hero），无遗漏。
- **批次 D（流程图双视图）**：用户明确要求纳入。原型「视图·气泡/流程图」双视图（`:955-1102`）此前被推迟到「第二份计划」，现并入本计划为 D1–D4（侧栏快速预览卡 / `/layout` 命令 + 胶囊 / 节点链画布 / 视图切换的入场过渡），并采用真实会话数据驱动（原型为静态 mock）。SVG 曲线连线在终端用正交走线 + 箭头等效，边动画用短划线推进等效。**D4 原先按「侧滑换页」设计，是错的**：原型没有横向滑动，实现与计划都已按 `:637-639` / `:1206-1210` 更正为「旧视图当场消失 + 新视图淡入上移」。
- **动效覆盖**：原型的阶梯入场（C0 延迟淡入）、聚焦流动描边 + 扫光（A2/C1）、悬停光晕加深 + 渐变流动（C1）、视图切换的 `viewIn` 淡入上移（D4）、边流动（D3）。每项都给出终端可实现的等效手法，不是「省略」。
- **两处原型误读（已在实现里更正并写进注释）**：① D4 的「侧滑换页」在原型里不存在（见上）；② C2 误以为用户 meta 整行都是 muted —— 原型 `.msg.user .msg-meta .who` 是 `--pink`，只有非 `.who` 的部分才是 muted。
- **风险点已前置识别**：A1 的滚动 id 依赖、兄弟链间距、8 个快照测试；A2 的 autocomplete anchor 几何；A3 的宽度重算（已按实测修正为 36/37）；C0 的窗口补载闪烁（用 id 基线规避）；D3 的节点布局不重叠与连线几何；D4 的整行位移与裁剪口（舞台 `overflow="hidden"`，位移期间不抢消息区高度）。
- **共用原语先行**：`semanticStops` 在批次 A 落地，避免 6 处各写颜色数组。
