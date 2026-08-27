# Phase 3: 目标驱动 + 任务跟踪实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现正式的目标（Goal）实体，支持目标分解、进度跟踪、目标与任务关联，使 NovaWay 具备 MiMo-Code 的目标驱动能力。

**Architecture:** 
- **Goal 系统**: 新增 GoalTable 和 GoalService，支持层级目标、进度跟踪、成功标准
- **目标-任务关联**: 扩展 TodoTable，添加 goal_id 字段关联目标
- **目标工具**: 新增 GoalTool，让 AI 可以创建、更新、评估目标
- **目标 UI**: TUI 侧边栏和 Web UI 目标面板

**Tech Stack:** Effect v4, Drizzle ORM, SQLite, InstanceState, Bus.Service

---

## Task 1: 添加 Goal 数据库表

**Files:**
- Create: `packages/NovaWay/src/session/goal.sql.ts`
- Modify: `packages/NovaWay/src/session/session.sql.ts` (导出新模块)

- [ ] **Step 1: 创建 Goal Schema 定义**

```typescript
// packages/NovaWay/src/session/goal.sql.ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"

export interface GoalProgress {
  readonly total: number
  readonly completed: number
  readonly percentage: number
}

export const GoalTable = sqliteTable("goal", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  parent_id: text("parent_id"),
  title: text().notNull(),
  description: text(),
  status: text("status").notNull().default("pending"),  // pending, in_progress, completed, cancelled
  priority: text("priority").notNull().default("medium"),  // high, medium, low
  success_criteria: text("success_criteria"),  // JSON array of success criteria
  deadline: integer("deadline", { mode: "timestamp_ms" }),
  progress: real("progress").notNull().default(0),  // 0-100 percentage
  tags: text({ mode: "json" }).$type<string[]>().default([]),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})
```

- [ ] **Step 2: 更新 TodoTable 添加 goal_id**

```typescript
// packages/NovaWay/src/session/session.sql.ts 修改 TodoTable
export const TodoTable = sqliteTable("todo", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  goal_id: text("goal_id"),  // 新增：关联目标
  content: text().notNull(),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})
```

- [ ] **Step 3: 运行数据库迁移**

```bash
cd packages/NovaWay && bun run db generate --name goal
```

- [ ] **Step 4: 提交**

```bash
git add packages/NovaWay/src/session/goal.sql.ts packages/NovaWay/src/session/session.sql.ts
git commit -m "feat(session): add goal schema for goal-driven task tracking"
```

---

## Task 2: 实现 Goal.Service

**Files:**
- Create: `packages/NovaWay/src/session/goal.ts`
- Modify: `packages/NovaWay/src/session/todo.ts` (添加 goal_id 支持)

- [ ] **Step 1: 创建 Goal.Service 定义**

