# 待办清单增强功能 - 产品需求文档

## Overview

- **Summary**: 对右侧底部待办清单进行三项改进：添加滚动功能、优化状态图标、将待办清单从文件树中独立为悬浮面板
- **Purpose**: 提升待办清单的可用性和用户体验，让用户能够方便地查看和管理所有任务
- **Target Users**: 所有使用 OpenCode 的开发者和团队成员

## Goals

- 待办清单支持垂直滚动，能够查看所有任务
- 优化任务状态图标：未开始用空心圆圈，进行中用圆圈内加实心圆圈，已完成用打勾图标
- 将待办清单从文件树底部独立出来，创建右下角悬浮按钮，点击展开/收起，有任务时自动展开

## Non-Goals (Out of Scope)

- 不修改会话底部的 `SessionTodoDock` 组件（那是另一个待办清单位置）
- 不改变任务数据结构和后端逻辑
- 不添加任务编辑/删除功能
- 不添加拖拽排序功能

## Background & Context

当前待办清单嵌入在文件树面板底部，存在以下问题：

1. `overflow-y-hidden` 导致无法滚动，任务多时无法查看全部
2. 状态图标使用了不合适的图标（pending 使用了 circle-x）
3. 位置固定在文件树底部，占用文件树空间，且文件树关闭时待办清单也不可见

## Functional Requirements

- **FR-1**: 待办清单列表支持垂直滚动，当任务数量超过可视区域时显示滚动条
- **FR-2**: 任务状态图标优化：
  - pending（未开始）：空心圆圈图标
  - in_progress（进行中）：圆圈内包含实心小圆圈图标
  - completed（已完成）：打勾图标
  - cancelled（已取消）：空心圆圈图标或斜线圆圈
- **FR-3**: 创建右下角悬浮待办清单按钮，点击展开/收起待办清单面板
- **FR-4**: 当运行中有列出待办清单时，自动展开悬浮待办清单面板
- **FR-5**: 移除文件树底部的待办清单嵌入

## Non-Functional Requirements

- **NFR-1**: 滚动流畅，无卡顿感
- **NFR-2**: 图标显示清晰，符合用户认知习惯
- **NFR-3**: 悬浮按钮和面板动画过渡平滑
- **NFR-4**: 响应式设计，适配不同屏幕尺寸

## Constraints

- **Technical**: SolidJS 框架，使用现有的 UI 组件库 `@opencode-ai/ui`
- **Dependencies**: 依赖全局同步状态 `useGlobalSync` 获取任务数据

## Assumptions

- 用户希望保持待办清单的核心功能（查看任务状态）不变
- 悬浮面板的位置和尺寸需要与现有 UI 风格保持一致

## Acceptance Criteria

### AC-1: 待办清单支持滚动

- **Given**: 待办清单中有超过可视区域的任务
- **When**: 用户尝试上下滚动待办清单
- **Then**: 待办清单内容能够顺畅滚动，所有任务都能被查看
- **Verification**: `programmatic`

### AC-2: 未开始任务显示空心圆圈图标

- **Given**: 有待办任务状态为 pending
- **When**: 待办清单渲染该任务
- **Then**: 任务前面显示空心圆圈图标
- **Verification**: `human-judgment`

### AC-3: 进行中任务显示圆圈内实心圆圈图标

- **Given**: 有待办任务状态为 in_progress
- **When**: 待办清单渲染该任务
- **Then**: 任务前面显示圆圈内包含实心小圆圈的图标
- **Verification**: `human-judgment`

### AC-4: 已完成任务显示打勾图标

- **Given**: 有待办任务状态为 completed
- **When**: 待办清单渲染该任务
- **Then**: 任务前面显示打勾图标
- **Verification**: `human-judgment`

### AC-5: 右下角显示悬浮待办清单按钮

- **Given**: 用户进入会话页面
- **When**: 页面加载完成
- **Then**: 右下角显示待办清单悬浮按钮，显示任务数量
- **Verification**: `human-judgment`

### AC-6: 点击悬浮按钮展开/收起待办清单

- **Given**: 悬浮待办清单按钮可见
- **When**: 用户点击悬浮按钮
- **Then**: 待办清单面板从按钮位置展开或收起
- **Verification**: `programmatic`

### AC-7: 有新任务时自动展开待办清单

- **Given**: 待办清单当前处于收起状态
- **When**: 系统列出新的待办任务
- **Then**: 待办清单自动展开显示新任务
- **Verification**: `programmatic`

### AC-8: 文件树底部不再显示待办清单

- **Given**: 用户打开文件树面板
- **When**: 文件树渲染完成
- **Then**: 文件树底部不再显示待办清单区域
- **Verification**: `human-judgment`

## Open Questions

- [ ] 悬浮按钮的样式和动画效果是否需要与现有 UI 规范保持一致？
- [ ] 悬浮面板的最大宽度和高度是否需要限制？
- [ ] 当没有任务时，悬浮按钮是否需要隐藏？
