# 桌面端可拖动悬浮助手挂件 - 实施计划

## 背景与目标

用户希望把应用内的右下角悬浮助手（机器人图标 + 智能体/待办面板）变成**真正的桌面挂件**：

- 可以用鼠标拖动到屏幕任意位置。
- 即使 Novaway 桌面端主窗口最小化或隐藏，挂件仍然悬浮在桌面最上层。
- 点击挂件后仍能展开“智能体/待办”面板。

同时，作为配套修复，已把 `prompt-input/submit.ts` 中自动从 plan 切换到 build 的逻辑同步回 `local.agent.set(...)`，使悬浮面板里的“当前智能体”能在会话进入构建模式时实时更新。

## 推荐方案：独立的 always-on-top BrowserWindow + IPC 状态推送

不采用在主窗口内用 DOM 浮层实现，因为 DOM 浮层无法逃脱主窗口；主窗口最小化后浮层必然消失。因此新建一个独立的 `BrowserWindow`：

- `frame: false`、`alwaysOnTop: true`、`skipTaskbar: true`。
- 默认收起为 64×64 的机器人图标，点击展开为 320×432 的面板。
- 使用 `electron-window-state`（或 `electron-store`）持久化窗口位置。
- 状态由主窗口通过 IPC 推送给挂件，避免在第二个渲染进程里再搭一整套 `Server / GlobalSDK / GlobalSync / Layout / Local` provider 树。
- 挂件内支持点击切换智能体：点击后通过 IPC 回传主窗口，由主窗口执行 `local.agent.set(...)`，随后主窗口把新状态再推回挂件。

## 关键改动文件

### App 层（复用 UI + 状态桥接）

| 文件                                                   | 改动                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/app/src/components/assistant-panel.tsx`      | 新增。从 `floating-todo-button.tsx` 抽离出纯 UI：`RobotIcon`、`StatusIcon`、`AgentTab`、`TodoTab`、`AssistantPanel`。`AssistantPanel` 接收渲染所需的所有数据和回调（`mode`、`currentAgent`、`agents`、`tasks`、`uiStrings`、`onAgentSelect`、`onExpandedChange`、`variant`）。 |
| `packages/app/src/components/floating-todo-button.tsx` | 改为上下文包装器：读取 `useLocal` / `useLayout` / `useGlobalSync` / `useSessionLayout`，计算状态后渲染 `<AssistantPanel variant="in-app" ... />`。                                                                                                                             |
| `packages/app/src/components/widget-state-bridge.tsx`  | 新增。挂在目录布局内，聚合当前会话的 agent/todo/语言文案，通过 `window.api.sendWidgetState(state)` 推送给主进程；同时监听 `window.api.onWidgetRequestState` 并在收到请求时立即再推一次。                                                                                       |
| `packages/app/src/widget-state.ts`                     | 新增。定义 `WidgetAssistantState` 类型与 `filterAgentsForMode` 辅助函数。状态里包含已经翻译好的 UI 字符串（tab 名称、当前智能体/切换到、空状态等），让挂件无需自己加载 i18n 字典。                                                                                             |
| `packages/app/src/pages/directory-layout.tsx`          | 在 `<LocalProvider>` 内部插入 `<WidgetStateBridge />`，使其能访问 Local / SDK / Sync / GlobalSync 上下文。                                                                                                                                                                     |
| `packages/app/src/index.ts`                            | 导出 `AssistantPanel`、`WidgetStateBridge`、`WidgetAssistantState`，供 desktop 包引用。                                                                                                                                                                                        |

### Desktop 层（窗口、IPC、渲染入口）

| 文件                                        | 改动                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/preload/types.ts`     | 扩展 `ElectronAPI`：增加 `sendWidgetState`、`onWidgetState`、`onWidgetRequestState`、`widgetMove`、`widgetSetExpanded`、`widgetDragStart`、`widgetDragEnd`、`widgetSelectAgent` 类型。                    |
| `packages/desktop/src/preload/index.ts`     | 实现上述 API，用 `ipcRenderer.send` / `ipcRenderer.on` 封装。                                                                                                                                             |
| `packages/desktop/src/main/windows.ts`      | 新增 `createFloatingWidgetWindow()`、`showFloatingWidget()`、`moveFloatingWidget()`、`setFloatingWidgetExpanded()`、`destroyFloatingWidget()`，维护 `widgetWindow` 引用与位置持久化；加载 `widget.html`。 |
| `packages/desktop/src/main/ipc.ts`          | 注册 widget 通道：`widget:push-state`（缓存并转发给挂件）、`widget:move`、`widget:set-expanded`、`widget:drag-start/end`、`widget:select-agent`（转发给主窗口执行）。                                     |
| `packages/desktop/src/main/index.ts`        | 主窗口创建后创建并显示挂件；主窗口关闭/应用退出时销毁挂件。                                                                                                                                               |
| `packages/desktop/src/renderer/widget.html` | 新增挂件入口 HTML。                                                                                                                                                                                       |
| `packages/desktop/src/renderer/widget.tsx`  | 新增挂件渲染入口：导入应用样式，监听 `onWidgetState`，渲染 `<AssistantPanel variant="widget" ... />`；处理 pointer 拖拽事件与点击展开/收起。                                                              |
| `packages/desktop/electron.vite.config.ts`  | `renderer.build.rollupOptions.input` 增加 `widget: "src/renderer/widget.html"`。                                                                                                                          |

## 窗口与拖拽细节

### 窗口选项

