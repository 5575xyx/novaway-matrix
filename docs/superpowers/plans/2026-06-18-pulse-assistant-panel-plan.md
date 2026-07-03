# AI运营助手面板可折叠/可调整大小实现计划

> **对于代理工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 来逐任务执行此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将脉搏模式中的AI运营助手面板从固定宽度改为可折叠、可调整大小的面板

**架构：** 使用现有的 ResizeHandle 组件实现拖拽调整大小，使用 SolidJS 状态管理控制折叠/展开状态，使用 persisted 工具进行状态持久化

**技术栈：** SolidJS, ResizeHandle 组件, persisted 工具

---

## 文件结构

### 修改文件
- `packages/app/src/pages/pulse/PulseLayout.tsx` - 主要修改文件，添加可折叠/可调整大小的面板逻辑

### 依赖文件
- `packages/ui/src/components/resize-handle.tsx` - 现有的 ResizeHandle 组件
- `packages/app/src/utils/persist.ts` - 现有的状态持久化工具

---

## 任务1：导入依赖和添加状态管理

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseLayout.tsx:1-7`

- [ ] **步骤1：添加必要的导入**

在文件顶部添加以下导入语句：

```tsx
import { createSignal, onMount, Show } from "solid-js"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { persisted } from "@/utils/persist"
```

- [ ] **步骤2：运行类型检查验证导入**

运行：`cd packages/app && bun typecheck`
预期：无导入相关错误

- [ ] **步骤3：提交更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 添加AI运营助手面板的导入依赖"
```

---

## 任务2：添加状态管理

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseLayout.tsx:8-32`

- [ ] **步骤1：在 PulseLayoutInner 组件中添加状态管理**

在 `function PulseLayoutInner()` 内部，在 `const platform = usePlatformAccounts()` 之后添加：

```tsx
// AI运营助手面板状态
const [assistantWidth, setAssistantWidth] = createSignal(320)
const [assistantCollapsed, setAssistantCollapsed] = createSignal(false)

// 状态持久化
const [persistedState, setPersistedState] = persisted("pulse.assistant", {
  width: 320,
  collapsed: false,
})

// 从持久化状态恢复
onMount(() => {
  const state = persistedState()
  if (state) {
    setAssistantWidth(state.width)
    setAssistantCollapsed(state.collapsed)
  }
})
```

- [ ] **步骤2：运行类型检查验证状态管理**

运行：`cd packages/app && bun typecheck`
预期：无状态管理相关错误

- [ ] **步骤3：提交更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 添加AI运营助手面板的状态管理"
```

---

## 任务3：添加状态处理函数

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseLayout.tsx:32-50`

- [ ] **步骤1：添加状态处理函数**

在状态管理代码之后添加：

```tsx
// 折叠阈值：当宽度小于480px时自动折叠
const COLLAPSE_THRESHOLD = 480

const handleCollapse = () => {
  setAssistantCollapsed(true)
  setPersistedState({ width: assistantWidth(), collapsed: true })
}

const handleExpand = () => {
  setAssistantCollapsed(false)
  setPersistedState({ width: assistantWidth(), collapsed: false })
}

const handleResize = (width: number) => {
  setAssistantWidth(width)
  setPersistedState({ width, collapsed: assistantCollapsed() })
}

const handleResizeWithCollapse = (width: number) => {
  if (width < COLLAPSE_THRESHOLD) {
    handleCollapse()
  } else {
    handleResize(width)
  }
}
```

- [ ] **步骤2：运行类型检查验证处理函数**

运行：`cd packages/app && bun typecheck`
预期：无处理函数相关错误

- [ ] **步骤3：提交更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 添加AI运营助手面板的状态处理函数"
```

---

## 任务4：修改布局结构（展开状态）

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseLayout.tsx:50-70`

- [ ] **步骤1：修改展开状态的布局结构**

将原来的：

```tsx
<div class="w-80 shrink-0 border-l border-border-weak-base bg-background-weak/60">
  <PulseAssistant />
</div>
```

替换为：

```tsx
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
```

- [ ] **步骤2：运行类型检查验证布局结构**

运行：`cd packages/app && bun typecheck`
预期：无布局结构相关错误

- [ ] **步骤3：提交更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 添加AI运营助手面板的展开状态布局"
```

---

## 任务5：添加折叠状态布局

**文件：**
- 修改：`packages/app/src/pages/pulse/PulseLayout.tsx:70-90`

- [ ] **步骤1：在展开状态布局之后添加折叠状态布局**

在 `</Show>` 之后添加：

```tsx
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
```

- [ ] **步骤2：运行类型检查验证折叠状态布局**

运行：`cd packages/app && bun typecheck`
预期：无折叠状态布局相关错误

- [ ] **步骤3：提交更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 添加AI运营助手面板的折叠状态布局"
```

---

## 任务6：验证完整功能

**文件：**
- 测试：`packages/app/src/pages/pulse/PulseLayout.tsx`

- [ ] **步骤1：运行完整的类型检查**

运行：`cd packages/app && bun typecheck`
预期：无类型错误

- [ ] **步骤2：运行 lint 检查**

运行：`cd packages/app && bun lint`
预期：无 lint 错误

- [ ] **步骤3：手动测试功能**

1. 启动开发服务器：`cd packages/app && bun dev`
2. 访问脉搏模式
3. 测试以下功能：
   - 面板默认宽度为320px
   - 拖拽左边缘可以调整宽度（480px-600px）
   - 拖拽时显示宽度指示器
   - 拖拽宽度小于480px时自动折叠
   - 折叠后显示展开按钮
   - 点击展开按钮可以展开面板
   - 刷新页面后状态保持

- [ ] **步骤4：提交最终更改**

```bash
git add packages/app/src/pages/pulse/PulseLayout.tsx
git commit -m "feat: 完成AI运营助手面板的可折叠/可调整大小功能"
```

---

## 验收标准

### 功能验收
- [ ] 面板可折叠/展开
- [ ] 面板宽度可通过拖拽调整（480px-600px）
- [ ] 折叠状态显示展开按钮
- [ ] 拖拽时显示宽度指示器
- [ ] 状态持久化到 localStorage

### 交互验收
- [ ] 折叠/展开按钮响应点击
- [ ] 拖拽手柄响应鼠标操作
- [ ] 拖拽时显示宽度指示器
- [ ] 折叠/展开有平滑过渡动画

### 样式验收
- [ ] 折叠状态宽度为40px
- [ ] 展开状态最小宽度480px，最大宽度600px
- [ ] 按钮和手柄样式符合设计规范
- [ ] 响应式布局，适应不同屏幕尺寸

---

**计划完成时间：** 2026-06-18  
**下一步：** 执行计划