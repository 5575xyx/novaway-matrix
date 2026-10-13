# 会话状态面板与 Side Pane 收敛设计（ZCode 对标 Round 3）

日期：2026-10-11 · 状态：待评审（修订版 v2，含 Status Panel 方案）

## 1. 背景与目标

Round 2 落地后，桌面端右栏（Side Pane）出现**功能重复与常驻拥挤**：

- 文件树同时存在于左栏「文件」视图与右栏「文件」tab
- 「审查」既是右栏顶级 tab，又是「文件」tab 的子态（两者渲染同一个组件）
- 终端有 header 按钮与右栏「终端」tab 两个入口
- Git 有右栏 tab、header 菜单项，以及一处无消费方的死状态
- 6 个 tab 全部常驻，无空态，右栏始终拥挤
- 状态类信息（Git、Context）与重交互面板（预览、审查、终端）混在同一个 tab strip 里

本次目标：对标 ZCode（`zai-org/ZCode`），**拆分「状态」与「功能面板」两层**——状态进右上角卡片面板，功能面板收敛为按需创建的 Side Pane tab。

## 2. ZCode 参考依据

### 2.1 两套独立结构

ZCode 的会话界面同时存在两个互不相干的东西（`docs/ui/chat-summary-panel.md`、`docs/design/workspace-independent-panels.md`）：

```
┌── conversation frame ────────────────────┐  ┌─ side frame ──────┐
│ WorkspaceHeader                  ┌────┐ │  │ Side Pane tab bar │
│                                 │Git │ │  │ （按需 + 创建）     │
│  消息列（展开态右上让位 168px）     │Todo│ │  │                   │
│                                 │... │ │  │ preview / diff /   │
│  ┌ Composer ──────────┐         └────┘ │  │ code / terminal    │
│  └────────────────────┘                │  └────────────────────┘
└────────────────────────────────────────┘
```

- **Chat Status Panel**：conversation pane **右上角**常驻（`pt-4 right-4`），垂直堆叠的可折叠区块
- **Side Pane**：右侧独立 frame，tab 按需创建、空态 `Open tab`

### 2.2 Status Panel 规则（原文要点）

- 「无用户 override 时由具名 `conversation` container query 裁决形态：容器不足 `1280px` 时显示 mini……**该裁决不得读取 `window.innerWidth`、不得注册 `ResizeObserver`**」
- 「新建任务 / 草稿态不展示 status panel」
- 「已有 task 只有在当前 worktree `added + removed > 0` 时才展示 Git tools 区块；**clean repo 不因为『是 Git repository』而单独挂载 status panel**」
- 「Git、goal、todo、running 都没有可展示内容时，**不挂载 status panel，不预留 inline offset**」
- 「Workspace header 不展示 status panel 开关；展开态通过面板右上角按钮收起，收起态通过摘要行点击展开」
- 区块按 `Git Tools、Goal、计划、进程、终端、智能体` 顺序堆叠，「第二个及后续区块顶部使用 `border-border` 分割线，**缺失的区块不占位也不显示多余分割线**」
- 收起态是 mini 摘要胶囊（`w-max`，只显示一条主状态）；展开态 `w-80`、高度 `min(64dvh, 32rem)`
- 区块可折叠且**限高滚动**（「Goal、计划、终端和智能体展开内容最多占 `12rem`；进程区块最多占 `20rem`」），标题固定在滚动视口外
- 字号只用 UI token：分区标题/Git 行/正文 `text-ui-base`，摘要/变更数量/进度 `text-ui-sm`

### 2.3 Side Pane 规则（原文要点）

- 「side pane 按钮**只负责展开/收起右侧容器，不自动创建 Browser / Review / Terminal 等任何 tab**」
- 「状态改为 `tabs + activeTabId`，而不是单个 `type`」
- 「当 side pane 展开但当前任务没有可见 tab 时显示 `Open tab` 空态页面……**用户必须显式点击空态按钮才会创建 tab**」
- 「关闭最后一个 tab 后，side pane 立即进入收起态」
- 文件树只在左栏；右栏对应物是 Code Viewer / PreviewPane（职责是「看一个文件」而非「浏览目录」）
- Git 变更摘要与提交/推送收敛到 status panel 的 Git Tools；Git 状态改左栏文件树行内联标记

### 2.4 不照搬的部分

ZCode 的 Goal、计划（sessionPlans）、Workflow、终端/智能体（`backgroundWorks`）区块依赖 NovaWay 不存在的协议投影（`GoalState`、`PlanState`、`WorkflowRunState`、`backgroundWorks`）。**这四类区块不实现**。

## 3. 重开的决策