```ts
new BrowserWindow({
  width: 64,
  height: 64,
  x: saved.x,
  y: saved.y,
  show: false,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  focusable: true,
  acceptFirstMouse: true,
  hasShadow: false,
  transparent: true,
  backgroundColor: "#00000000",
  webPreferences: {
    preload: join(root, "../preload/index.js"),
    contextIsolation: true,
    nodeIntegration: false,
  },
})
```

- macOS 额外设置 `type: "panel"`，使其不进入 Cmd+Tab。
- 初始位置无缓存时，取 `screen.getPrimaryDisplay().workArea` 右下角留边。
- 展开时以图标右下角为锚点计算新 bounds，保证图标始终停在用户拖放的位置。

### 拖拽实现

1. 在机器人按钮的 `pointerdown` 时调用 `setPointerCapture` 并记录初始偏移。
2. `pointermove` 时把屏幕坐标通过 `window.api.widgetMove({ x, y })` 发送给主进程，主进程立即 `win.setBounds({ x, y })`。
3. `pointerup` 时释放 capture，发送 `widgetDragEnd()`，主进程保存位置。
4. 在 `click` 中判断是否发生过有效移动：若移动距离超过阈值则视为拖拽，阻止展开/收起。
5. 如果 `setPointerCapture` 在透明/置顶窗口上无法追踪到窗口外，可回退为 `pointerdown` 发送 `widgetDragStart()`，主进程通过定时读取 `screen.getCursorScreenPoint()` 来更新窗口位置，直到 `widgetDragEnd()`。

## 状态同步与双向交互

### 主窗口 → 挂件

`WidgetStateBridge` 聚合的状态结构：

```ts
interface WidgetAssistantState {
  directory?: string
  sessionID?: string
  mode?: AppMode
  currentAgent?: AgentItem
  agents: AgentItem[]
  tasks: Task[]
  taskCount: number
  hasInProgressTask: boolean
  uiStrings: {
    agentTab: string
    todoTab: string
    currentAgentLabel: string
    switchToLabel: string
    emptyTodo: string
  }
}
```

- `currentAgent` / `agents` 使用主窗口已计算好的显示名称和颜色。
- `tasks` 只包含当前会话的 `session_todo`。
- `uiStrings` 在主窗口里用当前语言 `t()` 生成，挂件无需单独加载 i18n。

推送流程：

1. `WidgetStateBridge` 用 `createEffect` 监听相关信号变化，调用 `window.api.sendWidgetState(state)`。
2. 主进程 `ipcMain.on("widget:push-state", ...)` 缓存 `lastWidgetState` 并转发给 `widgetWindow.webContents.send("widget:state", state)`。
3. 挂件 `webContents` 加载完成后，如果缓存存在立即补发一次；同时挂件 mount 后调用 `window.api.widgetRequestState()`，主进程向主窗口广播请求，`WidgetStateBridge` 收到后再推一次。

### 挂件 → 主窗口（切换智能体）

1. 挂件内点击某个 agent 时调用 `window.api.widgetSelectAgent(agentName)`。
2. 主进程通过 `mainWindow.webContents.send("widget:select-agent", agentName)` 转发。
3. 主窗口在 `WidgetStateBridge` 中监听 `onWidgetSelectAgent`，找到对应 agent 后执行 `local.agent.set(agentName)`。
4. 状态变化后自动触发推送，挂件高亮更新。

## 验证步骤

1. 类型检查：
   ```bash
   bun --cwd packages/app typecheck
   bun --cwd packages/desktop typecheck
   ```
2. 启动桌面开发环境：
   ```bash
   bun --cwd packages/desktop dev
   ```
3. 主窗口加载完成后，确认屏幕右下角/上次位置出现机器人图标。
4. 拖拽：按住图标拖动到屏幕其他位置，释放后位置更新；重启应用后位置保持。
5. 始终置顶：最小化主窗口，确认挂件仍可见；在其他应用上方时挂件保持在最上层。
6. 展开：点击图标，窗口展开为 agent/todo 面板，内容与主窗口一致。
7. 智能体同步：在主窗口或挂件内切换 agent，观察另一边高亮同步；会话进入构建模式时挂件“当前智能体”自动变为“锻造工程”。
8. 待办同步：触发 sidecar 产生新的 todo，确认挂件角标数字与列表同步。
9. 静态检查：对改动文件运行 `bunx oxlint`；根目录 `bun lint` 若因仓库过大 OOM，按既有流程记录环境限制。

## 风险与取舍

| 风险                                                    | 缓解                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| 透明窗口在部分 Windows/Linux 环境下有渲染或点击穿透问题 | 先关闭透明验证基本功能，再开启透明；保留回退配置项                |
| 拖拽出窗口外丢失指针事件                                | 优先用 `setPointerCapture`，并预留主进程全局鼠标跟踪回退          |
| 多显示器/DPI 变化导致保存位置跑到屏幕外                 | 启动时用 `screen.getDisplayNearestPoint` 对 bounds 做 clamp       |
| 两个窗口同时操作 local.agent 可能竞态                   | 所有 agent 切换统一在主窗口执行，挂件只发请求                     |
| 每次 todo 更新都推 IPC                                  | 状态仅含当前会话任务，数据量小；可用 `requestAnimationFrame` 节流 |
| 始终置顶可能遮挡用户其他工作                            | 后续可增加系统托盘菜单或快捷键临时隐藏挂件                        |

## 未包含在本期但可扩展的点

- 挂件内直接发送新消息 / 查看完整会话：需要更复杂的双向协议，建议后续单独设计。
- 系统托盘右键菜单控制挂件显示/隐藏。
- 挂件大小可自定义。
