# 桌面端布局与 UI 改造设计（ZCode 对标）

日期：2026-10-10 · 状态：已批准（7 节逐节评审通过）

## 1. 背景与目标

对 NovaWay 桌面端布局与视觉做**综合改造**（布局结构 + 视觉体系一次到位），全面对标 ZCode（zai-org/ZCode）并吸收业界共识。

**调研结论**（AI 编程工具桌面端，2025–2026）：

- ZCode：三栏工作台——左侧任务中枢侧栏（任务列表↔文件树整列切换，行内状态点 + `±`变更统计）、中央对话流、右侧 Side Pane（预览/终端/文件/Git 可切换）；`DESIGN.md` 将 UI 规则写为机器可遵循的约束（`text-ui-*` 字阶、4px 节奏、层级圆角、克制深度），桌面/Web 共用一套 UI。
- 业界共识：任务/会话侧栏成一级导航；可拖 pane 与布局持久化；Diff 审阅一等化；内置浏览器+元素点选；模式收进输入行；视觉刻意克制（低噪声、显式状态）。
- NovaWay 现状差距：侧栏以项目/工作区树为组织单位，缺任务状态可见性与变更统计；预览为聊天并排 split 而非独立 Side Pane；Aurora 装饰体系（径向渐变/毛玻璃/模式色 glow）与克制范式冲突。

## 2. 范围

- **两端统一改**：`packages/app` 为桌面/Web 共用，同一套新布局，不分支。
- **节奏**：一期完成（布局 + 视觉）。
- **视觉基调**：5 模式系统保留但**退为轻量标识**（色点/名称/色条），不注入大面积色调；视觉全面语义 token 化。
- **排除项**：悬浮桌宠（独立窗口）、移动端抽屉机制（沿用现状）、Pulse 运营布局与 Office 编辑器的结构（仅随 token 收敛视觉）、后端新聚合端点（跟进项，见 §8）。

## 3. 整体布局架构

四个独立 frame + **4px 可拖间隙**（取代连续拼接），每 frame 自带背景与边框：

```
┌──────────────────────── Titlebar (50px, 保留) ────────────────────────┐
│ ◀▶ │ Logo │ 模式色点+名称▾ │ …… │ 主题·设置·状态        [Win caption]│
├─────────────┬─┬─────────────────────────────┬─┬───────────────────────┤
│  Sidebar    │4│      Conversation           │4│      Side Pane       │
│  默认 280px  │p│  WorkspaceHeader(单行)      │p│  默认 360px          │
│  min 240    │x│  MessageTimeline            │x│  tabs: 预览/终端/     │
│  max 30vw   │ │  Composer                   │ │  文件/Git/Review/     │
│  可折叠     │ │                             │ │  Context             │
├─────────────┴─┴─────────────────────────────┴─┴───────────────────────┤
│  Terminal frame（可选，默认高 280px，关闭后入口在 Side Pane 终端 tab） │
└───────────────────────────────────────────────────────────────────────┘
```

关键决策：

1. **split 预览取消** — 聊天列不再并排预览；预览一律走 Side Pane（单击文件 → Side Pane 预览 tab，ZCode 同款）。
2. **终端双形态** — 底部独立 frame（默认关闭，可拖高/开关，与现状抽屉习惯一致）；Side Pane 保留终端 tab。Side Pane 默认开启（对应现状右栏默认可见）。
3. **右栏既有 6 tabs 全部保留**进 Side Pane，不减功能。
4. **尺寸** — Sidebar 默认 344→280（任务行密度高于项目树）；Side Pane 默认 360，max 60vw。
5. **响应式** — 沿用现断点机制：`xl`(1280) 以下 Sidebar 变抽屉；`md`(768) 以下 Side Pane/Terminal 降为底部 tab。
6. **路由与 Provider 树不动** — `/:dir/session/:id`、LayoutProvider 扩展而非重写。

## 4. 侧栏信息架构