Round 2 规格 `2026-10-10-desktop-layout-ui-redesign-design.md` §3 **决策 3「右栏既有 6 tabs 全部保留进 Side Pane，不减功能」本次作废**。

作废理由：该决策导致 6 个常驻 tab 被完整保留，直接造成「东西太多、功能重复」。ZCode 右栏干净的原因不是 tab 少，而是**状态与功能分层 + tab 按需创建**。

## 4. 现状

### 4.1 Side Pane 状态（`packages/app/src/context/layout.tsx`）

```ts
export type SidePaneTab = "preview" | "terminal" | "files" | "git" | "review" | "context"  // :124

sidePane: {                    // :868
  opened: boolean              // 默认 true
  tab: SidePaneTab             // 单值，默认 "files"
  width: number
  open(tab?) / close() / toggle(tab?) / setTab(tab) / resize(width)
}
```

持久化默认值在 `:374-378`。

### 4.2 重复入口清单

| 功能 | 入口 | 位置 |
| --- | --- | --- |
| 文件树 | 左栏 `tree` 视图 | `layout.tsx:2117` 附近 |
| 文件树 | 右栏 `files` tab | `session-side-panel.tsx:203` |
| 文件树 | header 更多菜单 | `workspace-header.tsx:112` |
| 审查 | 右栏顶级 `review` tab | `session-side-panel.tsx:205` |
| 审查 | `files` tab 子态（同一组件） | `session-side-panel.tsx:317-377`、`session.tsx:315` |
| 终端 | header 按钮（底部 frame） | `workspace-header.tsx:90` |
| 终端 | 右栏 `terminal` tab | `session-side-panel.tsx:202` |
| Git | 右栏 `git` tab | `session-side-panel.tsx:204` |
| Git | header 更多菜单 | `workspace-header.tsx:116` |

### 4.3 重复的直接证据

`session.tsx:517-524`：

```ts
const wantsReview = createMemo(() =>
  isDesktop()
    ? sidePaneShowsFiles() ||      // tab === "files"
      sidePaneShowsReview() ||     // tab === "review"
      desktopFileTreeOpen() ||
      (desktopReviewOpen() && activeTab() === "review")
    : store.mobileTab === "changes",
)
```

`files` 与 `review` 两个 tab 都拉起 review 数据；`session-side-panel.tsx` 中 `props.reviewPanel()` 在 `:373`（files 子态）与 `:390`（review tab）**渲染同一个组件**。

### 4.4 死代码与死状态

| 项 | 证据 | 处理 |
| --- | --- | --- |
| `layout.git`（`layout.tsx:364-367`） | 全仓 grep `layout.git.` 零匹配 | 清除 |
| `session-todo-dock.tsx`（294 行） | `session-composer-region.tsx:21` 仅 import，全仓无 `<SessionTodoDock` | 删除 |
| `task-list.tsx` + `task-list.test.ts` | 全仓无 `<TaskList` | 删除 |

### 4.5 todo 数据链路是活的

`globalSync.data.session_todo`（`global-sync.tsx:46/184-195`）由 `sync.tsx:523` 更新，但**桌面主界面没有任何活的 todo 展示**：`SessionTodoDock`、`TaskList` 均未渲染，唯一消费者是桌宠 `floating-todo-button.tsx:60`。

即「进度」卡片是**新增展示位**（接活数据链路），不是搬迁活功能；同时清理两处死代码。

### 4.6 可复用的既有实现

- `preview` tab 内部已是多 tab 模型（`session-side-panel.tsx:255-296`：`openedTabs()` + `SortableTab` + 拖拽排序 + `+` 新建），顶层 Side Pane 改造复用同一交互约定
- `conv-frame`（`session.tsx:1865`）**已是 `@container`**，可直接用 CSS container query 裁决 Status Panel 形态（与 ZCode 同款，不读 `window.innerWidth`）
- Git snapshot 已有 5s 轮询链路（`git-panel.tsx:16`）
- Context metrics 已有（`session-context-metrics.ts`、`session-context-tab.tsx`）

## 5. 目标设计

### 5.1 Status Panel（新增，conversation 右上角）

**挂载**：`conv-frame` 内、`WorkspaceHeader` 下方的相对容器（`session.tsx:1869`），`absolute top-4 right-4 z-10`（距顶 16px、距右 16px，ZCode 同值）。

**区块**（按渲染顺序，缺失不占位、无多余分割线）：

