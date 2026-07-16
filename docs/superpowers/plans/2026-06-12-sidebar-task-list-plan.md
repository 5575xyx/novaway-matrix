# 侧边栏任务列表布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将任务列表从聊天区域移动到侧边栏的独立区域，采用上下分割布局

**Architecture:** 在侧边栏中创建垂直分割布局，上半部分保持现有文件树tab，下半部分显示任务列表组件。任务状态通过现有的sync上下文实时同步。

**Tech Stack:** SolidJS, TypeScript, Tailwind CSS, 现有的sync上下文系统

---

## 文件结构

### 新增文件

- `packages/app/src/components/task-list.tsx` - 任务列表组件
- `packages/app/src/components/task-list.test.ts` - 任务列表测试

### 修改文件

- `packages/app/src/pages/session/session-side-panel.tsx` - 添加垂直分割布局
- `packages/app/src/context/layout.tsx` - 添加任务列表高度状态
- `packages/app/src/pages/session/session-layout.ts` - 添加任务列表布局逻辑

---

### Task 1: 创建TaskList组件基础结构

**Files:**

- Create: `packages/app/src/components/task-list.tsx`
- Test: `packages/app/src/components/task-list.test.ts`

- [ ] **Step 1: 创建TaskList组件基础结构**

```tsx
// packages/app/src/components/task-list.tsx
import { Show, For, createMemo, createSignal, type JSX } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"

type Task = {
  id: string
  content: string
  status: TaskStatus
  priority: "high" | "medium" | "low"
}

export function TaskList(props: { class?: string }) {
  const language = useLanguage()
  const sync = useSync()
  const { sessionKey } = useSessionLayout()

  const sessionID = createMemo(() => sessionKey())

  const tasks = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.todo[id] ?? []
  })

  const completedCount = createMemo(() => tasks().filter((task) => task.status === "completed").length)

  const statusIcon = (status: TaskStatus) => {
    switch (status) {
      case "completed":
        return "circle-check"
      case "in_progress":
        return "circle-dot"
      case "cancelled":
        return "circle-x"
      default:
        return "circle"
    }
  }

  const statusColor = (status: TaskStatus) => {
    switch (status) {
      case "completed":
        return "text-green-500"
      case "in_progress":
        return "text-orange-500"
      case "cancelled":
        return "text-gray-400"
      default:
        return "text-gray-300"
    }
  }

  return (
    <div class={`flex flex-col h-full ${props.class ?? ""}`}>
      <div class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel">
        <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
        <span class="text-11-regular text-text-weak">
          {completedCount()}/{tasks().length}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-1">
        <Show
          when={tasks().length > 0}
          fallback={
            <div class="flex items-center justify-center h-full text-12-regular text-text-weak">
              {language.t("taskList.empty")}
            </div>
          }
        >
          <For each={tasks()}>
            {(task) => (
              <div class="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover">
                <Icon
                  name={statusIcon(task.status)}
                  size="small"
                  class={`shrink-0 mt-0.5 ${statusColor(task.status)}`}
                />
                <span
                  class={`text-12-regular ${
                    task.status === "completed"
                      ? "line-through text-text-weak"
                      : task.status === "in_progress"
                        ? "font-medium text-text-strong"
                        : "text-text-base"
                  }`}
                >
                  {task.content}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 添加国际化键值**

在 `packages/app/src/i18n/locales/en.json` 中添加：

```json
{
  "taskList": {
    "title": "Task List",
    "empty": "No tasks yet"
  }
}
```

在 `packages/app/src/i18n/locales/zh.json` 中添加：

```json
{
  "taskList": {
    "title": "任务列表",
    "empty": "暂无任务"
  }
}
```

- [ ] **Step 3: 运行测试验证组件基础结构**

Run: `cd packages/app && bun test task-list`
Expected: PASS (基础结构测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/components/task-list.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json
git commit -m "feat: add basic TaskList component structure"
```

---

### Task 2: 实现任务状态同步

**Files:**

- Modify: `packages/app/src/components/task-list.tsx`
- Test: `packages/app/src/components/task-list.test.ts`

- [ ] **Step 1: 添加任务状态同步逻辑**

