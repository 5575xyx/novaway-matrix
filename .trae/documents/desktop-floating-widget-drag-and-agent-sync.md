# 桌面端悬浮助手挂件：拖动持久化与智能体实时同步

## 摘要

继续完成 Novaway 桌面端悬浮助手挂件的剩余工作。当前拖动、独立窗口、位置持久化、主窗口到悬浮窗的智能体同步等基础能力已实现，但存在以下关键缺陷影响最终体验：

1. 悬浮窗收起后未设置鼠标穿透，透明区域会遮挡桌面点击。
2. 桌面端同时存在 App 内 `FloatingTodoButton` 与独立悬浮窗，造成双重入口。
3. 从悬浮窗切换智能体时，IPC 通道不一致，主窗口无法同步。
4. 悬浮窗的“待办清单” tab 中任务列表被硬编码为空数组，无法查看真实任务。
5. 拖动按钮缺少 `touch-action: none`，在触控板/触摸屏上可能误触发页面滚动。

本计划将补齐以上缺陷，确保：

- 悬浮图标可拖动，且在 Novaway 主窗口最小化后仍然悬浮在桌面（始终置顶、任务栏不显示、鼠标穿透避免遮挡）。
- 对话过程中进入构建模式（build mode）时，悬浮面板中的“当前智能体”实时跟随切换；从悬浮面板切换智能体时，主窗口也同步更新。

## 现状分析

### 已实现的正确部分

- `packages/desktop/src/main/windows.ts`：独立 `BrowserWindow`，`frame: false`、`transparent: true`、`alwaysOnTop: true`、`skipTaskbar: true`、`resizable: false`，尺寸在收起（72×72）与展开（380×500）间动态调整，位置持久化到 `floatingWidget.bounds`。
- `packages/app/src/components/assistant-panel.tsx`：使用 Pointer Events 实现拖拽，拖动阈值 4px，通过 `setPointerCapture` 保证鼠标不丢失，松开后通过 `suppressClick` 避免触发展开。
- `packages/desktop/src/main/ipc.ts`：提供 `move-floating-widget`、`set-floating-expanded`、`update-floating-agent-state` 等 handler。
- `packages/desktop/src/renderer/index.tsx`：通过 `createEffect` 监听 `local.agent.current()` 与 `local.agent.list()`，主动调用 `updateFloatingAgentState` 推送完整智能体状态到悬浮窗。
- `packages/desktop/src/renderer/floating.tsx`：接收 `floating-agent-change` 事件并更新当前智能体与列表。

### 需要修复的缺陷

| 缺陷 | 影响 | 涉及文件 |
|---|---|---|
| 收起状态未设置鼠标穿透 | 72×72 透明窗口拦截桌面点击 | `packages/desktop/src/main/windows.ts` |
| 桌面端同时渲染 App 内浮动按钮 | 双重悬浮入口，体验混乱 | `packages/app/src/pages/session.tsx` |
| `set-floating-agent` 通道与 preload 监听不一致 | 从悬浮窗切 agent 后主窗口不同步 | `packages/desktop/src/main/ipc.ts` |
| 悬浮窗任务列表为空 | 待办清单 tab 无数据 | `packages/desktop/src/renderer/floating.tsx`、`packages/desktop/src/renderer/index.tsx`、类型定义 |
| 拖动按钮缺少 `touch-action: none` | 触控场景下可能滚动页面而非拖动 | `packages/app/src/components/assistant-panel.tsx` |

## 具体改动

### 1. 悬浮窗收起时启用鼠标穿透

**文件**：`packages/desktop/src/main/windows.ts`

**修改内容**：

- 在 `createFloatingWindow` 创建窗口后，默认调用 `win.setIgnoreMouseEvents(true, { forward: true })`，使收起状态的透明背景不拦截鼠标事件，同时让点击事件穿透到图标下方的桌面元素（对圆形按钮区域本身， Electron 仍会按窗口矩形处理，必要时可通过渲染进程再精细化控制，但当前 72×72 区域内只有中心按钮，周边透明区域需要穿透）。
- 在 `resizeFloatingWindow` 中，根据 `expanded` 参数切换：
  - 展开时：`win.setIgnoreMouseEvents(false)`，允许用户与面板交互。
  - 收起时：`win.setIgnoreMouseEvents(true, { forward: true })`，避免遮挡桌面。

**理由**：用户要求“就算把 Novaway 最小化，图标也能悬浮在电脑桌面”。如果透明窗口拦截点击，会妨碍用户操作桌面其他元素。

