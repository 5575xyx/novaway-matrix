# 桌面端可拖动悬浮助手挂件实施计划

## 摘要

为 NovaWay 桌面端新增一个独立的可拖动悬浮助手挂件窗口：

1. 只要应用运行，该挂件始终悬浮在桌面上，即使主窗口最小化也不消失。
2. 挂件支持拖拽改变位置，可展开/收起，包含“当前智能体”和“待办清单”两个标签页。
3. 对话过程中因用户输入触发 build/plan 切换时，挂件上的当前智能体实时同步。

## 当前状态分析

- `packages/app/src/components/floating-todo-button.tsx` 已实现机器人按钮 + Agent/Todo 面板，但嵌在会话页面内，依赖 `useSessionLayout` 获取当前会话 key，无法直接用于独立窗口。
- `packages/app/src/context/local.tsx` 通过 `Persist.workspace` 把 agent/model 选择持久化到平台 storage；桌面端实际走 `window.api.storeGet/storeSet`（Electron store）。
- `packages/app/src/components/prompt-input/submit.ts` 在提交时已调用 `forgeAgentForPrompt` 并在 agent 变化时执行 `local.agent.set(agent)`，因此主窗口内的 agent 状态已能切换。
- `packages/desktop/src/main/windows.ts` 提供 `createMainWindow`/`createLoadingWindow`，尚无独立的悬浮窗口创建函数。
- `packages/desktop/src/main/index.ts` 在 sidecar 初始化完成后创建主窗口，未管理额外窗口。
- `packages/desktop/electron.vite.config.ts` 的 renderer 入口只有 `main` 和 `loading`，需要新增 `floating` 入口。
- 现有 IPC（`packages/desktop/src/main/ipc.ts` / `preload/index.ts` / `preload/types.ts`）已覆盖 store、窗口焦点等，但缺少跨窗口广播当前会话/agent 的通道。

## 拟议变更

### 1. 抽离可复用的悬浮助手 UI 组件

**文件**：`packages/app/src/components/assistant-panel.tsx`（新建）

**内容**：

- 将 `floating-todo-button.tsx` 中的 `RobotIcon`、`StatusIcon`、`AgentTab`、`TodoTab` 抽离为纯展示组件。
- `AssistantPanel` 接收以下 props，不依赖 `useSessionLayout`：
  - `currentAgent?: AgentItem`
  - `agents: AgentItem[]`
  - `tasks: Task[]`
  - `expanded: boolean`
  - `activeTab: TabId`
  - `onExpandToggle: () => void`
  - `onTabChange: (tab: TabId) => void`
  - `onAgentChange: (name: string) => void`
  - `title?: string`
  - `draggable?: boolean`（用于给机器人按钮添加 `-webkit-app-region: drag`）

**原因**：主窗口内的 `FloatingTodoButton` 和桌面独立悬浮窗口需要共用同一套 UI，但运行上下文不同，必须通过 props 解耦。

### 2. 改造主窗口内的悬浮按钮以复用新组件

**文件**：`packages/app/src/components/floating-todo-button.tsx`

**内容**：

- 删除内嵌的 `RobotIcon`、`StatusIcon`、`AgentTab`、`TodoTab` 实现。
- 保留 `useSessionLayout` 获取当前会话、读取 `globalSync` 中的待办。
- 渲染新的 `AssistantPanel`，把当前 agent、任务列表、展开状态等作为 props 传入。
- 保持现有行为：任务数从 0 变 >0 时自动展开并切换到待办标签；用户手动收起后不再自动展开。

**原因**：避免两份 UI 实现，后续功能扩展只需改一处。

### 3. 新增悬浮窗口 renderer 入口

**文件**：

- `packages/desktop/src/renderer/floating.html`（新建）
- `packages/desktop/src/renderer/floating.tsx`（新建）

**内容**：

