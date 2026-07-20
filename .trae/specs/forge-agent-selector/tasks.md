# 锻造模式 Plan/Build 智能体选择器 + 悬浮助手宠物 - 实现计划

## [x] Task 1: 调整 forge 模式 agent 路由逻辑

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 修改 `packages/app/src/context/local-agent.ts` 中的 `forgeAgentForPrompt`：
    - 当 `input.mode === "forge"` 且 `input.current === "plan"` 且输入不含 build 意图时，返回 `"plan"`。
    - 其余 forge 场景返回 `"build"`。
  - 保留 `hasForgeBuildIntent`、`shouldAutoBuildAfterForgePlan` 的现有行为不变。
- **Acceptance Criteria Addressed**: 修改后的 agent 提交路由逻辑
- **Test Requirements**:
  - 更新 `packages/app/src/context/local.test.ts`：新增/修改断言，验证显式选择 plan 且无 build 意图时返回 plan；含 build 意图或选择 build 时返回 build。
- **Notes**: 这是后续选择器生效的前提。

## [x] Task 2: 新增 i18n 文案

- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 `packages/app/src/i18n/zh.ts` 与 `packages/app/src/i18n/en.ts` 中新增以下 key：
    - 新建会话选择器：`session.new.agentSelector.title`、`session.new.agentSelector.plan.title/description`、`session.new.agentSelector.build.title/description`
    - 悬浮助手宠物：`assistant.title`、`assistant.tab.agent`、`assistant.tab.todo`、`assistant.tab.notifications`、`assistant.tab.runs` 等
    - 智能体标签页：`assistant.agent.current`、`assistant.agent.switchTo`
    - 待办标签页复用现有 `taskList.*` key
  - 其他语言文件可先用英文占位，避免类型错误。
- **Acceptance Criteria Addressed**: 新建会话选择器、悬浮助手宠物文案
- **Test Requirements**:
  - `programmatic`: 新增 key 在 zh/en 字典中存在。
- **Notes**: 保持与现有 `agentLabels` 中"规划蓝图"/"锻造工程"的命名一致。

## [x] Task 3: 实现新建会话 Plan/Build 选择器 UI

- **Priority**: high
- **Depends On**: Task 1, Task 2
- **Description**:
  - 在 `packages/app/src/components/session/session-new-view.tsx` 中：
    - 通过 `useLayout` 获取当前 mode，仅当 `layout.mode.current() === "forge"` 时显示选择器。
    - 通过 `useLocal` 读取/设置当前 agent。
    - 在 `PromptInput` 上方插入两个水平排列的卡片（Plan / Build）。
    - 卡片展示智能体颜色、名称、描述；当前选中的卡片使用激活态样式。
    - 点击 Plan 调用 `local.agent.set("plan")`，点击 Build 调用 `local.agent.set("build")`。
  - 选择器样式需与 `mode-home.tsx` 卡片风格协调，但尺寸更小，不抢占输入区焦点。
- **Acceptance Criteria Addressed**: 新建会话 Plan/Build 选择器
- **Test Requirements**:
  - `human-judgment`: 锻造模式下新建会话页面显示 Plan/Build 卡片。
  - `programmatic`: 点击 Plan/Build 后 `local.agent.current()?.name` 对应变化。
- **Notes**: 注意 `NewSessionView` 在 `params.id` 存在但 `store.inputTransition` 为 true 时也会渲染，确保选择器仅在"无用户消息"的合适时机出现。

## [x] Task 4: 重构悬浮助手宠物入口与面板框架

- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - 改造 `packages/app/src/components/floating-todo-button.tsx`（或新建 `floating-assistant.tsx` 并替换引用）：
    - 入口按钮改为宠物/机器人头像，保留任务总数角标与进行中脉冲动画。
    - 点击后展开圆角面板；面板内部用标签页组织内容。
    - 面板动画复用现有 spring，展开/收起平滑过渡。
    - 面板 z-index 与现有悬浮按钮一致，不遮挡上层弹窗/设置页。
  - 在 `packages/app/src/pages/session.tsx` 中确认使用新的悬浮助手宠物组件。
- **Acceptance Criteria Addressed**: 悬浮助手宠物入口、多功能面板与标签页
- **Test Requirements**:
  - `human-judgment`: 会话页面右下角显示宠物按钮，点击展开面板。
  - `programmatic`: 面板展开/收起状态受控，角标显示任务数正确。
- **Notes**: 若保留原文件，建议后续把组件重命名为 `FloatingAssistant` 并在调用处同步更新。

## [x] Task 5: 实现"智能体"标签页