### 2. 桌面端隐藏 App 内浮动按钮

**文件**：`packages/app/src/pages/session.tsx`

**修改内容**：

- 在渲染 `<FloatingTodoButton />` 处，增加平台判断：仅在非 desktop 平台（web / 其他环境）渲染。
- 可通过已有的 platform context 或 `window.api` 是否存在来判断；优先使用 `usePlatform`（若存在）或检查 `window.api?.moveFloatingWidget` 等 desktop 专有 API。

**建议实现**：

```tsx
import { usePlatform } from "@/context/platform" // 若已存在

// 在 Session 组件中
const platform = usePlatform()

// ...
<Show when={platform.platform !== "desktop"}>
  <FloatingTodoButton />
</Show>
```

若 `usePlatform` 未直接暴露 `platform` 字段，则使用 `window.api` 探测：

```tsx
const isDesktop = typeof window !== "undefined" && !!window.api?.moveFloatingWidget

// ...
<Show when={!isDesktop}>
  <FloatingTodoButton />
</Show>
```

**理由**：桌面端由独立悬浮窗承载全部助手功能，App 内固定定位的 `FloatingTodoButton` 属于重复入口。

### 3. 修复悬浮窗到主窗口的智能体同步通道

**文件**：`packages/desktop/src/main/ipc.ts`

**修改内容**：

- 将 `set-floating-agent` handler 中向主窗口发送的通道从 `"set-floating-agent"` 改为 `"floating-agent-change"`，与 preload 中 `onFloatingAgentChange` 监听的通道一致。
- 同时保持向悬浮窗发送 `"floating-agent-change"`。

```ts
ipcMain.handle("set-floating-agent", (_event: IpcMainInvokeEvent, name: string) => {
  floatingAgentState = { ...floatingAgentState, current: name }
  const main = mainWindowRef
  if (main && !main.isDestroyed()) {
    main.webContents.send("floating-agent-change", floatingAgentState)
  }
  const floating = floatingWindowRef
  if (floating && !floating.isDestroyed()) {
    floating.webContents.send("floating-agent-change", floatingAgentState)
  }
})
```

**理由**：`packages/desktop/src/preload/index.ts` 的 `onFloatingAgentChange` 只监听 `"floating-agent-change"`。当前代码发送到 `"set-floating-agent"` 会导致主窗口收不到从悬浮窗发起的智能体切换。

### 4. 同步当前会话的待办清单到悬浮窗

#### 4.1 扩展类型定义

**文件**：`packages/desktop/src/preload/types.ts`

**修改内容**：

- 在 `FloatingAgentState` 中增加 `tasks?: Task[]`，与 `AssistantPanel` 的 `Task` 类型对齐。

```ts
export type FloatingAgentState = {
  current?: string
  agents: FloatingAgent[]
  tasks?: Task[]
}
```

- 需要从 `@opencode-ai/app` 导入 `Task` 类型，或在此文件中重新定义（优先复用已有类型）。

#### 4.2 在主窗口渲染进程读取并推送任务

**文件**：`packages/desktop/src/renderer/index.tsx`

**修改内容**：

- 从 `@opencode-ai/app` 导出并导入 `useGlobalSync`（若尚未导出，则在 `packages/app/src/index.ts` 中增加导出）。
- 在 `Inner` 组件中使用 `useGlobalSync` 与 `useSessionLayout`（来自 `@opencode-ai/app` 的 `useSessionLayout` 或自行基于 `useParams` 实现）获取当前会话 ID。
- 将当前会话的 `session_todo` 与智能体状态一起推送到悬浮窗。

```tsx
import { useGlobalSync, useSessionLayout } from "@opencode-ai/app"

function Inner() {
  // ...
  const globalSync = useGlobalSync()
  const { sessionKey } = useSessionLayout()

  const sessionID = () => sessionKey().split("/").at(-1) ?? ""

  const tasks = () => {
    const id = sessionID()
    if (!id) return []
    return (globalSync.data.session_todo[id] ?? []).map(asTask).filter((task): task is Task => !!task)
  }

  createEffect(() => {
    const agent = local.agent.current()
    const agents = local.agent.list()
    void window.api.updateFloatingAgentState({
      current: agent?.name,
      agents,
      tasks: tasks(),
    })
  })
  // ...
}
```

其中 `asTask` 复用 `packages/app/src/components/floating-todo-button.tsx` 中的类型守卫逻辑。