「任务列表 ↔ 文件树」**整列切换**（不并存），顶部 segmented 切换 + 搜索 + 新建。

**任务视图（默认）**：

- 状态过滤条：全部 / 运行中 / 待确认 / 已归档（前端过滤）。
- 列表按**项目分组**（可折叠分组头：项目名 + 任务计数 + 菜单）。
- **层级：两层「项目 → 任务」**（批准的 a 方案）：worktree 退为任务行内分支徽标（`⎇ feat/pay`）。
- 任务行 = 状态点 + 标题 + 分支 + 相对时间 + `±`变更统计 + 状态徽标（如「待确认」）。
- 状态语义：🟢 运行中（呼吸动效）· 🟡 阻塞/待确认 · 🔴 失败 · ⚪ 空闲/完成。
- 选中行左侧 2px 模式色条（模式轻量标识落点之一）。
- 右键菜单：置顶 / 归档 / 重命名等沿用现有会话菜单能力。

**文件树视图**：

- 整列替换任务列表；顶部「← 返回任务」。
- 聚合当前项目 Git 状态：M/A/D 徽标 +「仅变更」过滤，底部常显 `±` 汇总。
- 单击文件 → Side Pane 预览 tab；双击 → 外部编辑器（沿用现状约定）。
- 复用现有 FileTree 组件能力，仅调挂载位置与过滤条。

## 5. 会话页工作区

**Conversation frame**：

- **单行 WorkspaceHeader**（原 SessionHeader 多行压缩）：标题 + 工作区徽标 + 模型选择 + 执行档 + 终端/Side Pane 开关 + 更多菜单。
- 对话流密度收紧；工具调用默认折叠（沿用现有折叠能力）。
- Composer 保留全部 dock（permission/question/todo/followup/revert），输入行增**模型 + 上下文预算**徽标。

**Side Pane**：现有 tabs（预览/终端/文件/Git/Review/Context）全保留；预览 tab 顶栏带地址/刷新（内嵌预览能力沿用）；可拖宽、可折叠。

**Terminal frame**：底部独立 frame，多任务 tab + 运行状态点，顶部 3px 拖拽条调高；关闭不丢 tab 状态（高度已持久化）。

**状态模型变更**：`viewMode: chat|split|preview` 三态简化为 `sidePaneOpen + sidePaneTab` 与 `terminalOpen` 两个正交开关；split 概念移除。

## 6. 视觉体系：Aurora → 语义克制

**移除**：

- `tech-radial-light/dark` 径向渐变背景 → 纯 `--background-base`
- `aurora-overlay` 毛玻璃层
- `active-glow` 等模式色 glow 动画
- titlebar 渐变描边
- 模式色大面积铺底（`--novaway-mode-*` 的铺底用法；变量机制保留供点缀）
- 装饰性大圆角（面板 16px → 8px）

**新增 / 对齐**：

- `text-ui-*` 字阶：`xl/lg/base/caption/sm/xs`（基准 `--ui-font-size` 14px），UI 层禁用 Tailwind 内置 `text-sm/base` 与任意字号；代码/Diff/终端内容保留独立字号设置。
- 表面三层级严格执行：`background` → `card/surface` → `popover`；页面根 `bg-background + text-foreground`。
- 4px 间距节奏；圆角层级 `xl→lg→md→sm`（首个圆角容器起算，控件随最近圆角父级降档）。
- 深度收敛：常态无阴影，`shadow-md` 仅菜单/弹层，`shadow-lg` 仅 toast/重要浮层。
- 状态色语义化：绿=通过/运行、黄=待确认、红=失败；diff 用 diff 专属色。

**收敛保留**：

- 5 模式：titlebar 色点+名称、侧栏选中行 2px 色条、命令面板切换；`data-app-mode` 与 `mode` 状态保留。
- 39 套主题：继续驱动语义 token（主题=换 token 值，不换结构）。
- `page-transition` 功能性过渡保留。