```typescript
// packages/NovaWay/src/session/goal.ts
import { Context, Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { GoalTable, type GoalProgress } from "./goal.sql"
import { TodoTable } from "./session.sql"
import { InstanceState } from "@/effect/instance-state"

export interface Goal {
  readonly id: string
  readonly sessionId: string
  readonly parentId: string | null
  readonly title: string
  readonly description: string | null
  readonly status: "pending" | "in_progress" | "completed" | "cancelled"
  readonly priority: "high" | "medium" | "low"
  readonly successCriteria: string[] | null
  readonly deadline: Date | null
  readonly progress: number
  readonly tags: string[]
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface Interface {
  readonly create: (input: {
    sessionId: string
    parentId?: string
    title: string
    description?: string
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal>

  readonly list: (sessionId: string) => Effect.Effect<readonly Goal[]>

  readonly get: (goalId: string) => Effect.Effect<Goal | null>

  readonly update: (input: {
    goalId: string
    title?: string
    description?: string
    status?: Goal["status"]
    priority?: Goal["priority"]
    successCriteria?: string[]
    deadline?: Date
    tags?: string[]
  }) => Effect.Effect<Goal>

  readonly delete: (goalId: string) => Effect.Effect<void>

  readonly getProgress: (goalId: string) => Effect.Effect<GoalProgress>

  readonly updateProgress: (goalId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Interface>()("@NovaWay/GoalService") {}

const generateId = () => `goal_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database

    const toGoal = (row: any): Goal => ({
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id,
      title: row.title,
      description: row.description,
      status: row.status as Goal["status"],
      priority: row.priority as Goal["priority"],
      successCriteria: row.success_criteria ? JSON.parse(row.success_criteria) : null,
      deadline: row.deadline ? new Date(row.deadline) : null,
      progress: row.progress,
      tags: (row.tags as string[]) ?? [],
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })

    return {
      create: Effect.fn("GoalService.create")(function* (input) {
        const now = new Date()
        const goal: Goal = {
          id: generateId(),
          sessionId: input.sessionId,
          parentId: input.parentId ?? null,
          title: input.title,
          description: input.description ?? null,
          status: "pending",
          priority: input.priority ?? "medium",
          successCriteria: input.successCriteria ?? null,
          deadline: input.deadline ?? null,
          progress: 0,
          tags: input.tags ?? [],
          createdAt: now,
          updatedAt: now,
        }

        yield* db.insert(GoalTable).values({
          id: goal.id,
          session_id: goal.sessionId,
          parent_id: goal.parentId,
          title: goal.title,
          description: goal.description,
          status: goal.status,
          priority: goal.priority,
          success_criteria: goal.successCriteria ? JSON.stringify(goal.successCriteria) : null,
          deadline: goal.deadline?.getTime() ?? null,
          progress: goal.progress,
          tags: goal.tags,
          created_at: goal.createdAt.getTime(),
          updated_at: goal.updatedAt.getTime(),
        })

        return goal
      }),

      list: Effect.fn("GoalService.list")(function* (sessionId) {
        const rows = yield* db
          .select()
          .from(GoalTable)
          .where(eq(GoalTable.session_id, sessionId))
          .orderBy(GoalTable.created_at)

        return rows.map(toGoal)
      }),

      get: Effect.fn("GoalService.get")(function* (goalId) {
        const row = yield* db
          .select()
          .from(GoalTable)
          .where(eq(GoalTable.id, goalId))
          .limit(1)

        if (row.length === 0) return null
        return toGoal(row[0])
      }),

      update: Effect.fn("GoalService.update")(function* (input) {
        const now = new Date()
        yield* db
          .update(GoalTable)
          .set({
            ...(input.title && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.status && { status: input.status }),
            ...(input.priority && { priority: input.priority }),
            ...(input.successCriteria !== undefined && {
              success_criteria: input.successCriteria ? JSON.stringify(input.successCriteria) : null,
            }),
            ...(input.deadline !== undefined && {
              deadline: input.deadline?.getTime() ?? null,
            }),
            ...(input.tags !== undefined && { tags: input.tags }),
            updated_at: now.getTime(),
          })
          .where(eq(GoalTable.id, input.goalId))

        const updated = yield* db
          .select()
          .from(GoalTable)
          .where(eq(GoalTable.id, input.goalId))
          .limit(1)

        return toGoal(updated[0])
      }),

      delete: Effect.fn("GoalService.delete")(function* (goalId) {
        yield* db.delete(GoalTable).where(eq(GoalTable.id, goalId))
      }),

      getProgress: Effect.fn("GoalService.getProgress")(function* (goalId) {
        const todos = yield* db
          .select()
          .from(TodoTable)
          .where(eq(TodoTable.goal_id, goalId))

        const total = todos.length
        const completed = todos.filter((t) => t.status === "completed").length
        const percentage = total > 0 ? (completed / total) * 100 : 0

        return { total, completed, percentage }
      }),

      updateProgress: Effect.fn("GoalService.updateProgress")(function* (goalId) {
        const progress = yield* this.getProgress(goalId)
        yield* db
          .update(GoalTable)
          .set({ progress: progress.percentage, updated_at: Date.now() })
          .where(eq(GoalTable.id, goalId))
      }),
    }
  }),
)