- **Priority**: high
- **Depends On**: Task 1, Task 2, Task 4
- **Description**:
  - 在悬浮助手宠物面板内新增"智能体"标签页：
    - 显示当前 agent 名称、颜色/图标。
    - 列出当前模式下可切换的 agent：锻造模式显示 plan/build；其他模式显示 `local.agent.list()` 过滤后的可用 agent。
    - 点击选项调用 `local.agent.set(...)` 切换，当前选中项高亮。
  - 该标签页作为独立子组件实现，便于后续扩展。
- **Acceptance Criteria Addressed**: 多功能面板与标签页、面板可扩展性
- **Test Requirements**:
  - `human-judgment`: 智能体标签页可见且能切换。
  - `programmatic`: 切换后 `local.agent.current()?.name` 立即更新。
- **Notes**: 锻造模式下 plan/build 切换是重点；其他模式保持通用 agent 列表。

## [x] Task 6: 实现"待办"标签页

- **Priority**: high
- **Depends On**: Task 4
- **Description**:
  - 将现有悬浮待办清单逻辑迁移为悬浮助手宠物面板内的"待办"标签页：
    - 复用 `useGlobalSync` 的 `session_todo` 数据源。
    - 复用任务状态图标、滚动、完成计数、空状态提示。
    - 保留"任务数从 0 变为 >0 时自动展开并切换到待办标签页"的行为。
    - 保留用户手动收起后不再自动展开的逻辑。
  - 保持与 `todo-list-enhancements` 已完成的验收条件一致。
- **Acceptance Criteria Addressed**: 多功能面板与标签页、面板可扩展性
- **Test Requirements**:
  - `human-judgment`: 待办标签页显示任务列表、状态图标、计数正确。
  - `programmatic`: 任务数从 0 增加时面板自动展开并切换到待办标签页。
- **Notes**: 尽量把任务列表渲染抽取为独立子组件，供宠物面板复用。

## [x] Task 7: 验证提交路径正确性

- **Priority**: medium
- **Depends On**: Task 1, Task 3
- **Description**:
  - 在 `packages/app/src/components/prompt-input/submit.ts` 中确认 `forgeAgentForPrompt` 调用传入了 `current: local.agent.current()?.name`。
  - 手动/自动化验证：选择 plan 后输入不含 build 意图的问题，提交后请求中的 agent 为 `plan`；输入含 build 意图（如"开始实现"）后 agent 变为 `build`。
- **Acceptance Criteria Addressed**: 修改后的 agent 提交路由逻辑
- **Test Requirements**:
  - `programmatic`: 通过 `local.test.ts` 覆盖主要分支。
- **Notes**: 若发现 `forgeAgentForPrompt` 调用处未传 current，需一并修复。

## [x] Task 8: 本地验证

- **Priority**: high
- **Depends On**: Task 3, Task 5, Task 6, Task 7
- **Description**:
  - 运行 `bun lint` 与 `bun typecheck`（在受影响包目录下按项目规范执行）。
  - 运行 `packages/app` 与 `packages/ui` 相关测试，确保 `local.test.ts` 通过。
  - 在本地启动 Web/TUI 预览，检查锻造模式下新建会话页与悬浮助手宠物的交互。
- **Acceptance Criteria Addressed**: 全部
- **Test Requirements**:
  - `programmatic`: lint/typecheck/test 全部通过。
- **Notes**: 本项目测试不能从根目录运行，需进入对应包目录执行。

## [x] Task 9: 清理改动文件 lint 警告并记录根目录 lint 环境限制

- **Priority**: medium
- **Depends On**: Task 8
- **Description**:
  - 已对 `packages/app/src/components/session/session-new-view.tsx` 中未使用的导入/变量进行清理。
  - 重新对本次改动文件运行 `bunx oxlint`：0 错误，仅余 `packages/app/src/components/prompt-input/submit.ts` 中一条已有的 `no-unsafe-type-assertion` 警告（与本次改动无关）。
  - 根目录 `bun lint` 因仓库文件量过大在本地环境触发 OOM（`VirtualAlloc failed / out of memory`），即使 `--threads=1` 仍无法完成，属于环境/资源限制。
- **Acceptance Criteria Addressed**: lint 相关检查
- **Test Requirements**:
  - `programmatic`: 本次改动文件 oxlint 0 errors；根目录 `bun lint` 因环境 OOM 无法验证。
- **Notes**: 当前 `submit.test.ts` 因 `packages/core/src/util/encode.ts` 缺少 `base64Decode` 导出而无法加载，属于测试环境/依赖问题，与本次功能改动无关。
