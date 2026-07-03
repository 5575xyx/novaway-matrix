# AI运营助手面板可折叠/可调整大小设计规范

**日期：** 2026-06-18  
**状态：** 已批准  
**作者：** AI助手

## 1. 概述

将脉搏模式（运营模式）中的AI运营助手面板从固定宽度改为可折叠、可调整大小的面板，提供更好的用户体验和屏幕空间利用率。

## 2. 需求

### 2.1 功能需求
- 面板可折叠/展开
- 面板宽度可通过拖拽调整
- 折叠状态显示一个小的展开按钮
- 展开状态显示可调整大小的面板

### 2.2 约束条件
- 最小宽度：480px（比当前320px宽50%）
- 最大宽度：600px（约为屏幕宽度的1/3）
- 折叠阈值：当拖拽宽度小于480px时自动折叠

### 2.3 交互需求
- 折叠/展开通过点击面板左边缘的按钮触发
- 拖拽时显示宽度指示器（显示当前宽度数值）
- 折叠状态显示一个小图标按钮，点击可展开

## 3. 设计方案

### 3.1 布局结构

**当前布局：**
```tsx
<div class="flex h-full w-full bg-background-base">
  <div class="w-64 shrink-0 border-r border-border-weak-base bg-background-weak/60">
    <PulseSidebar />
  </div>
  <div class="flex-1 min-w-0 overflow-auto">
    <PulseMain />
  </div>
  <div class="w-80 shrink-0 border-l border-border-weak-base bg-background-weak/60">
    <PulseAssistant />
  </div>
</div>
```

**新布局：**
```tsx
<div class="flex h-full w-full bg-background-weak/60">
  <div class="w-64 shrink-0 border-r border-border-weak-base bg-background-weak/60">
    <PulseSidebar />
  </div>
  <div class="flex-1 min-w-0 overflow-auto">
    <PulseMain />
  </div>
  <Show when={!assistantCollapsed()}>
    <div 
      class="shrink-0 border-l border-border-weak-base bg-background-weak/60 relative"
      style={{ width: `${assistantWidth()}px` }}
    >
      <PulseAssistant />
      <ResizeHandle
        direction="horizontal"
        edge="start"
        size={assistantWidth()}
        min={480}
        max={600}
        onResize={handleResizeWithCollapse}
        onCollapse={handleCollapse}
        class="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-border-interactive-base transition-colors"
      />
    </div>
  </Show>
  <Show when={assistantCollapsed()}>
    <div class="w-10 shrink-0 border-l border-border-weak-base bg-background-weak/60 flex flex-col items-center py-2">
      <button 
        class="size-8 rounded-lg flex items-center justify-center hover:bg-background-interactive-base transition-colors"
        onClick={handleExpand}
        title="展开AI运营助手"
      >
        <span class="text-text-weak">›</span>
      </button>
    </div>
  </Show>
</div>
```

### 3.2 状态管理

**需要管理的状态：**
1. `assistantWidth: number` - 面板宽度（默认320px）
2. `assistantCollapsed: boolean` - 折叠状态（默认false）

**状态定义：**
```tsx
const [assistantWidth, setAssistantWidth] = createSignal(320)
const [assistantCollapsed, setAssistantCollapsed] = createSignal(false)
```

**状态持久化：**
- 使用现有的 `persisted` 工具将状态保存到 localStorage
- 键名：`pulse.assistant` 
- 包含宽度和折叠状态

**状态处理函数：**
```tsx
const handleCollapse = () => {
  setAssistantCollapsed(true)
  persistState({ width: assistantWidth(), collapsed: true })
}

const handleExpand = () => {
  setAssistantCollapsed(false)
  persistState({ width: assistantWidth(), collapsed: false })
}

const handleResize = (width: number) => {
  setAssistantWidth(width)
  persistState({ width, collapsed: assistantCollapsed() })
}

// 折叠阈值：当宽度小于480px时自动折叠
const COLLAPSE_THRESHOLD = 480
const handleResizeWithCollapse = (width: number) => {
  if (width < COLLAPSE_THRESHOLD) {
    handleCollapse()
  } else {
    handleResize(width)
  }
}
```

### 3.3 视觉反馈

**折叠/展开按钮：**
- 位置：面板左边缘（展开状态）或右侧边缘（折叠状态）
- 样式：圆形按钮，直径32px
- 图标：展开状态显示 `‹`（向左箭头），折叠状态显示 `›`（向右箭头）
- 交互：hover时背景色变化，点击触发折叠/展开