export const defaultLayer = layer
```

- [ ] **Step 2: 更新 TodoService 添加 goal_id 支持**

```typescript
// packages/NovaWay/src/session/todo.ts 修改
export interface Interface {
  readonly list: (sessionId: string) => Effect.Effect<readonly Todo[]>
  readonly add: (input: { sessionId: string; content: string; priority?: Todo["priority"]; goalId?: string }) => Effect.Effect<Todo>
  readonly update: (input: { todoId: string; status?: Todo["status"]; content?: string }) => Effect.Effect<Todo>
  readonly remove: (todoId: string) => Effect.Effect<void>
}
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/session/goal.ts packages/NovaWay/src/session/todo.ts
git commit -m "feat(session): implement GoalService for goal-driven task tracking"
```

---

## Task 3: 创建 GoalTool

**Files:**
- Create: `packages/NovaWay/src/tool/goal.ts`
- Modify: `packages/NovaWay/src/tool/registry.ts` (注册工具)

- [ ] **Step 1: 创建 GoalTool 定义**

```typescript
// packages/NovaWay/src/tool/goal.ts
import { Tool } from "./tool"
import { GoalService } from "@/session/goal"
import { SessionID } from "@/session/schema"

export const GoalTool = Tool.define({
  name: "goal",
  description: "管理目标（Goal）- 创建、更新、查看、分解目标",
  parameters: {
    action: Tool.Parameter.enum("create", "update", "list", "get", "progress", "decompose"),
    goalId: Tool.Parameter.optional(Tool.Parameter.string("目标ID")),
    title: Tool.Parameter.optional(Tool.Parameter.string("目标标题")),
    description: Tool.Parameter.optional(Tool.Parameter.string("目标描述")),
    parentId: Tool.Parameter.optional(Tool.Parameter.string("父目标ID")),
    status: Tool.Parameter.optional(Tool.Parameter.enum("pending", "in_progress", "completed", "cancelled")),
    priority: Tool.Parameter.optional(Tool.Parameter.enum("high", "medium", "low")),
    successCriteria: Tool.Parameter.optional(Tool.Parameter.array(Tool.Parameter.string())),
    deadline: Tool.Parameter.optional(Tool.Parameter.string("截止日期 ISO 格式")),
    tags: Tool.Parameter.optional(Tool.Parameter.array(Tool.Parameter.string())),
  },
  execute: async (params, ctx) => {
    const goalService = ctx.context.get(GoalService)
    const sessionId = SessionID.make(ctx.sessionID)

    switch (params.action) {
      case "create":
        const created = await goalService.create({
          sessionId,
          parentId: params.parentId,
          title: params.title!,
          description: params.description,
          priority: params.priority as any,
          successCriteria: params.successCriteria,
          deadline: params.deadline ? new Date(params.deadline) : undefined,
          tags: params.tags,
        })
        return `目标已创建: ${created.id} - ${created.title}`

      case "update":
        const updated = await goalService.update({
          goalId: params.goalId!,
          title: params.title,
          description: params.description,
          status: params.status as any,
          priority: params.priority as any,
          successCriteria: params.successCriteria,
          deadline: params.deadline ? new Date(params.deadline) : undefined,
          tags: params.tags,
        })
        return `目标已更新: ${updated.id} - ${updated.title} (状态: ${updated.status})`

      case "list":
        const goals = await goalService.list(sessionId)
        if (goals.length === 0) return "暂无目标"
        return goals.map((g) => `${g.id}: ${g.title} [${g.status}] ${g.progress}%`).join("\n")

      case "get":
        const goal = await goalService.get(params.goalId!)
        if (!goal) return "目标不存在"
        return `ID: ${goal.id}\n标题: ${goal.title}\n状态: ${goal.status}\n进度: ${goal.progress}%\n优先级: ${goal.priority}`

      case "progress":
        const progress = await goalService.getProgress(params.goalId!)
        return `任务: ${progress.total} 总计, ${progress.completed} 完成, ${progress.percentage.toFixed(1)}%`

      case "decompose":
        // 目标分解功能 - 将大目标拆解为子目标
        const targetGoal = await goalService.get(params.goalId!)
        if (!targetGoal) return "目标不存在"
        // 这里可以集成 LLM 进行智能分解
        return `目标 "${targetGoal.title}" 需要手动分解为子目标`

      default:
        return "未知操作"
    }
  },
})
```

- [ ] **Step 2: 注册工具**

```typescript
// packages/NovaWay/src/tool/registry.ts 添加
import { GoalTool } from "./goal"

