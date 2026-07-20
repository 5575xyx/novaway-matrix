# 锻造模式 Plan/Build 智能体选择器 + 悬浮助手宠物 - 产品需求文档

## Why

当前锻造（forge）模式下，PromptInput 中的智能体下拉被隐藏，且提交时 `forgeAgentForPrompt` 会强制把每次用户消息都路由到 `build` 智能体，用户无法主动选择 `plan` 智能体先做规划。同时，右下角悬浮待办清单只承载任务查看，功能单一。用户希望把它升级为一只"悬浮助手宠物/机器人"，在一个入口里切换智能体、查看待办清单，并预留消息通知、任务运行情况等未来扩展空间。

## What Changes

- 在新建会话页（`NewSessionView`）的输入区上方，为锻造模式新增 Plan/Build 两个选择卡片。
- 选择结果通过 `local.agent.set` 保存，并在无 session id 时写入 draft，确保创建会话后仍然生效。
- 修改 `forgeAgentForPrompt`：当用户已显式选择 `plan` 且输入不含 build 意图时，保持使用 `plan`；检测到 build 意图或选择 `build` 时仍返回 `build`。
- 将右下角悬浮待办清单升级为"悬浮助手宠物"：
  - 入口改为宠物/机器人头像按钮，保留任务数量角标与进行中的脉冲动画。
  - 点击展开一个多功能面板，面板内采用标签页形式组织功能模块。
  - 第一期实现"智能体"和"待办"两个标签页：
    - **智能体**：显示当前 agent，并提供 Plan/Build 切换（锻造模式）或当前可用 agent 列表切换（其他模式）。
    - **待办**：复用现有 `session_todo` 任务列表、状态图标、滚动与自动展开逻辑。
  - 面板结构预留扩展标签页（如"通知"、"运行"），后续可通过增加配置项接入，不破坏现有实现。
- 新增/更新 i18n 文案与 `local-agent` 单元测试。

## Impact

- 关联已完成的 spec：`todo-list-enhancements`（在其基础上把单一待办面板扩展为多功能宠物面板）。
- 影响代码：
  - `packages/app/src/components/session/session-new-view.tsx`
  - `packages/app/src/components/floating-todo-button.tsx`（建议重命名为 `floating-assistant.tsx` 或保留文件并内部重构）
  - `packages/app/src/context/local-agent.ts`
  - `packages/app/src/components/prompt-input/submit.ts`
  - `packages/app/src/context/local.test.ts`
  - `packages/app/src/i18n/zh.ts`、`packages/app/src/i18n/en.ts` 等

## ADDED Requirements

### Requirement: 新建会话 Plan/Build 选择器

- **WHEN** 当前工作模式为 `forge` 且处于新建会话状态（无用户消息）时，
- **THEN** 在 `PromptInput` 上方水平展示 Plan、Build 两个选择卡片。
- 卡片尺寸足够醒目，包含智能体颜色圆点、名称（"规划蓝图"/"锻造工程"）以及一段详细说明，帮助用户理解两种工作方式的差异。
- **WHEN** 用户点击 Plan 卡片时，
- **THEN** 调用 `local.agent.set("plan")`，卡片变为激活状态，后续首次提交优先使用 `plan` 智能体。
- **WHEN** 用户点击 Build 卡片时，
- **THEN** 调用 `local.agent.set("build")`，卡片变为激活状态，后续提交使用 `build` 智能体。
- 非锻造模式不显示该选择器，保持现有 UI。

### Requirement: 悬浮助手宠物入口

- **WHEN** 用户进入会话页面时，
- **THEN** 右下角显示悬浮助手宠物按钮（机器人/宠物头像），取代原有待办清单按钮。
- 按钮显示当前待办任务总数角标；存在进行中的任务时显示脉冲动画。
- 按钮定位、z-index 与现有悬浮待办按钮一致，避免遮挡设置页、弹窗等上层元素。

### Requirement: 多功能面板与标签页

- **WHEN** 用户点击悬浮助手宠物按钮时，
- **THEN** 在其上方展开一个圆角面板，面板内展示标签页导航。
- 第一期包含"智能体"、"待办"两个标签页：
  - **智能体标签页**：显示当前 agent 名称与头像/颜色，列出当前模式下可切换的 agent（锻造模式为 plan/build），点击即可切换。
  - **待办标签页**：与现有悬浮待办清单一致，支持滚动、状态图标、完成计数、空状态提示。
- **WHEN** 任务数量从 0 变为 >0 时，
- **THEN** 助手宠物面板自动展开并切换到"待办"标签页；用户手动收起后不再因任务更新自动展开。
- 面板支持再次点击按钮或点击关闭区域收起，动画保持平滑。

### Requirement: 面板可扩展性

- 标签页列表通过组件内配置数组定义，包含 `id`、`label`、`icon`、`component`、`badge` 等字段。
- 新增标签页时只需在配置数组中追加一项并传入对应子组件，无需改动面板框架、动画或状态管理。
- 本期不实现"通知"、"运行"等标签页，但框架预留这些入口的扩展位置。

## MODIFIED Requirements

### Requirement: Forge 模式下 agent 提交路由逻辑

- `forgeAgentForPrompt` 的行为从"forge 模式一律返回 build"改为：
  - 若 `input.mode !== "forge"`，返回 `input.current`（不变）。
  - 若当前 agent 为 `plan` 且输入不含 build 意图（`hasForgeBuildIntent` 为 false），返回 `"plan"`。
  - 其他情况返回 `"build"`。
- 保持 `/commit` 等命令、包含 build 意图的自然语言、以及明确选择 build 时仍返回 build。

## REMOVED Requirements

无。
