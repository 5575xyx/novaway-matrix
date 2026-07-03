# 待办清单增强功能 - 实现计划

## [x] Task 1: 修复待办清单滚动问题
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `packages/app/src/components/task-list.tsx` 中的 `overflow-y-hidden` 为 `overflow-y-auto`
  - 确保待办清单列表容器有合适的高度限制，当内容超出时可以滚动
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-1.1: 待办清单容器的 overflow-y 属性为 auto
  - `programmatic` TR-1.2: 当任务数量超过容器高度时，滚动条自动出现
- **Notes**: 需要确保父容器也有正确的 flex 和 overflow 设置

## [x] Task 2: 优化任务状态图标
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 修改 `packages/app/src/components/task-list.tsx` 中的 `statusIcon` 函数
  - pending 状态使用空心圆圈图标（circle）
  - in_progress 状态使用圆圈内实心圆圈图标（需要添加新图标或使用现有图标组合）
  - completed 状态使用打勾图标（circle-check）
  - cancelled 状态保持空心圆圈或使用 circle-x
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-4
- **Test Requirements**:
  - `human-judgment` TR-2.1: pending 任务显示空心圆圈图标
  - `human-judgment` TR-2.2: in_progress 任务显示圆圈内实心圆圈图标
  - `human-judgment` TR-2.3: completed 任务显示打勾图标
- **Notes**: 需要检查现有图标库是否有合适的图标，可能需要添加新图标

## [x] Task 3: 创建悬浮待办清单按钮组件
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 创建新组件 `packages/app/src/components/floating-todo-button.tsx`
  - 按钮位于右下角，显示任务数量
  - 点击按钮展开/收起待办清单面板
  - 添加平滑的展开/收起动画
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `programmatic` TR-3.1: 悬浮按钮在页面右下角正确定位
  - `programmatic` TR-3.2: 点击按钮时待办清单面板正确展开/收起
  - `human-judgment` TR-3.3: 按钮显示当前任务数量
- **Notes**: 需要考虑按钮的样式、位置和 z-index 层级

## [x] Task 4: 添加新的状态图标到图标库
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 在 `packages/ui/src/components/icon.tsx` 中添加 "circle-hollow"（空心圆圈）和 "circle-dot"（圆圈内实心圆圈）图标
  - 确保新图标与现有图标风格一致
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-4.1: 新图标在 icons 对象中正确定义
  - `human-judgment` TR-4.2: 新图标渲染正确，视觉风格与现有图标一致
- **Notes**: 需要检查现有的 SVG 图标格式，保持一致的 viewBox 和 stroke 属性

## [x] Task 5: 实现新任务时自动展开功能
- **Priority**: medium
- **Depends On**: Task 3
- **Description**: 
  - 在悬浮待办清单组件中监听任务数量变化
  - 当任务数量从 0 变为 >0 时，自动展开待办清单面板
  - 使用 `createEffect` 监听 `globalSync.data.session_todo` 的变化
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `programmatic` TR-5.1: 当任务数量从 0 变为 >0 时，待办清单自动展开
  - `programmatic` TR-5.2: 用户手动收起后，不会因为任务更新而自动展开
- **Notes**: 需要区分是新任务添加还是现有任务状态更新

## [x] Task 6: 移除文件树底部的待办清单
- **Priority**: medium
- **Depends On**: Task 3
- **Description**: 
  - 修改 `packages/app/src/pages/session/session-side-panel.tsx`
  - 移除文件树底部的 `TaskList` 组件和相关的 ResizeHandle
  - 确保移除后文件树布局不受影响
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `human-judgment` TR-6.1: 文件树底部不再显示待办清单区域
  - `human-judgment` TR-6.2: 文件树布局正常，没有空白或重叠问题
- **Notes**: 需要确保移除后不会影响其他功能

## [x] Task 7: 在会话页面集成悬浮待办清单
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 在会话页面（`packages/app/src/pages/session/session-page.tsx` 或类似文件）中添加悬浮待办清单按钮组件
  - 确保组件在所有会话页面都可见
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `human-judgment` TR-7.1: 悬浮待办清单按钮在会话页面右下角可见
  - `human-judgment` TR-7.2: 点击按钮后待办清单面板正确显示
- **Notes**: 需要找到正确的会话页面入口文件