- `floating.html`：提供 `<div id="root">` 的极简 HTML。
- `floating.tsx`：
  - 调用 `initI18n()`。
  - 复用 `createPlatform()` 构造桌面平台对象（与 `index.tsx` 一致）。
  - 等待 `window.api.awaitInitialization` 完成。
  - 使用 `PlatformProvider` + `AppBaseProviders` 包裹悬浮组件。
  - 由于悬浮窗口没有 URL 路由，需要在一个独立上下文中初始化 `LocalProvider`；但 `LocalProvider` 内部依赖 `useParams`，在悬浮窗口中无路由参数。
  - 因此，悬浮窗口不直接使用 `LocalProvider`，而是通过 IPC 从主窗口获取当前目录和当前 agent，并用本地 signal 展示。
  - 渲染 `AssistantPanel`，props 来源：
    - `currentAgent`、`agents`：通过 IPC 请求主窗口当前状态。
    - `tasks`：通过 IPC 请求当前会话的待办列表，或先仅展示 agent 标签页（MVP 阶段待办可暂不展示，避免跨窗口同步待办的复杂度）。
  - 机器人按钮设置 `style={{ "-webkit-app-region": "drag" }}` 以支持拖动。

**原因**：悬浮窗口是独立入口，必须自己完成平台初始化，同时避免引入路由依赖。

### 4. Electron 主进程新增悬浮窗口创建函数

**文件**：`packages/desktop/src/main/windows.ts`

**内容**：

- 新增 `createFloatingWindow()`：
  - `width: 320, height: 400`
  - `frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false`
  - `parent: undefined`（关键：不挂到主窗口，主窗口最小化时仍显示）
  - `webPreferences: { preload: join(root, "../preload/index.js"), contextIsolation: true, nodeIntegration: false }`
  - `icon: appIcon`
  - 初始位置：屏幕右下角（可用 `screen.getPrimaryDisplay().workAreaSize` 计算）。
  - 加载 `floating.html`（通过 `loadWindow`）。
  - `ready-to-show` 后显示。

**原因**：只有独立的顶层窗口才能在主窗口最小化后继续悬浮。

### 5. 主进程管理悬浮窗口生命周期与状态广播

**文件**：`packages/desktop/src/main/index.ts`

**内容**：

- 在 `mainWindow = createMainWindow()` 之后调用 `floatingWindow = createFloatingWindow()`。
- 主窗口关闭时（`mainWindow.on("closed")`）同步关闭悬浮窗口。
- 监听主窗口最小化事件，悬浮窗口保持显示。
- 将 `floatingWindow` 引用暴露给 IPC 处理函数，或提供专用 IPC：
  - `floating:agent-state`：renderer 调用以获取当前 agent 和可用 agent 列表。
  - `floating:set-agent`：renderer 调用以请求切换 agent，主窗口需要响应并更新状态。

**原因**：主进程是唯一能同时访问主窗口和悬浮窗口的对象，负责协调两者。

### 6. 扩展 IPC 以支持悬浮窗口状态查询与切换

**文件**：

- `packages/desktop/src/preload/types.ts`
- `packages/desktop/src/preload/index.ts`
- `packages/desktop/src/main/ipc.ts`

**内容**：

- 在 `ElectronAPI` 中新增：
  - `getFloatingAgentState: () => Promise<{ current?: string; agents: { name: string; mode: string; hidden?: boolean; options?: Record<string, unknown> }[] }>`
  - `setFloatingAgent: (name: string) => Promise<void>`
  - `onFloatingAgentChange: (cb: (agent: string) => void) => () => void`
- preload 中做对应桥接。
- ipc.ts 中：
  - `getFloatingAgentState`：从主窗口的 webContents 发送请求并等待回复；主窗口内监听该事件，读取 `local.agent.current()` 和 `local.agent.list()` 后返回。
  - `setFloatingAgent`：向主窗口发送事件，主窗口内调用 `local.agent.set(name)`。
  - 当主窗口内 agent 变化时，主动向悬浮窗口发送 `floating-agent-change` 事件。

**原因**：悬浮窗口无法直接访问主窗口的 SolidJS context，必须通过主进程中转。