**实现路径**：样式收敛在 `packages/ui`（theme.css/colors.css token 层 + 组件 css）与 `packages/app`（index.css 的 Aurora 类、layout.tsx 的 modeStyle 注入点）。不新增主题，仅调 token 用法与装饰类去留。

## 7. 外围表面

- **Titlebar（50px 保留）**：左 前进/返回 + Logo；中 模式切换（色点+名称，替代模式色按钮）；右 主题、记忆进化、缓存、设置/数据库 + Windows caption 138px。渐变描边移除，底色 `--background-base`。
- **首页（批准的 A 方案：任务中心）**：`/` 的 `ModeHomePage` 替换为 `TaskCenterPage` —— 最近任务流 + 新建 + 状态过滤 + 快速入口（与侧栏任务视图同构）；模式选择让位给 titlebar。Provider 树与路由结构不变。
- **设置页 / 数据库页**：全屏覆盖结构不动，内部随 token/字阶收敛。
- **命令面板**：保留全部命令（主题/模式循环、快捷键），视觉改菜单规范（`bg-menu` + 稠密行 + rounded-lg）。
- **Pulse / Office**：结构不动，仅随 token 收敛。
- **桌宠 / 移动端抽屉**：不在范围。

## 8. 状态与数据流

**LayoutProvider 变更**（`packages/app/src/context/layout.tsx`）：

| 动作 | 项                                                   | 说明                                             |
| ---- | ---------------------------------------------------- | ------------------------------------------------ |
| 移除 | `viewMode: chat\|split\|preview`                     | split 取消                                       |
| 新增 | `sidePaneOpen`、`sidePaneTab`                        | Side Pane 开关与激活 tab                         |
| 新增 | `terminalOpen`                                       | Terminal frame 开关（高度沿用 `terminalHeight`） |
| 新增 | `sidebarView: tasks \| tree`                         | 侧栏整列切换                                     |
| 迁移 | `sessionPanelWidth`/`previewWidth` → `sidePaneWidth` | 默认 360，max 60vw                               |
| 迁移 | `sidebarWidth` 默认 344 → 280                        | 仅改默认值，已存用户值不覆盖                     |
| 保留 | `mode`、其余 panel 宽度、持久化机制                  | 不动                                             |

持久化策略：存储键 **bump 版本号**——随版本废弃的键（`viewMode`、`sessionPanelWidth`、`previewWidth`）直接清除；仍有效且语义不变的宽度键（`sidebarWidth`、`terminalHeight` 等）保留已存值，仅当用户从未设置时使用新默认。不做逐键迁移逻辑。

**任务侧栏数据流**：现有 SDK `sessions`/`projects` 查询 + 运行状态（已有）→ 前端过滤/分组。`±`变更统计为**条件渲染**：首期无聚合数据则不显示数字；后端 per-session diff 聚合列跟进项，不阻塞布局落地。

**桌面端 IPC**：`--background-base` → 窗口背景色同步机制照旧，零改动。

**快捷键/IPC 兼容**：`Cmd+B` 侧栏、`Ctrl+\`` 终端、菜单命令、深链、桌宠 IPC 全部不动。

## 9. 错误处理与验证

- 状态解析失败 → 沿用 LayoutProvider 现有回退默认值，不新增 try/catch 模式。
- 任务状态流断开 → 行显示灰点（未知态），列表纯前端降级可用。
- 验证环：`bun lint` → `bun typecheck` → `cd packages/app && bun test`（Playwright e2e 选择器随布局更新）→ 手动清单：**桌面 + Web 两端 × 明暗 × 主题抽查 × 断点（xl/md）× 四 frame 开关组合**。

## 10. 已知依赖与跟进项

1. 后端 per-session `±` 变更行数聚合（侧栏统计从「条件渲染」升级为「常显」）。
2. 会话运行状态（运行中/待确认/失败）到侧栏行的映射复用现有 permission/运行状态源，需在实施中核对字段可用性。
3. 外部编辑器打开、元素点选等既有高级能力不在本次改动清单内，实施时按现状回归。
