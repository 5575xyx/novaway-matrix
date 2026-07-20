# 待办清单监控与多上下文支持 - 实现计划

## [ ] Task 1: 扩展 Task 类型与数据结构以支持计时

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 `packages/app/src/components/assistant-panel.tsx`（或共享类型文件）中为 `Task` 补充 `startedAt?: number`、`completedAt?: number`、`durationMs?: number` 字段
  - 在 `floating-agent-sync.tsx` 或 global sync 转换逻辑中为 todo 生成/补全时间戳
  - 当状态从 pending 变为 in_progress 时记录 `startedAt`
  - 当状态从 in_progress 变为 completed 时记录 `completedAt` 并计算 `durationMs`
  - cancelled 的任务停止计时，不强制填充 `completedAt`
- **Acceptance Criteria Addressed**: 任务计时
- **Test Requirements**:
  - `programmatic` TR-1.1: in_progress 的 todo 具有有效的 `startedAt`
  - `programmatic` TR-1.2: completed 的 todo 具有 `completedAt` 且 `durationMs` 非负
  - `programmatic` TR-1.3: cancelled 的 todo 不生成 `completedAt`

## [ ] Task 2: 聚合多项目/多会话的 todo 数据

- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - 在 `packages/app/src/components/floating-agent-sync.tsx` 或相关同步组件中，收集当前全局所有 `session_todo` 分组数据
  - 将 `FloatingAgentState.tasks` 从 `Task[]` 改为按目录/会话分组的数据结构，例如 `Record<string, { label: string; tasks: Task[] }>`
  - 通过 IPC 把分组后的数据推送到桌面端悬浮窗
  - 桌面端 `floating.tsx` 接收并保存该分组结构
- **Acceptance Criteria Addressed**: 按项目/会话分组展示
- **Test Requirements**:
  - `programmatic` TR-2.1: 悬浮窗能接收到至少包含当前会话的分组数据
  - `programmatic` TR-2.2: 多个会话的 todo 被正确分组
  - `human-judgment` TR-2.3: 弹窗中各分组标题可区分

## [ ] Task 3: 在弹窗中按分组展示待办与进度

- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 在 `packages/app/src/components/assistant-panel.tsx` 中重写 `TodoTab`
  - 按目录/会话分组渲染任务，当前会话置顶
  - 每组头部显示项目名、总任务数、已完成数、完成百分比
  - 列表项中展示任务内容、状态、以及耗时（如"2分30秒"或"已用时 1分15秒"）
- **Acceptance Criteria Addressed**: 按项目/会话分组展示、todo 耗时展示
- **Test Requirements**:
  - `human-judgment` TR-3.1: 分组头部显示项目名和进度
  - `human-judgment` TR-3.2: 进行中任务显示已用时长
  - `human-judgment` TR-3.3: 已完成任务显示完成时长
  - `programmatic` TR-3.4: 当前会话分组始终排在最前

## [ ] Task 4: 宠物运行中状态与自动弹窗

- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 在 `AssistantPanel` / `floating.tsx` 中把"存在未完成 todo"判定为运行中
  - 当未完成任务数从 0 变为 >0 时，自动调用 `onExpandToggle` 或桌面端 IPC 展开弹窗
  - 用户手动收起后，设置标志位避免后续状态更新再次自动展开
  - 全部完成后恢复常态，不再自动展开
- **Acceptance Criteria Addressed**: 运行中状态与自动弹窗
- **Test Requirements**:
  - `programmatic` TR-4.1: 新 todo 产生时弹窗自动展开
  - `programmatic` TR-4.2: 用户手动收起后，状态更新不再触发自动展开
  - `programmatic` TR-4.3: 全部完成后宠物退出运行中状态

## [ ] Task 5: 用实时监控摘要替换运行中的宠物心声

- **Priority**: high
- **Depends On**: Task 2, Task 4
- **Description**:
  - 在 `AssistantPanel` 的 `MascotIcon` 或 `MASCOT_THOUGHTS` 逻辑中，当处于运行中时让 `thought()` 返回监控摘要
  - 摘要格式：单项目时显示"项目A: 3/5 完成 (60%)"；多项目时显示"2个项目进行中，共 5/9 完成"
  - 优先使用当前会话的数据；如无当前会话数据则展示全局汇总
- **Acceptance Criteria Addressed**: 实时监控摘要
- **Test Requirements**:
  - `human-judgment` TR-5.1: 运行中宠物心声显示进度摘要
  - `human-judgment` TR-5.2: 多项目时摘要不超出气泡宽度
  - `programmatic` TR-5.3: 无任务时恢复显示预设心声

## [ ] Task 6: 点击外部关闭弹窗

- **Priority**: medium
- **Depends On**: Task 4
- **Description**:
  - 在 `AssistantPanel` 中为展开的面板添加点击外部关闭逻辑
  - 点击宠物图标、切换智能体按钮、面板内部元素时不关闭
  - 关闭时更新桌面端 `panelVisible` 状态并同步保存"用户已手动关闭"标志
- **Acceptance Criteria Addressed**: 运行中状态与自动弹窗
- **Test Requirements**:
  - `programmatic` TR-6.1: 点击面板外部区域弹窗收起
  - `programmatic` TR-6.2: 点击面板内部不关闭

## [ ] Task 7: 国际化文案

- **Priority**: medium
- **Depends On**: Task 3, Task 5
- **Description**:
  - 在 `packages/app/src/i18n/zh.ts` 和 `en.ts` 中添加新键：
    - `assistant.todo.groupTitle` / `assistant.todo.progress` / `assistant.todo.elapsed` / `assistant.todo.completedIn` 等
  - 为其他语言文件补充英文占位
- **Acceptance Criteria Addressed**: 所有新 UI 文案可翻译
- **Test Requirements**:
  - `programmatic` TR-7.1: `zh.ts` 和 `en.ts` 包含所有新增键
  - `programmatic` TR-7.2: 切换语言后新文案正常显示

## [ ] Task 8: 类型检查与回归验证

- **Priority**: high
- **Depends On**: Task 1-7
- **Description**:
  - 运行 `bun typecheck` 于 `packages/app` 和 `packages/desktop`
  - 验证现有悬浮宠物、智能体切换、拖拽、展开/收起功能未回退
  - 验证无待办时面板不自动展开、宠物显示预设心声
- **Acceptance Criteria Addressed**: 全量功能正确
- **Test Requirements**:
  - `programmatic` TR-8.1: `app` 包 typecheck 通过
  - `programmatic` TR-8.2: `desktop` 包 typecheck 通过
  - `human-judgment` TR-8.3: 桌面端手动回归通过

# Task Dependencies

- Task 3 depends on Task 2
- Task 4 depends on Task 2
- Task 5 depends on Task 2 and Task 4
- Task 6 depends on Task 4
- Task 7 depends on Task 3 and Task 5
- Task 8 depends on Task 1-7