| 区块 | 数据源 | 展开内容 | 收起摘要 | 不显示条件 |
| --- | --- | --- | --- | --- |
| **Git** | git snapshot 轮询（复用 `git-panel.tsx` 链路） | Changes 行（`+n -n`，点击打开 review）、分支行、Commit 动作行 | `+n -n` | 非 git 仓库，或 `added + removed <= 0` |
| **进度** | `globalSync.data.session_todo` | todo 列表（Checkbox 行，>6 条走聚焦窗口：定位 `in_progress`，显示连续 3 条，前后收敛为「前面 n 项 / 后面 n 项」） | `done/total` | todos 为空 |
| **Context** | `getSessionContextMetrics` + `estimateSessionContextBreakdown` | token 用量与 breakdown（复用 `session-context-tab.tsx` 的 accordion 渲染） | 用量摘要 | 无会话或无数据 |

**形态**：

- 无任何区块可显示时**整个不挂载**，不留占位
- 收起态 = mini 摘要胶囊（`w-max`，仅一条主状态），点击展开
- 展开态 = `w-80`，高度上限 `min(64dvh, 32rem)`
- `conv-frame` container query 裁决：容器 < 1280px 强制 mini；≥ 1280px 展开（用户手动收起/展开写入 per-workspace 偏好覆盖自动）
- 区块折叠状态与限高滚动按 ZCode：进度区块 `max-h-80`、其余 `max-h-48`，标题固定在滚动视口外
- 字号只用 `text-ui-base` / `text-ui-sm`（禁 `text-14-regular` 之类非 `text-ui-*` 类）

**明确不做**：WorkspaceHeader 不加 Status Panel 开关按钮（ZCode 决策）；不实现 Goal / 计划 / Workflow / 后台任务区块（NovaWay 无对应协议投影）。

### 5.2 Side Pane：6 → 3 tab + 按需创建

```ts
sidePane: {
  opened: boolean
  tabs: SidePaneTab[]              // 有序，支持拖拽排序
  activeTab: SidePaneTab | null
  width: number
}
```

```ts
export type SidePaneTab = "preview" | "review" | "terminal"
```

| 旧 tab | 处理 |
| --- | --- |
| `preview` | 保留，内部多文件 tab 结构不动 |
| `review` | 保留，吸收 `files` 的 review 子态 |
| `terminal` | 保留，改为按需创建（非默认常驻） |
| `files` | 移除——目录浏览由左栏文件树承担 |
| `git` | 移除——收敛到 Status Panel 的 Git 区块 |
| `context` | 移除——收敛到 Status Panel 的 Context 区块 |

操作语义：

| 操作 | 语义 |
| --- | --- |
| `toggle()` | **只开关容器**，不接受 tab 参数，不创建、不切换 tab |
| `open()` | 展开容器；无可见 tab 时显示空态 |
| `close()` | 收起容器，保留 tabs |
| `add(tab)` | 新增 tab；已存在则激活并展开 |
| `remove(tab)` | 移除 tab；**移除最后一个时自动收起容器** |
| `setActive(tab)` / `move(from, to)` / `resize(width)` | 激活 / 拖拽排序 / 调宽 |

`toggle()` 从签名上杜绝隐式创建；所有「打开具体 tab」的调用方必须显式改用 `add()`。

**空态**：无可见 tab 时内容区显示「打开标签页」空态 + 三个可创建入口，**点击才创建**。

**持久化迁移**（键沿用 `store.sidePane`）：

1. 旧 `tab` → `activeTab`；`"files"` → `"review"`，`"git"` / `"context"` → `"preview"`
2. `tabs` 初始化为 `[activeTab]` 单元素，**不凭空生成其余 tab**
3. 无持久化数据（新用户）默认 `{ opened: true, tabs: [], activeTab: null }`——**保持 `opened` 默认展开**（`e2e/layout.spec.ts:157` 依赖），展开但无 tab 即空态
4. 旧值非法或缺失字段时，`opened` 沿用可用旧值、缺失才 `true`；`tabs`/`activeTab` 回落为空（空态）
5. 迁移结果写回，避免每次启动重复迁移

### 5.3 去重与清理

- **header 收口**：`workspace-header.tsx:111-115`「文件树」菜单项、`:116-118`「Git」菜单项删除；`:94-101` Side Pane 按钮改纯容器开关；`:84-93` 终端按钮**不动**（已只控制底部 frame）
- **命令入口**（`use-session-commands.tsx`）：`:480` `toggle("files")` 删、`:488` `toggle("git")` 删、`:255` `toggle("review")` → `add("review")`、`:466` `toggle("preview")` → `add("preview")`、`:495` todo 快捷键改切 Status Panel 进度区块
- **审查去重**：`layout.fileTree.tab` 移除 `"review"` 取值（保留 `"changes" | "all"`）；`session.tsx:315` `setTab("review")` → `sidePane.add("review")`；`session.tsx:938` `setFileTreeTab` 签名收紧为 `("changes" | "all")`；`session-side-panel.tsx` 的 files 子态不再渲染 `reviewPanel()`
- **布局 memo**（`session.tsx:340-348`）：`tab() === x` → `activeTab() === x`；`sidePaneShowsFiles` 随 `files` tab 删除
- **`wantsReview` 简化**：

