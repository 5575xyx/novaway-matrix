# 待办清单监控与多上下文支持 - 产品需求文档

## Why

当前悬浮宠物弹窗中的待办清单仅按当前会话展示任务列表，无法反映用户同时推进多个项目/会话时的全局任务状态，也缺少任务耗时、完成进度等实时运行信息。宠物的心声在任务运行时仍是预设文案，浪费了用户一眼获取关键进展的入口。

## What Changes

- 宠物进入"运行中"状态的条件扩展：只要存在未完成的待办即视为运行中。
- 有待办未完成时，弹窗自动展开提示；用户可点击面板外部或切换按钮手动关闭。
- 弹窗内按项目/会话维度组织待办，支持查看多个上下文下的任务。
- 宠物心声在运行中时被替换为实时监控摘要：项目名、todo 总数、完成数、剩余数、完成度、各 todo 耗时等。
- 记录每个 todo 的开始时间、完成时间和耗时。

## Impact

- Affected capabilities: 悬浮助手面板、宠物状态、待办清单展示、任务耗时统计
- Affected code:
  - `packages/app/src/components/assistant-panel.tsx`
  - `packages/app/src/components/floating-todo-button.tsx`
  - `packages/desktop/src/renderer/floating.tsx`
  - `packages/desktop/src/main/ipc.ts` / `windows.ts`（状态同步与弹窗显隐）
  - `packages/app/src/context/global-sync.ts` 或相关 todo 数据结构
  - `packages/app/src/i18n/*`

## ADDED Requirements

### Requirement: 运行中状态与自动弹窗

The system SHALL 把"存在未完成 todo"作为宠物运行中状态的判定条件。

#### Scenario: 有新 todo 时自动展开

- **GIVEN** 宠物弹窗当前处于收起状态
- **WHEN** 系统产生新的未完成 todo
- **THEN** 弹窗自动展开，宠物进入运行中状态
- **AND** 用户可点击面板外部或再次点击宠物图标收起弹窗

#### Scenario: 全部完成后恢复常态

- **GIVEN** 当前有未完成的 todo
- **WHEN** 所有 todo 均变为 completed/cancelled
- **THEN** 宠物退出运行中状态，弹窗不再自动展开

### Requirement: 实时监控摘要

The system SHALL 在宠物运行中时用实时监控摘要替换预设心声。

#### Scenario: 单项目运行中

- **GIVEN** 当前只有一个项目/会话存在未完成 todo
- **WHEN** 宠物显示心声气泡
- **THEN** 气泡中展示：项目名、todo 总数、已完成数、剩余数、完成百分比

#### Scenario: 多项目运行中

- **GIVEN** 多个项目/会话同时存在未完成 todo
- **WHEN** 宠物显示心声气泡
- **THEN** 气泡中按项目聚合展示，或展示汇总：总 todo 数、已完成数、剩余数、整体完成度

#### Scenario: todo 耗时展示

- **GIVEN** 某个 todo 已被标记为完成或正在执行
- **WHEN** 用户在弹窗中查看该 todo
- **THEN** 显示该 todo 的开始时间、完成时间（如已完成）和持续时长

### Requirement: 按项目/会话分组展示待办

The system SHALL 在弹窗中按项目和会话对 todo 进行分组展示。

#### Scenario: 存在多个会话任务

- **GIVEN** 用户同时打开了多个目录或会话
- **WHEN** 展开宠物弹窗
- **THEN** todo 按目录/会话分组显示，每组显示项目名称/会话标识
- **AND** 每组独立展示完成进度

#### Scenario: 当前会话优先

- **GIVEN** 弹窗已展开
- **THEN** 当前所在项目/会话的分组置顶显示
- **AND** 其他分组按最近更新时间排序

### Requirement: 任务计时

The system SHALL 为每个 todo 记录执行耗时。

#### Scenario: 任务开始计时

- **GIVEN** 一个 todo 状态变为 in_progress
- **THEN** 系统记录开始时间

#### Scenario: 任务完成计时

- **GIVEN** 一个 in_progress 的 todo 状态变为 completed
- **THEN** 系统记录完成时间并计算持续时长

#### Scenario: 任务取消计时

- **GIVEN** 一个 in_progress 的 todo 状态变为 cancelled
- **THEN** 系统停止计时，已耗时时长可展示为"已取消"，不强制要求完成时间

## MODIFIED Requirements

### Requirement: 宠物心声内容

**原行为**：宠物在空闲/悬停/点击时显示随机预设心声。
**新行为**：当存在未完成 todo 时，心声内容优先显示运行监控摘要；用户仍可在无任务时看到预设心声。

## REMOVED Requirements

无。