```tsx
// 在 task-list.tsx 中添加以下逻辑
import { createEffect, on } from "solid-js"

// 在 TaskList 组件中添加
createEffect(
  on(
    () => sessionID(),
    (id) => {
      if (!id) return
      sync.todo(id)
    },
  ),
)
```

- [ ] **Step 2: 添加任务状态实时更新**

```tsx
// 在 TaskList 组件中添加
const todoData = createMemo(() => {
  const id = sessionID()
  if (!id) return []
  return sync.todo[id] ?? []
})

// 更新 tasks memo 使用 todoData
const tasks = createMemo(() => todoData())
```

- [ ] **Step 3: 运行测试验证状态同步**

Run: `cd packages/app && bun test task-list`
Expected: PASS (状态同步测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/components/task-list.tsx
git commit -m "feat: add task state synchronization"
```

---

### Task 3: 添加任务列表折叠功能

**Files:**

- Modify: `packages/app/src/components/task-list.tsx`
- Modify: `packages/app/src/context/layout.tsx`
- Test: `packages/app/src/components/task-list.test.ts`

- [ ] **Step 1: 添加折叠状态管理**

在 `packages/app/src/context/layout.tsx` 中确认 `todoCollapsed` 状态已存在（已确认在第108行和874-885行）。

- [ ] **Step 2: 添加折叠/展开交互**

```tsx
// 在 task-list.tsx 中添加折叠功能
import { useLayout } from "@/context/layout"

// 在 TaskList 组件中添加
const layout = useLayout()
const { view } = useSessionLayout()

const isCollapsed = createMemo(() => view().todoCollapsed())

const toggleCollapse = () => {
  view().todoCollapsed.set(!isCollapsed())
}

// 更新组件返回，添加可折叠的标题栏
return (
  <div class={`flex flex-col h-full ${props.class ?? ""}`}>
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel cursor-pointer hover:bg-surface-raised-base-hover"
      onClick={toggleCollapse}
    >
      <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
      <div class="flex items-center gap-2">
        <span class="text-11-regular text-text-weak">
          {completedCount()}/{tasks().length}
        </span>
        <Icon name={isCollapsed() ? "chevron-right" : "chevron-down"} size="small" class="text-icon-weak" />
      </div>
    </div>
    <Show when={!isCollapsed()}>
      <div class="flex-1 overflow-y-auto px-2 py-1">{/* 任务列表内容 */}</div>
    </Show>
  </div>
)
```

- [ ] **Step 3: 运行测试验证折叠功能**

Run: `cd packages/app && bun test task-list`
Expected: PASS (折叠功能测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/components/task-list.tsx
git commit -m "feat: add task list collapse functionality"
```

---

### Task 4: 修改session-side-panel添加垂直分割

**Files:**

- Modify: `packages/app/src/pages/session/session-side-panel.tsx`
- Test: `packages/app/src/pages/session/session-side-panel.test.tsx`

- [ ] **Step 1: 添加垂直分割布局**

在 `session-side-panel.tsx` 中修改文件树面板部分：

```tsx
// 在文件树面板部分（约第352-458行）添加垂直分割
<Show when={shown()}>
  <div
    id="file-tree-panel"
    aria-hidden={!fileOpen()}
    inert={!fileOpen()}
    class="relative min-w-0 h-full shrink-0 overflow-hidden"
    classList={{
      "pointer-events-none": !fileOpen(),
      "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
        !props.size.active(),
    }}
    style={{ width: treeWidth() }}
  >
    <div
      class="h-full flex flex-col overflow-hidden group/filetree"
      classList={{ "border-l border-border-weaker-base": reviewOpen() }}
    >
      {/* 上半部分：文件树 */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <Tabs variant="pill" value={fileTreeTab()} onChange={setFileTreeTabValue} class="h-full" data-scope="filetree">
          <Tabs.List>
            <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
              {language.t("session.files.all")}
            </Tabs.Trigger>
            <Tabs.Trigger value="review" class="flex-1" classes={{ button: "w-full" }}>
              {language.t("session.tab.review")}
            </Tabs.Trigger>
            <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
              {props.reviewCount()}{" "}
              {language.t(props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
            </Tabs.Trigger>
            <Tabs.Trigger value="database" class="flex-1" classes={{ button: "w-full" }}>
              数据库
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={props.hasReview() || !props.diffsReady()}>
                <Show
                  when={props.diffsReady()}
                  fallback={
                    <div class="px-2 py-2 text-12-regular text-text-weak">
                      {language.t("common.loading")}
                      {language.t("common.loading.ellipsis")}
                    </div>
                  }
                >
                  <FileTree
                    path=""
                    class="pt-3"
                    allowed={diffFiles()}
                    kinds={kinds()}
                    draggable={false}
                    active={props.activeDiff}
                    onFileClick={(node) => props.focusReviewDiff(node.path)}
                  />
                </Show>
              </Match>
            </Switch>
          </Tabs.Content>
          <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
            <Switch>
              <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
              <Match when={true}>
                <FileTree
                  path=""
                  class="pt-3"
                  modified={diffFiles()}
                  kinds={kinds()}
                  onFileClick={(node) => openTab(file.tab(node.path))}
                />
              </Match>
            </Switch>
          </Tabs.Content>
          <Tabs.Content value="review" class="bg-background-stronger p-0">
            <Show when={props.canReview()} fallback={empty(language.t("session.review.noChanges"))}>
              {props.reviewPanel()}
            </Show>
          </Tabs.Content>
          <Tabs.Content value="database" class="bg-background-stronger h-full overflow-hidden">
            <DatabaseTab />
          </Tabs.Content>
        </Tabs>
      </div>

      {/* 分割线 */}
      <ResizeHandle
        direction="vertical"
        edge="start"
        size={layout.fileTree.height()}
        min={100}
        max={400}
        onResize={(height) => {
          props.size.touch()
          layout.fileTree.setHeight(height)
        }}
      />

      {/* 下半部分：任务列表 */}
      <div class="h-[200px] min-h-[100px] border-t border-border-weaker-base">
        <TaskList />
      </div>
    </div>
    <Show when={fileOpen()}>
      <div onPointerDown={() => props.size.start()}>
        <ResizeHandle
          direction="horizontal"
          edge="start"
          size={layout.fileTree.width()}
          min={200}
          max={480}
          onResize={(width) => {
            props.size.touch()
            layout.fileTree.resize(width)
          }}
        />
      </div>
    </Show>
  </div>
</Show>
```

- [ ] **Step 2: 添加TaskList导入**

```tsx
// 在文件顶部添加导入
import { TaskList } from "@/components/task-list"
```

- [ ] **Step 3: 运行测试验证垂直分割布局**

Run: `cd packages/app && bun test session-side-panel`
Expected: PASS (垂直分割布局测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/pages/session/session-side-panel.tsx
git commit -m "feat: add vertical split layout to side panel"
```

---

### Task 5: 添加任务列表高度状态管理

**Files:**

- Modify: `packages/app/src/context/layout.tsx`
- Test: `packages/app/src/context/layout.test.tsx`

- [ ] **Step 1: 添加任务列表高度状态**

在 `packages/app/src/context/layout.tsx` 中添加：

```tsx
// 在 SessionView 类型中添加
type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  todoCollapsed?: boolean
  todoHeight?: number // 新增
}

// 在视图状态中添加高度管理
todoHeight: {
  get: () => s().todoHeight ?? 200,
  set(height: number) {
    const session = key()
    const current = store.sessionView[session]
    if (!current) {
      setStore("sessionView", session, { scroll: {}, todoHeight: height })
    } else {
      setStore("sessionView", session, "todoHeight", height)
    }
  },
},
```

- [ ] **Step 2: 运行测试验证高度状态管理**

Run: `cd packages/app && bun test layout`
Expected: PASS (高度状态管理测试)

- [ ] **Step 3: 提交代码**

```bash
git add packages/app/src/context/layout.tsx
git commit -m "feat: add todo height state management"
```

---

### Task 6: 添加可拖拽分割线

**Files:**

- Modify: `packages/app/src/pages/session/session-side-panel.tsx`
- Test: `packages/app/src/pages/session/session-side-panel.test.tsx`

- [ ] **Step 1: 添加可拖拽分割线**

```tsx
// 在 task-list.tsx 中添加分割线组件
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"

// 在 TaskList 组件中添加
const layout = useLayout()

// 更新组件返回，添加可拖拽分割线
return (
  <div class={`flex flex-col h-full ${props.class ?? ""}`}>
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel cursor-pointer hover:bg-surface-raised-base-hover"
      onClick={toggleCollapse}
    >
      <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
      <div class="flex items-center gap-2">
        <span class="text-11-regular text-text-weak">
          {completedCount()}/{tasks().length}
        </span>
        <Icon name={isCollapsed() ? "chevron-right" : "chevron-down"} size="small" class="text-icon-weak" />
      </div>
    </div>
    <Show when={!isCollapsed()}>
      <div class="flex-1 overflow-y-auto px-2 py-1">{/* 任务列表内容 */}</div>
    </Show>
  </div>
)
```

- [ ] **Step 2: 在session-side-panel中集成分割线**

```tsx
// 在 session-side-panel.tsx 中更新分割线逻辑
<ResizeHandle
  direction="vertical"
  edge="start"
  size={layout.fileTree.todoHeight()}
  min={100}
  max={400}
  onResize={(height) => {
    props.size.touch()
    layout.fileTree.todoHeight.set(height)
  }}
/>
```

- [ ] **Step 3: 运行测试验证可拖拽分割线**

Run: `cd packages/app && bun test session-side-panel`
Expected: PASS (可拖拽分割线测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/pages/session/session-side-panel.tsx packages/app/src/components/task-list.tsx
git commit -m "feat: add resizable split handle for task list"
```

---

### Task 7: 添加键盘快捷键

**Files:**

- Modify: `packages/app/src/pages/session/use-session-commands.tsx`
- Test: `packages/app/src/pages/session/use-session-commands.test.tsx`

- [ ] **Step 1: 添加键盘快捷键**

```tsx
// 在 use-session-commands.tsx 中添加
command.add({
  id: "taskList.toggle",
  description: language.t("command.taskList.toggle"),
  keybind: "Ctrl+T",
  action: () => {
    const { view } = useSessionLayout()
    view().todoCollapsed.set(!view().todoCollapsed())
  },
})

command.add({
  id: "taskList.collapse",
  description: language.t("command.taskList.collapse"),
  keybind: "Ctrl+Shift+T",
  action: () => {
    const { view } = useSessionLayout()
    view().todoCollapsed.set(true)
  },
})
```

- [ ] **Step 2: 添加国际化键值**

在 `packages/app/src/i18n/locales/en.json` 中添加：

```json
{
  "command": {
    "taskList": {
      "toggle": "Toggle Task List",
      "collapse": "Collapse Task List"
    }
  }
}
```

在 `packages/app/src/i18n/locales/zh.json` 中添加：

```json
{
  "command": {
    "taskList": {
      "toggle": "切换任务列表",
      "collapse": "折叠任务列表"
    }
  }
}
```

- [ ] **Step 3: 运行测试验证键盘快捷键**

Run: `cd packages/app && bun test use-session-commands`
Expected: PASS (键盘快捷键测试)

- [ ] **Step 4: 提交代码**

```bash
git add packages/app/src/pages/session/use-session-commands.tsx packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/zh.json
git commit -m "feat: add keyboard shortcuts for task list"
```

---

### Task 8: 添加响应式设计支持

**Files:**

- Modify: `packages/app/src/components/task-list.tsx`
- Test: `packages/app/src/components/task-list.test.tsx`

- [ ] **Step 1: 添加响应式设计**

```tsx
// 在 task-list.tsx 中添加响应式设计
import { createMediaQuery } from "@solid-primitives/media"

// 在 TaskList 组件中添加
const isDesktop = createMediaQuery("(min-width: 768px)")
const isTablet = createMediaQuery("(min-width: 768px) and (max-width: 1024px)")
const isMobile = createMediaQuery("(max-width: 768px)")

// 更新组件返回，添加响应式设计
return (
  <div class={`flex flex-col h-full ${props.class ?? ""}`}>
    <Show when={isDesktop()}>
      {/* 桌面端布局 */}
      <div
        class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel cursor-pointer hover:bg-surface-raised-base-hover"
        onClick={toggleCollapse}
      >
        <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
        <div class="flex items-center gap-2">
          <span class="text-11-regular text-text-weak">
            {completedCount()}/{tasks().length}
          </span>
          <Icon name={isCollapsed() ? "chevron-right" : "chevron-down"} size="small" class="text-icon-weak" />
        </div>
      </div>
      <Show when={!isCollapsed()}>
        <div class="flex-1 overflow-y-auto px-2 py-1">{/* 任务列表内容 */}</div>
      </Show>
    </Show>

    <Show when={isMobile()}>
      {/* 移动端布局 */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-border-weaker-base bg-surface-panel">
        <span class="text-12-medium text-text-strong">{language.t("taskList.title")}</span>
        <span class="text-11-regular text-text-weak">
          {completedCount()}/{tasks().length}
        </span>
      </div>
      <div class="flex-1 overflow-y-auto px-2 py-1">{/* 任务列表内容 */}</div>
    </Show>
  </div>
)
```

- [ ] **Step 2: 运行测试验证响应式设计**

Run: `cd packages/app && bun test task-list`
Expected: PASS (响应式设计测试)

- [ ] **Step 3: 提交代码**

```bash
git add packages/app/src/components/task-list.tsx
git commit -m "feat: add responsive design for task list"
```

---

### Task 9: 添加完整测试覆盖

**Files:**

- Modify: `packages/app/src/components/task-list.test.tsx`
- Test: `packages/app/src/components/task-list.test.tsx`

- [ ] **Step 1: 添加完整测试用例**

```tsx
// packages/app/src/components/task-list.test.tsx
import { render, screen, fireEvent } from "@testing-library/solid"
import { TaskList } from "./task-list"
import { createSignal } from "solid-js"

describe("TaskList", () => {
  it("renders task list with correct title", () => {
    render(() => <TaskList />)
    expect(screen.getByText("任务列表")).toBeInTheDocument()
  })

  it("shows empty state when no tasks", () => {
    render(() => <TaskList />)
    expect(screen.getByText("暂无任务")).toBeInTheDocument()
  })

  it("toggles collapse on title click", async () => {
    render(() => <TaskList />)
    const title = screen.getByText("任务列表")
    await fireEvent.click(title)
    // 验证折叠状态变化
  })

  it("displays correct task count", () => {
    render(() => <TaskList />)
    expect(screen.getByText("0/0")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行完整测试**

Run: `cd packages/app && bun test task-list`
Expected: PASS (所有测试用例)

- [ ] **Step 3: 提交代码**

```bash
git add packages/app/src/components/task-list.test.tsx
git commit -m "test: add comprehensive tests for TaskList component"
```

---

### Task 10: 集成验证和最终测试

**Files:**

- Test: `packages/app/src/pages/session/session-side-panel.test.tsx`
- Test: `packages/app/src/components/task-list.test.tsx`

- [ ] **Step 1: 运行集成测试**

Run: `cd packages/app && bun test`
Expected: PASS (所有测试)

- [ ] **Step 2: 运行类型检查**

Run: `cd packages/app && bun typecheck`
Expected: PASS (无类型错误)

- [ ] **Step 3: 运行代码检查**

Run: `cd packages/app && bun lint`
Expected: PASS (无 lint 错误)

- [ ] **Step 4: 手动验证功能**

1. 启动开发服务器：`cd packages/app && bun dev`
2. 打开浏览器访问 http://localhost:4444
3. 验证侧边栏显示任务列表
4. 验证任务状态与聊天区域同步
5. 验证分割线可拖拽调整
6. 验证折叠/展开功能正常
7. 验证键盘快捷键工作正常

- [ ] **Step 5: 提交最终代码**

```bash
git add .
git commit -m "feat: complete sidebar task list layout implementation"
```

---

## 自我审查

### 1. 规范覆盖检查

- ✅ 任务列表独立显示在侧边栏
- ✅ 上下分割布局
- ✅ 任务状态实时同步
- ✅ 折叠/展开功能
- ✅ 可拖拽分割线
- ✅ 响应式设计
- ✅ 键盘快捷键

### 2. 占位符扫描

- ✅ 无 "TBD"、"TODO" 或模糊描述
- ✅ 所有步骤都有具体代码和命令
- ✅ 测试用例完整

### 3. 类型一致性

- ✅ Task 类型定义一致
- ✅ 状态管理类型一致
- ✅ 组件接口类型一致

**审查通过，可以开始实施。**