// 在工具列表中添加
export const defaultTools = [
  // ... 现有工具
  GoalTool,
]
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/tool/goal.ts packages/NovaWay/src/tool/registry.ts
git commit -m "feat(tool): add GoalTool for AI-driven goal management"
```

---

## Task 4: 创建 Goal UI 组件

**Files:**
- Create: `packages/tui/src/component/goal-panel.tsx`
- Modify: `packages/tui/src/routes/session/sidebar.tsx` (添加目标标签页)

- [ ] **Step 1: 创建 GoalPanel 组件**

```tsx
// packages/tui/src/component/goal-panel.tsx
import { createSignal, createMemo, onMount, For, Show, batch } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogConfirm } from "../ui/dialog-confirm"

interface Goal {
  id: string
  title: string
  description: string | null
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
  progress: number
  tags: string[]
  createdAt: Date
}

export interface GoalPanelProps {
  sessionID: string
}

export function GoalPanel(props: GoalPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const dialog = useDialog()

  const [goals, setGoals] = createSignal<Goal[]>([])
  const [loading, setLoading] = createSignal(true)
  const [filter, setFilter] = createSignal<"all" | "pending" | "in_progress" | "completed">("all")

  const filteredGoals = createMemo(() => {
    if (filter() === "all") return goals()
    return goals().filter((g) => g.status === filter())
  })

  async function loadData() {
    setLoading(true)
    try {
      const result = await (sdk.client as any).get(`/session/${props.sessionID}/goals`)
      setGoals(result.data ?? [])
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createGoal() {
    // 这里可以打开创建对话框
    try {
      await (sdk.client as any).post(`/session/${props.sessionID}/goals`, {
        title: "新目标",
        priority: "medium",
      })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function updateGoalStatus(goalId: string, status: Goal["status"]) {
    try {
      await (sdk.client as any).patch(`/goals/${goalId}`, { status })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  function priorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      high: "🔴 高",
      medium: "🟡 中",
      low: "🟢 低",
    }
    return labels[priority] ?? priority
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: "待处理",
      in_progress: "进行中",
      completed: "已完成",
      cancelled: "已取消",
    }
    return labels[status] ?? status
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>🎯 目标</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 创建按钮 */}
      <text fg={theme.primary} onMouseUp={createGoal}>
        [创建目标]
      </text>

      {/* 筛选 */}
      <box flexDirection="row" gap={1}>
        <For each={["all", "pending", "in_progress", "completed"] as const}>
          {(f) => (
            <text
              fg={filter() === f ? theme.primary : theme.textMuted}
              onMouseUp={() => setFilter(f)}
            >
              [{f === "all" ? "全部" : statusLabel(f)}]
            </text>
          )}
        </For>
      </box>

      {/* 列表 */}
      <Show
        when={filteredGoals().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无目标"}</text>}
      >
        <For each={filteredGoals()}>
          {(goal) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span> {goal.title}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>
                  {priorityLabel(goal.priority)} · {statusLabel(goal.status)}
                </text>
              </box>
              {/* 进度条 */}
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>进度:</text>
                <text fg={theme.primary}>{goal.progress.toFixed(0)}%</text>
              </box>
              <Show when={goal.tags.length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={goal.tags.slice(0, 3)}>
                    {(tag) => (
                      <text fg={theme.textMuted}>[{tag}]</text>
                    )}
                  </For>
                </box>
              </Show>
              {/* 操作按钮 */}
              <box flexDirection="row" gap={1}>
                <Show when={goal.status === "pending"}>
                  <text fg={theme.success} onMouseUp={() => updateGoalStatus(goal.id, "in_progress")}>
                    [开始]
                  </text>
                </Show>
                <Show when={goal.status === "in_progress"}>
                  <text fg={theme.success} onMouseUp={() => updateGoalStatus(goal.id, "completed")}>
                    [完成]
                  </text>
                </Show>
                <Show when={goal.status !== "cancelled" && goal.status !== "completed"}>
                  <text fg={theme.error} onMouseUp={() => updateGoalStatus(goal.id, "cancelled")}>
                    [取消]
                  </text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
```

- [ ] **Step 2: 更新侧边栏添加目标标签页**

```typescript
// packages/tui/src/routes/session/sidebar.tsx 修改
import { GoalPanel } from "../../component/goal-panel"

// 在 SidebarTab 类型中添加
type SidebarTab = "files" | "info" | "memory" | "evolution" | "checkpoint" | "goal"

// 在标签页切换中添加
<text
  fg={activeTab() === "goal" ? theme.primary : theme.textMuted}
  onMouseUp={() => setActiveTab("goal")}
>
  🎯 目标
</text>

// 在面板显示中添加
<Show when={activeTab() === "goal"}>
  <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration()}>
    <box flexShrink={0} gap={1} paddingRight={1}>
      <GoalPanel sessionID={props.sessionID} />
    </box>
  </scrollbox>
</Show>
```

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/component/goal-panel.tsx packages/tui/src/routes/session/sidebar.tsx
git commit -m "feat(tui): add goal panel for goal-driven task tracking"
```

---

## Task 5: 注册 Goal API 路由

**Files:**
- Create: `packages/NovaWay/src/server/routes/instance/httpapi/groups/goal.ts`
- Create: `packages/NovaWay/src/server/routes/instance/httpapi/handlers/goal.ts`
- Modify: `packages/NovaWay/src/server/routes/instance/httpapi/api.ts` (注册路由)
- Modify: `packages/NovaWay/src/server/routes/instance/httpapi/server.ts` (注册处理器)

- [ ] **Step 1: 创建 Goal API 组**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/groups/goal.ts
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/goals"

export const GoalApi = HttpApiGroup.make("goal")
  .add(
    HttpApiEndpoint.get("listGoals", root)
      .annotate(described, { summary: "获取会话目标列表" }),
  )
  .add(
    HttpApiEndpoint.post("createGoal", root)
      .annotate(described, { summary: "创建目标" })
      .payload(
        Schema.Struct({
          title: Schema.String,
          description: Schema.optional(Schema.String),
          parentId: Schema.optional(Schema.String),
          priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
          successCriteria: Schema.optional(Schema.Array(Schema.String)),
          deadline: Schema.optional(Schema.String),
          tags: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getGoal", "/goals/:goalId")
      .annotate(described, { summary: "获取目标详情" }),
  )
  .add(
    HttpApiEndpoint.patch("updateGoal", "/goals/:goalId")
      .annotate(described, { summary: "更新目标" })
      .payload(
        Schema.Struct({
          title: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
          status: Schema.optional(Schema.Literals(["pending", "in_progress", "completed", "cancelled"])),
          priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
          successCriteria: Schema.optional(Schema.Array(Schema.String)),
          deadline: Schema.optional(Schema.String),
          tags: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("deleteGoal", "/goals/:goalId")
      .annotate(described, { summary: "删除目标" }),
  )
  .add(
    HttpApiEndpoint.get("getGoalProgress", "/goals/:goalId/progress")
      .annotate(described, { summary: "获取目标进度" }),
  )
```

- [ ] **Step 2: 创建 Goal 处理器**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/handlers/goal.ts
import { GoalService } from "@/session/goal"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const goalHandlers = HttpApiBuilder.group(InstanceHttpApi, "goal", (handlers) =>
  Effect.gen(function* () {
    const goal = yield* GoalService

    return handlers
      .handle("listGoals", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.path.sessionId)
          const goals = yield* goal.list(sessionId)
          return goals.map((g) => ({
            id: g.id,
            sessionId: g.sessionId,
            parentId: g.parentId ?? undefined,
            title: g.title,
            description: g.description ?? undefined,
            status: g.status,
            priority: g.priority,
            successCriteria: g.successCriteria ?? undefined,
            deadline: g.deadline?.toISOString(),
            progress: g.progress,
            tags: g.tags,
            createdAt: g.createdAt.toISOString(),
            updatedAt: g.updatedAt.toISOString(),
          }))
        }),
      )
      .handle("createGoal", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.path.sessionId)
          const created = yield* goal.create({
            sessionId,
            parentId: ctx.payload.parentId,
            title: ctx.payload.title,
            description: ctx.payload.description,
            priority: ctx.payload.priority as any,
            successCriteria: ctx.payload.successCriteria,
            deadline: ctx.payload.deadline ? new Date(ctx.payload.deadline) : undefined,
            tags: ctx.payload.tags,
          })
          return {
            id: created.id,
            sessionId: created.sessionId,
            parentId: created.parentId ?? undefined,
            title: created.title,
            description: created.description ?? undefined,
            status: created.status,
            priority: created.priority,
            successCriteria: created.successCriteria ?? undefined,
            deadline: created.deadline?.toISOString(),
            progress: created.progress,
            tags: created.tags,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }
        }),
      )
      .handle("getGoal", (ctx) =>
        Effect.gen(function* () {
          const g = yield* goal.get(ctx.path.goalId)
          if (!g) {
            return yield* Effect.fail(new HttpApiError.NotFound({}))
          }
          return {
            id: g.id,
            sessionId: g.sessionId,
            parentId: g.parentId ?? undefined,
            title: g.title,
            description: g.description ?? undefined,
            status: g.status,
            priority: g.priority,
            successCriteria: g.successCriteria ?? undefined,
            deadline: g.deadline?.toISOString(),
            progress: g.progress,
            tags: g.tags,
            createdAt: g.createdAt.toISOString(),
            updatedAt: g.updatedAt.toISOString(),
          }
        }),
      )
      .handle("updateGoal", (ctx) =>
        Effect.gen(function* () {
          const updated = yield* goal.update({
            goalId: ctx.path.goalId,
            ...ctx.payload,
            status: ctx.payload.status as any,
            priority: ctx.payload.priority as any,
            deadline: ctx.payload.deadline ? new Date(ctx.payload.deadline) : undefined,
          })
          return {
            id: updated.id,
            sessionId: updated.sessionId,
            parentId: updated.parentId ?? undefined,
            title: updated.title,
            description: updated.description ?? undefined,
            status: updated.status,
            priority: updated.priority,
            successCriteria: updated.successCriteria ?? undefined,
            deadline: updated.deadline?.toISOString(),
            progress: updated.progress,
            tags: updated.tags,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          }
        }),
      )
      .handle("deleteGoal", (ctx) =>
        Effect.gen(function* () {
          yield* goal.delete(ctx.path.goalId)
          return { success: true }
        }),
      )
      .handle("getGoalProgress", (ctx) =>
        Effect.gen(function* () {
          const progress = yield* goal.getProgress(ctx.path.goalId)
          return progress
        }),
      )
  }),
)
```

- [ ] **Step 3: 注册路由和处理器**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/api.ts 添加
import { GoalApi } from "./groups/goal"

// 在 InstanceHttpApi 中添加
.addHttpApi(GoalApi)

// packages/NovaWay/src/server/routes/instance/httpapi/server.ts 添加
import { goalHandlers } from "./handlers/goal"

// 在 instanceApiRoutes 中添加
goalHandlers,
```

- [ ] **Step 4: 提交**

```bash
git add packages/NovaWay/src/server/routes/instance/httpapi/groups/goal.ts packages/NovaWay/src/server/routes/instance/httpapi/handlers/goal.ts packages/NovaWay/src/server/routes/instance/httpapi/api.ts packages/NovaWay/src/server/routes/instance/httpapi/server.ts
git commit -m "feat(server): add goal API routes for goal-driven task tracking"
```

---

## Task 6: 集成目标上下文到代理提示

**Files:**
- Modify: `packages/NovaWay/src/session/system.ts` (系统提示注入目标上下文)

- [ ] **Step 1: 在系统提示中添加目标上下文**

```typescript
// packages/NovaWay/src/session/system.ts 修改
// 在构建系统提示时添加目标上下文
const buildGoalContext = Effect.fn("SystemPrompt.buildGoalContext")(function* (
  sessionId: SessionID,
) {
  const goalService = yield* GoalService
  const goals = yield* goalService.list(sessionId)
  
  if (goals.length === 0) return ""
  
  const activeGoals = goals.filter((g) => g.status === "in_progress" || g.status === "pending")
  if (activeGoals.length === 0) return ""
  
  const goalText = activeGoals
    .map((g) => `- ${g.title} [${g.status}] ${g.progress}% 完成`)
    .join("\n")
  
  return `\n\n## 当前目标\n${goalText}\n\n请优先完成上述目标，或根据目标分解任务。`
})

// 在系统提示构建中调用
const goalContext = yield* buildGoalContext(sessionId)
const systemPrompt = basePrompt + goalContext
```

- [ ] **Step 2: 提交**

```bash
git add packages/NovaWay/src/session/system.ts
git commit -m "feat(session): inject goal context into system prompt"
```

---

## Task 7: 测试验证

**Files:**
- Create: `packages/NovaWay/test/session/goal.test.ts`

- [ ] **Step 1: 编写 Goal 测试**

```typescript
// packages/NovaWay/test/session/goal.test.ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { GoalService } from "../../src/session/goal"
import { layer } from "../../src/session/goal"

describe("GoalService", () => {
  it.effect("creates and retrieves goal", () =>
    Effect.gen(function* () {
      const service = yield* GoalService
      const goal = yield* service.create({
        sessionId: "test-session",
        title: "Test Goal",
        description: "Testing",
        priority: "high",
      })

      expect(goal.title).toBe("Test Goal")
      expect(goal.sessionId).toBe("test-session")
      expect(goal.status).toBe("pending")

      const retrieved = yield* service.get(goal.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.title).toBe("Test Goal")
    }).pipe(Effect.provide(layer))
  )

  it.effect("updates goal progress", () =>
    Effect.gen(function* () {
      const service = yield* GoalService
      const goal = yield* service.create({
        sessionId: "test-session",
        title: "Progress Goal",
      })

      // 初始进度为 0
      let progress = yield* service.getProgress(goal.id)
      expect(progress.percentage).toBe(0)

      // 更新进度
      yield* service.updateProgress(goal.id)
      progress = yield* service.getProgress(goal.id)
      expect(progress.percentage).toBe(0) // 没有关联任务，进度仍为 0
    }).pipe(Effect.provide(layer))
  )

  it.effect("lists goals by session", () =>
    Effect.gen(function* () {
      const service = yield* GoalService
      yield* service.create({ sessionId: "session-1", title: "Goal 1" })
      yield* service.create({ sessionId: "session-2", title: "Goal 2" })

      const list = yield* service.list("session-1")
      expect(list.length).toBe(1)
      expect(list[0].title).toBe("Goal 1")
    }).pipe(Effect.provide(layer))
  )
})
```

- [ ] **Step 2: 运行测试**

```bash
cd packages/NovaWay && bun test test/session/goal.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/test/session/goal.test.ts
git commit -m "test(session): add goal service tests"
```

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-08-24-mimo-goal-tracking.md`**

**两种执行方式：**

1. **子代理驱动（推荐）** - 每个任务派发一个新子代理，任务间进行审查，快速迭代

2. **内联执行** - 在当前会话中使用 executing-plans 批量执行，设置检查点进行审查

**选择哪种方式？**