### 7. Vite 配置新增悬浮窗口入口

**文件**：`packages/desktop/electron.vite.config.ts`

**内容**：

- 在 `renderer.build.rollupOptions.input` 中新增 `floating: "src/renderer/floating.html"`。

**原因**：electron-vite 需要知道打包该入口。

### 8. 主窗口内监听悬浮窗口的 agent 切换请求

**文件**：`packages/desktop/src/renderer/index.tsx`（或新增 `src/renderer/floating-bridge.ts`）

**内容**：

- 在 `Inner` 组件或 `onMount` 中：
  - 监听 `request-floating-agent-state` IPC 事件，调用 `useLocal()` 读取当前 agent/list，通过 `window.api` 返回。
  - 监听 `set-floating-agent` IPC 事件，调用 `local.agent.set(name)`。
  - 在 `createEffect` 中监听 `local.agent.current()?.name`，变化时调用 `window.api.notifyFloatingAgentChange(name)`。

**原因**：让主窗口作为 agent 状态的“权威来源”，悬浮窗口只负责展示和发起切换请求。

### 9. 验证 prompt-input/submit.ts 的同步逻辑

**文件**：`packages/app/src/components/prompt-input/submit.ts`

**内容**：

- 确认现有代码已执行：
  ```ts
  if (agent !== currentAgent.name) {
    local.agent.set(agent)
  }
  ```
- 该改动已在之前的会话中完成，本次计划只需验证它仍能正确触发主窗口的 `createEffect`，进而通过 IPC 通知悬浮窗口更新。

**原因**：这是“实时切换”的源头；主窗口状态变更后，通过步骤 8 的 effect 广播到悬浮窗口。

## 假设与决策

1. **MVP 范围**：悬浮窗口首版仅展示“当前智能体”和“切换智能体”功能；待办清单因涉及跨窗口同步当前会话 ID 和任务数据，可在第二阶段补齐，或先通过 IPC 透传主窗口当前会话的待办快照。
2. **拖拽实现**：使用 `-webkit-app-region: drag` 让 Electron 自动处理窗口拖动，避免自己维护鼠标事件和 `setPosition` 的跨平台差异。仅机器人按钮设置 drag，避免面板交互被拦截。
3. **状态同步**：不引入新的全局状态库，复用现有 `local.agent` + 主进程 IPC 广播。悬浮窗口启动时向主窗口请求一次全量状态，之后依赖主窗口主动推送变更。
4. **悬浮窗口不挂载 LocalProvider**：`LocalProvider` 依赖 `useParams` 和会话路由，悬浮窗口无路由上下文，直接通过 IPC 与主窗口交互更简单。
5. **平台适配**：先在 Windows 桌面端验证；macOS/Linux 的 alwaysOnTop/透明窗口行为可能存在差异，但代码保持平台无关。
6. **不修改 app 包入口**：`packages/app/src/index.ts` 仅导出 `AppBaseProviders`/`AppInterface`/`PlatformProvider` 等，不需要新增导出；`AssistantPanel` 从 `@opencode-ai/app` 导出或直接从 `app` 包内部引用。

## 验证步骤

1. 在 `packages/desktop` 运行 `bun dev`，启动桌面端。
2. 确认主窗口右下角出现新的独立悬浮机器人图标；拖动图标可改变窗口位置。
3. 最小化主窗口，确认悬浮机器人仍在桌面可见。
4. 点击机器人展开面板，确认显示当前 agent（如 plan/build）。
5. 在悬浮面板中点击另一个 agent，确认主窗口输入区或会话状态同步切换。
6. 在主窗口发送一段明确触发 build 意图的文本（如“开始执行方案”），确认悬浮面板当前 agent 实时变为 build。
7. 运行 `bun lint` 和 `bun typecheck`（在相关包目录），确认无新增错误。
8. 若根目录 `bun lint` 因内存限制失败，改为对本次改动文件单独运行 `bunx oxlint` 并在验证报告中记录。