#### 4.3 在悬浮窗接收并渲染任务

**文件**：`packages/desktop/src/renderer/floating.tsx`

**修改内容**：

- 将硬编码的 `const [tasks] = createSignal<Task[]>([])` 改为响应式状态。
- `refreshState` 与 `onFloatingAgentChange` 回调中同步 `tasks`。

```tsx
const [tasks, setTasks] = createSignal<Task[]>([])

const refreshState = async () => {
  const state = await window.api.getFloatingAgentState()
  setCurrentAgent(state.current)
  setAgents(state.agents)
  setTasks(state.tasks ?? [])
}

onMount(() => {
  void refreshState()
  const cleanup = window.api.onFloatingAgentChange?.((state) => {
    setCurrentAgent(state.current)
    setAgents(state.agents)
    setTasks(state.tasks ?? [])
  })
  onCleanup(() => cleanup?.())
})
```

**理由**：用户明确要求“可以查看待办清单”，当前悬浮窗的 todo tab 为空，必须接入真实数据。

### 5. 优化拖动体验

**文件**：`packages/app/src/components/assistant-panel.tsx`

**修改内容**：

- 给拖拽按钮增加 `touch-action: none`，避免触控设备上触发页面滚动或系统手势。

```tsx
<button
  type="button"
  style={{ "touch-action": "none" }}
  // ...
>
```

**理由**：提升触摸屏/触控板上的拖动稳定性，确保拖动与点击区分逻辑正常工作。

## 假设与决策

1. **平台判断**：假设可通过 `window.api.moveFloatingWidget` 或 platform context 区分 desktop 与其他环境。若项目中已有更标准的判断方式，优先复用。
2. **任务同步粒度**：仅同步当前会话的待办任务，与 App 内 `FloatingTodoButton` 行为保持一致。全局任务聚合不在本次范围内。
3. **鼠标穿透范围**：当前 Electron `setIgnoreMouseEvents` 按窗口矩形生效，收起时整个 72×72 区域穿透。图标按钮的点击依赖窗口本身接收事件；由于按钮渲染在穿透窗口内，实际点击会穿透。若发现点击图标无响应，需要进一步在渲染进程通过 `ipcRenderer.send` 通知主进程临时禁用穿透，或缩小窗口到按钮实际大小。初步方案先采用全窗口穿透，验证后再细化。
4. **不向后兼容**：FloatingAgentState 增加可选字段 `tasks`，对现有调用无破坏性。
5. **不新增依赖**：所有改动基于现有 Electron API、SolidJS 与项目既有上下文。

## 验证步骤

1. **类型检查**：在 `packages/desktop` 与 `packages/app` 分别运行 `bun typecheck`，确保无 TypeScript 错误。
2. **Lint 检查**：在仓库根目录运行 `bun lint`，修复 oxlint 报错。
3. **功能验证（桌面端）**：
   - 启动桌面应用，确认右下角出现机器人图标。
   - 拖动图标到屏幕任意位置，松开后位置保持不变；重启应用后位置恢复。
   - 将 Novaway 主窗口最小化，图标仍显示在桌面，且可继续拖动。
   - 点击图标展开面板，可正常切换 agent tab / todo tab；在 todo tab 能看到当前会话的真实任务。
   - 在 forge 模式下新建会话选择 plan，发送包含“执行/修复/build/continue”等意图的消息，确认悬浮面板当前智能体从 plan 切换为 build。
   - 在悬浮面板中手动切换智能体，确认主窗口对话区域的当前智能体同步变化。
4. **功能验证（Web 端，若有）**：
   - 确认 `FloatingTodoButton` 仍在 Web 环境下正常显示和工作。
   - 确认 desktop 专有 API 不存在时不会报错。
5. **鼠标穿透验证**：
   - 在图标收起状态下，点击图标下方桌面其他元素（如图标、文件），确认能正常响应，而不是被透明窗口拦截。

## 相关文件清单

- `packages/desktop/src/main/windows.ts`
- `packages/desktop/src/main/ipc.ts`
- `packages/desktop/src/preload/types.ts`
- `packages/desktop/src/preload/index.ts`（如类型变更涉及，可能需要同步签名）
- `packages/desktop/src/renderer/floating.tsx`
- `packages/desktop/src/renderer/index.tsx`
- `packages/app/src/index.ts`（增加 `useGlobalSync`、`useSessionLayout` 导出）
- `packages/app/src/pages/session.tsx`
- `packages/app/src/components/assistant-panel.tsx`