```ts
const wantsReview = createMemo(() =>
  isDesktop()
    ? sidePaneShowsReview() || desktopFileTreeOpen() || (desktopReviewOpen() && activeTab() === "review")
    : store.mobileTab === "changes",
)
```

- **死代码清理**：`layout.git` 状态段、`session-todo-dock.tsx`、`task-list.tsx`、`task-list.test.ts`、`session-composer-region.tsx:21` 死导入；`todoCollapsed`（`layout.tsx:110/1009-1017`）消费方随 `TaskList` 删除一并收敛，`use-session-commands.tsx:495` 与 `session-side-panel.tsx:59` 改接 Status Panel

### 5.4 Git 面板功能变化（有意为之）

`git-panel.tsx` 是完整重交互面板（文件勾选 + `MAX_BATCH 200` 批量提交 + 分支下拉 + 轮询）。收敛后：

- **进卡片**：Changes 行、分支行、Commit 主动作（ZCode Git Tools 三行同构）
- **由 review tab 承担**：文件级变更浏览（review 已有 diff 列表）
- **退化**：「勾选任意文件子集批量提交」不再有独立界面——提交走卡片的 Commit 动作提交全部变更，文件级精细操作需经 review 查看后用其它途径

此退化是 ZCode 对标的一部分（ZCode 同样没有独立文件勾选提交界面），记入验收对照。

## 6. 范围

**包含**：

- `packages/app/src/context/layout.tsx` — sidePane 状态模型 + 迁移、死状态清理
- `packages/app/src/pages/session/status-panel/`（新增）— Status Panel 与三个区块
- `packages/app/src/pages/session/session-side-panel.tsx` — tab strip 收敛、空态、拖拽排序
- `packages/app/src/pages/session.tsx` — 挂载点、布局 memo、`wantsReview`
- `packages/app/src/pages/session/use-session-commands.tsx` — 命令入口
- `packages/app/src/components/session/workspace-header.tsx` — 菜单收口
- `packages/app/src/pages/session/git-panel.tsx` — 拆解（数据链路复用，UI 收敛进卡片）
- `packages/app/src/components/session/session-context-tab.tsx` — breakdown 渲染复用进 Context 区块
- `packages/app/src/i18n/*.ts` — 空态与区块文案
- 死代码删除：`session-todo-dock.tsx`、`task-list.tsx(+test)`

**排除**：

- 底部 Terminal frame 结构与交互（Round 2 已定）
- 左栏「任务 | 文件」segmented 切换（已与 ZCode 一致）
- Git 状态在左栏文件树的内联标记（`M`/`A`/`D`）— 独立跟进项
- Goal / 计划 / Workflow / 后台任务区块（无协议投影）
- Composer、悬浮桌宠、移动端抽屉、`parity.test.ts`

## 7. 兼容边界

- 仅改 React/Solid 状态与布局，不涉及后端协议、服务、Host
- `git` / `context` 数据链路不变，只改展示位置
- 桌面与 Web 共用同一套改造（`packages/app` 两端同源），不分支
- 移动端 `mobileTab` 路径不变；`isDesktop()` 门槛维持现状
- `parity.test.ts` 只断言 2 个键跨 16 locale，新增/删除其它键安全

## 8. 验收

1. Status Panel：无任何可显示区块时**整个不挂载**；clean repo 不显示 Git 区块；todos 为空不显示进度区块
2. `conv-frame` container query 裁决形态，代码不读 `window.innerWidth`、不注册 `ResizeObserver`
3. WorkspaceHeader 无 Status Panel 开关按钮
4. 右栏无可见 tab 时显示空态，不隐式创建；`toggle()` 无参调用不改变 tab 集合
5. 关闭最后一个 tab 后 Side Pane 自动收起
6. `SidePaneTab` 类型只含 `preview`/`review`/`terminal`，全仓 grep 无 `files`/`git`/`context` tab 残留引用
7. header 更多菜单不含文件树与 Git 项；`reviewPanel()` 只渲染一处
8. `fileTree.tab` 仅 `"changes" | "all"`；`wantsReview` 不含 `sidePaneShowsFiles`
9. `layout.git`、`session-todo-dock.tsx`、`task-list.tsx` 清除，无残留 import
10. 旧 `sidePane` 持久化数据迁移后不报错，重复启动不重复迁移
11. UI 字号只用 `text-ui-*`；无新增 Aurora 装饰
12. `bun typecheck` 全绿；`packages/app` unit 与 e2e 通过；oxlint 无新增 error