**拖拽手柄：**
- 位置：面板左边缘
- 宽度：4px
- 颜色：默认透明，hover时显示边框色
- 光标：`col-resize`
- 拖拽时：显示宽度指示器

**宽度指示器：**
- 位置：拖拽手柄右侧
- 样式：半透明背景，圆角边框
- 内容：显示当前宽度数值（如 "480px"）
- 动画：淡入淡出效果

**折叠状态：**
- 宽度：40px
- 背景色：与面板相同
- 居中显示展开按钮

## 4. 实现细节

### 4.1 文件修改
1. `packages/app/src/pages/pulse/PulseLayout.tsx` - 主要修改文件
2. 可能需要创建新的样式文件（如果需要自定义样式）

### 4.2 实现步骤
1. 导入 `ResizeHandle` 组件和 SolidJS 状态管理函数
2. 添加状态管理（宽度和折叠状态）
3. 修改布局结构，添加条件渲染
4. 实现折叠/展开按钮
5. 实现宽度指示器
6. 添加状态持久化

### 4.3 代码结构
```tsx
// 1. 导入
import { createSignal, onMount, onCleanup, Show } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { persisted } from "@/utils/persist"

// 2. 状态定义
const [assistantWidth, setAssistantWidth] = createSignal(320)
const [assistantCollapsed, setAssistantCollapsed] = createSignal(false)
const [showIndicator, setShowIndicator] = createSignal(false)

// 3. 状态持久化
const persistState = persisted({ key: "pulse.assistant" })

// 4. 处理函数
const COLLAPSE_THRESHOLD = 480
const handleCollapse = () => { ... }
const handleExpand = () => { ... }
const handleResize = (width: number) => { ... }
const handleResizeWithCollapse = (width: number) => {
  if (width < COLLAPSE_THRESHOLD) {
    handleCollapse()
  } else {
    handleResize(width)
  }
}

// 5. 布局渲染
return (
  <div class="flex h-full w-full bg-background-weak/60">
    <PulseSidebar />
    <PulseMain />
    <Show when={!assistantCollapsed()}>
      <div style={{ width: `${assistantWidth()}px` }}>
        <PulseAssistant />
        <ResizeHandle ... />
      </div>
    </Show>
    <Show when={assistantCollapsed()}>
      <div class="w-10 ...">
        <button onClick={handleExpand}>›</button>
      </div>
    </Show>
  </div>
)
```

### 4.4 性能考虑
- 使用 `createMemo` 缓存计算值
- 避免不必要的重新渲染
- 使用 CSS 过渡动画提升用户体验

## 5. 验收标准

### 5.1 功能验收
- [ ] 面板可折叠/展开
- [ ] 面板宽度可通过拖拽调整（480px-600px）
- [ ] 折叠状态显示展开按钮
- [ ] 拖拽时显示宽度指示器
- [ ] 状态持久化到 localStorage

### 5.2 交互验收
- [ ] 折叠/展开按钮响应点击
- [ ] 拖拽手柄响应鼠标操作
- [ ] 拖拽时显示宽度指示器
- [ ] 折叠/展开有平滑过渡动画

### 5.3 样式验收
- [ ] 折叠状态宽度为40px
- [ ] 展开状态最小宽度480px，最大宽度600px
- [ ] 按钮和手柄样式符合设计规范
- [ ] 响应式布局，适应不同屏幕尺寸

## 6. 风险和依赖

### 6.1 风险
- 无重大风险，使用现有组件和成熟模式

### 6.2 依赖
- `@opencode-ai/ui/resize-handle` 组件
- `@/utils/persist` 持久化工具
- SolidJS 状态管理

## 7. 后续工作

### 7.1 实现计划
1. 修改 `PulseLayout.tsx` 文件
2. 添加状态管理
3. 实现折叠/展开功能
4. 实现拖拽调整大小功能
5. 添加状态持久化
6. 测试和验证

### 7.2 测试计划
1. 功能测试：折叠/展开、拖拽调整大小
2. 交互测试：按钮点击、拖拽操作
3. 样式测试：视觉反馈、响应式布局
4. 持久化测试：状态保存和恢复

---

**设计完成时间：** 2026-06-18  
**下一步：** 编写实现计划