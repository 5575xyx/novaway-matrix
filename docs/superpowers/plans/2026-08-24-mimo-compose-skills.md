# Phase 4: Compose 工作流 + 技能系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 MiMo-Code 的 Compose 工作流编排和技能组合能力，使 NovaWay 支持多步骤工作流定义、执行、技能链和参数化技能。

**Architecture:** 
- **Workflow 引擎**: 新增 WorkflowService，支持步骤定义、条件分支、并行执行、状态管理
- **技能组合**: 扩展 SkillService，支持技能依赖、技能链、参数化技能
- **编排器**: 新增 OrchestratorService，支持多代理协作、任务分发、结果聚合
- **UI 面板**: TUI 工作流面板和技能组合面板

**Tech Stack:** Effect v4, Drizzle ORM, SQLite, InstanceState, Bus.Service

---

## Task 1: 创建 Workflow 数据库表

**Files:**
- Create: `packages/NovaWay/src/workflow/workflow.sql.ts`
- Modify: `packages/NovaWay/src/session/session.sql.ts` (导出新模块)

- [ ] **Step 1: 创建 Workflow Schema 定义**

```typescript
// packages/NovaWay/src/workflow/workflow.sql.ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export interface WorkflowStep {
  readonly id: string
  readonly name: string
  readonly type: "agent" | "tool" | "skill" | "condition" | "parallel"
  readonly config: Record<string, any>
  readonly next?: string
  readonly nextTrue?: string
  readonly nextFalse?: string
  readonly steps?: string[]
}

export interface WorkflowState {
  readonly currentStep: string
  readonly completedSteps: string[]
  readonly outputs: Record<string, any>
  readonly startedAt: Date
  readonly completedAt?: Date
}

export const WorkflowTable = sqliteTable("workflow", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text(),
  steps: text({ mode: "json" }).$type<WorkflowStep[]>().notNull(),
  status: text("status").notNull().default("draft"),  // draft, running, paused, completed, failed
  state: text({ mode: "json" }).$type<WorkflowState>(),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const WorkflowRunTable = sqliteTable("workflow_run", {
  id: text().primaryKey(),
  workflow_id: text("workflow_id")
    .notNull()
    .references(() => WorkflowTable.id, { onDelete: "cascade" }),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),  // pending, running, completed, failed
  state: text({ mode: "json" }).$type<WorkflowState>(),
  error: text(),
  started_at: integer("started_at", { mode: "timestamp_ms" }),
  completed_at: integer("completed_at", { mode: "timestamp_ms" }),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})
```

- [ ] **Step 2: 运行数据库迁移**

```bash
cd packages/NovaWay && bun run db generate --name workflow
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/workflow/workflow.sql.ts packages/NovaWay/src/session/session.sql.ts
git commit -m "feat(workflow): add workflow schema for compose workflows"
```

---

## Task 2: 实现 Workflow.Service

**Files:**
- Create: `packages/NovaWay/src/workflow/workflow.ts`

- [ ] **Step 1: 创建 Workflow.Service 定义**

```typescript
// packages/NovaWay/src/workflow/workflow.ts
import { Context, Effect, Layer } from "effect"
import { eq, and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { WorkflowTable, WorkflowRunTable, type WorkflowStep, type WorkflowState } from "./workflow.sql"

export interface Workflow {
  readonly id: string
  readonly sessionId: string
  readonly name: string
  readonly description: string | null
  readonly steps: WorkflowStep[]
  readonly status: "draft" | "running" | "paused" | "completed" | "failed"
  readonly state: WorkflowState | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface WorkflowRun {
  readonly id: string
  readonly workflowId: string
  readonly sessionId: string
  readonly status: "pending" | "running" | "completed" | "failed"
  readonly state: WorkflowState | null
  readonly error: string | null
  readonly startedAt: Date | null
  readonly completedAt: Date | null
  readonly createdAt: Date
}

export interface Interface {
  readonly create: (input: {
    sessionId: string
    name: string
    description?: string
    steps: WorkflowStep[]
  }) => Effect.Effect<Workflow>

  readonly list: (sessionId: string) => Effect.Effect<readonly Workflow[]>

  readonly get: (workflowId: string) => Effect.Effect<Workflow | null>

  readonly update: (input: {
    workflowId: string
    name?: string
    description?: string
    steps?: WorkflowStep[]
    status?: Workflow["status"]
  }) => Effect.Effect<Workflow>

  readonly delete: (workflowId: string) => Effect.Effect<void>

  readonly startRun: (workflowId: string) => Effect.Effect<WorkflowRun>

  readonly getRun: (runId: string) => Effect.Effect<WorkflowRun | null>

  readonly listRuns: (workflowId: string) => Effect.Effect<readonly WorkflowRun[]>

  readonly updateRunState: (input: {
    runId: string
    state: WorkflowState
    status?: WorkflowRun["status"]
    error?: string
  }) => Effect.Effect<WorkflowRun>
}

export class Service extends Context.Service<Interface>()("@NovaWay/WorkflowService") {}

const generateId = () => `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* Database

    const toWorkflow = (row: any): Workflow => ({
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      description: row.description,
      steps: row.steps as WorkflowStep[],
      status: row.status as Workflow["status"],
      state: row.state as WorkflowState | null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })

    const toRun = (row: any): WorkflowRun => ({
      id: row.id,
      workflowId: row.workflow_id,
      sessionId: row.session_id,
      status: row.status as WorkflowRun["status"],
      state: row.state as WorkflowState | null,
      error: row.error,
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
    })

    return {
      create: Effect.fn("WorkflowService.create")(function* (input) {
        const now = new Date()
        const workflow: Workflow = {
          id: generateId(),
          sessionId: input.sessionId,
          name: input.name,
          description: input.description ?? null,
          steps: input.steps,
          status: "draft",
          state: null,
          createdAt: now,
          updatedAt: now,
        }

        yield* db.insert(WorkflowTable).values({
          id: workflow.id,
          session_id: workflow.sessionId,
          name: workflow.name,
          description: workflow.description,
          steps: workflow.steps,
          status: workflow.status,
          state: workflow.state,
          created_at: workflow.createdAt.getTime(),
          updated_at: workflow.updatedAt.getTime(),
        })

        return workflow
      }),

      list: Effect.fn("WorkflowService.list")(function* (sessionId) {
        const rows = yield* db
          .select()
          .from(WorkflowTable)
          .where(eq(WorkflowTable.session_id, sessionId))
          .orderBy(WorkflowTable.created_at)

        return rows.map(toWorkflow)
      }),

      get: Effect.fn("WorkflowService.get")(function* (workflowId) {
        const row = yield* db
          .select()
          .from(WorkflowTable)
          .where(eq(WorkflowTable.id, workflowId))
          .limit(1)

        if (row.length === 0) return null
        return toWorkflow(row[0])
      }),

      update: Effect.fn("WorkflowService.update")(function* (input) {
        const now = new Date()
        yield* db
          .update(WorkflowTable)
          .set({
            ...(input.name && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            ...(input.steps && { steps: input.steps }),
            ...(input.status && { status: input.status }),
            updated_at: now.getTime(),
          })
          .where(eq(WorkflowTable.id, input.workflowId))

        const updated = yield* db
          .select()
          .from(WorkflowTable)
          .where(eq(WorkflowTable.id, input.workflowId))
          .limit(1)

        return toWorkflow(updated[0])
      }),

      delete: Effect.fn("WorkflowService.delete")(function* (workflowId) {
        yield* db.delete(WorkflowTable).where(eq(WorkflowTable.id, workflowId))
      }),

      startRun: Effect.fn("WorkflowService.startRun")(function* (workflowId) {
        const workflow = yield* this.get(workflowId)
        if (!workflow) return yield* Effect.fail(new Error("Workflow not found"))

        const now = new Date()
        const firstStep = workflow.steps[0]
        const initialState: WorkflowState = {
          currentStep: firstStep?.id ?? "",
          completedSteps: [],
          outputs: {},
          startedAt: now,
        }

        const run: WorkflowRun = {
          id: generateId(),
          workflowId,
          sessionId: workflow.sessionId,
          status: "running",
          state: initialState,
          error: null,
          startedAt: now,
          completedAt: null,
          createdAt: now,
        }

        yield* db.insert(WorkflowRunTable).values({
          id: run.id,
          workflow_id: run.workflowId,
          session_id: run.sessionId,
          status: run.status,
          state: run.state,
          error: run.error,
          started_at: run.startedAt?.getTime() ?? null,
          completed_at: run.completedAt?.getTime() ?? null,
          created_at: run.createdAt.getTime(),
        })

        return run
      }),

      getRun: Effect.fn("WorkflowService.getRun")(function* (runId) {
        const row = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(eq(WorkflowRunTable.id, runId))
          .limit(1)

        if (row.length === 0) return null
        return toRun(row[0])
      }),

      listRuns: Effect.fn("WorkflowService.listRuns")(function* (workflowId) {
        const rows = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(eq(WorkflowRunTable.workflow_id, workflowId))
          .orderBy(WorkflowRunTable.created_at)

        return rows.map(toRun)
      }),

      updateRunState: Effect.fn("WorkflowService.updateRunState")(function* (input) {
        yield* db
          .update(WorkflowRunTable)
          .set({
            state: input.state,
            ...(input.status && { status: input.status }),
            ...(input.error !== undefined && { error: input.error }),
            ...(input.status === "completed" && { completed_at: Date.now() }),
          })
          .where(eq(WorkflowRunTable.id, input.runId))

        const updated = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(eq(WorkflowRunTable.id, input.runId))
          .limit(1)

        return toRun(updated[0])
      }),
    }
  }),
)

export const defaultLayer = layer
```

- [ ] **Step 2: 提交**

```bash
git add packages/NovaWay/src/workflow/workflow.ts
git commit -m "feat(workflow): implement WorkflowService for compose workflows"
```

---

## Task 3: 创建 Workflow 工具

**Files:**
- Create: `packages/NovaWay/src/tool/workflow.ts`
- Modify: `packages/NovaWay/src/tool/registry.ts` (注册工具)

- [ ] **Step 1: 创建 WorkflowTool 定义**

```typescript
// packages/NovaWay/src/tool/workflow.ts
import { Tool } from "./tool"
import { WorkflowService } from "@/workflow/workflow"
import { SessionID } from "@/session/schema"

export const WorkflowTool = Tool.define({
  name: "workflow",
  description: "管理工作流（Workflow）- 创建、执行、监控多步骤工作流",
  parameters: {
    action: Tool.Parameter.enum("create", "list", "get", "start", "status", "pause", "resume"),
    workflowId: Tool.Parameter.optional(Tool.Parameter.string("工作流ID")),
    name: Tool.Parameter.optional(Tool.Parameter.string("工作流名称")),
    description: Tool.Parameter.optional(Tool.Parameter.string("工作流描述")),
    steps: Tool.Parameter.optional(Tool.Parameter.string("工作流步骤 JSON")),
  },
  execute: async (params, ctx) => {
    const workflowService = ctx.context.get(WorkflowService)
    const sessionId = SessionID.make(ctx.sessionID)

    switch (params.action) {
      case "create":
        const steps = params.steps ? JSON.parse(params.steps) : []
        const created = yield* workflowService.create({
          sessionId,
          name: params.name!,
          description: params.description,
          steps,
        })
        return `工作流已创建: ${created.id} - ${created.name}`

      case "list":
        const workflows = yield* workflowService.list(sessionId)
        if (workflows.length === 0) return "暂无工作流"
        return workflows.map((w) => `${w.id}: ${w.name} [${w.status}]`).join("\n")

      case "get":
        const workflow = yield* workflowService.get(params.workflowId!)
        if (!workflow) return "工作流不存在"
        return `ID: ${workflow.id}\n名称: ${workflow.name}\n状态: ${workflow.status}\n步骤数: ${workflow.steps.length}`

      case "start":
        const run = yield* workflowService.startRun(params.workflowId!)
        return `工作流已启动: ${run.id}`

      case "status":
        const runs = yield* workflowService.listRuns(params.workflowId!)
        if (runs.length === 0) return "暂无运行记录"
        const latest = runs[runs.length - 1]
        return `最新运行: ${latest.id} [${latest.status}]`

      case "pause":
        yield* workflowService.update({ workflowId: params.workflowId!, status: "paused" })
        return "工作流已暂停"

      case "resume":
        yield* workflowService.update({ workflowId: params.workflowId!, status: "running" })
        return "工作流已恢复"

      default:
        return "未知操作"
    }
  },
})
```

- [ ] **Step 2: 注册工具**

```typescript
// packages/NovaWay/src/tool/registry.ts 添加
import { WorkflowTool } from "./workflow"

// 在工具列表中添加
export const defaultTools = [
  // ... 现有工具
  WorkflowTool,
]
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/tool/workflow.ts packages/NovaWay/src/tool/registry.ts
git commit -m "feat(tool): add WorkflowTool for compose workflow management"
```

---

## Task 4: 创建 Workflow UI 组件

**Files:**
- Create: `packages/tui/src/component/workflow-panel.tsx`
- Modify: `packages/tui/src/routes/session/sidebar.tsx` (添加工作流标签页)

- [ ] **Step 1: 创建 WorkflowPanel 组件**

```tsx
// packages/tui/src/component/workflow-panel.tsx
import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"

interface Workflow {
  id: string
  name: string
  description: string | null
  status: "draft" | "running" | "paused" | "completed" | "failed"
  steps: Array<{ id: string; name: string; type: string }>
  createdAt: Date
}

export interface WorkflowPanelProps {
  sessionID: string
}

export function WorkflowPanel(props: WorkflowPanelProps) {
  const sdk = useSDK()
  const { theme } = useTheme()

  const [workflows, setWorkflows] = createSignal<Workflow[]>([])
  const [loading, setLoading] = createSignal(true)

  async function loadData() {
    setLoading(true)
    try {
      const result = await (sdk.client as any).get(`/session/${props.sessionID}/workflows`)
      setWorkflows(result.data ?? [])
    } catch {
      // 静默失败
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    await loadData()
  }

  async function createWorkflow() {
    try {
      await (sdk.client as any).post(`/session/${props.sessionID}/workflows`, {
        name: "新工作流",
        steps: [],
      })
      await refresh()
    } catch {
      // 静默失败
    }
  }

  async function startWorkflow(workflowId: string) {
    try {
      await (sdk.client as any).post(`/workflows/${workflowId}/start`)
      await refresh()
    } catch {
      // 静默失败
    }
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: "草稿",
      running: "运行中",
      paused: "已暂停",
      completed: "已完成",
      failed: "失败",
    }
    return labels[status] ?? status
  }

  function statusColor(status: string): string {
    const colors: Record<string, string> = {
      draft: theme.textMuted,
      running: theme.primary,
      paused: theme.warning,
      completed: theme.success,
      failed: theme.error,
    }
    return colors[status] ?? theme.text
  }

  onMount(loadData)

  return (
    <box flexDirection="column" gap={1}>
      {/* 标题 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>🔄 工作流</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={refresh}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      {/* 创建按钮 */}
      <text fg={theme.primary} onMouseUp={createWorkflow}>
        [创建工作流]
      </text>

      {/* 列表 */}
      <Show
        when={workflows().length > 0}
        fallback={<text fg={theme.textMuted}>{loading() ? "加载中..." : "暂无工作流"}</text>}
      >
        <For each={workflows()}>
          {(workflow) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text} wrapMode="none">
                <span style={{ fg: theme.accent }}>●</span> {workflow.name}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={statusColor(workflow.status)}>
                  {statusLabel(workflow.status)}
                </text>
                <text fg={theme.textMuted}>
                  · {workflow.steps.length} 步骤
                </text>
              </box>
              <Show when={workflow.description}>
                <text fg={theme.textMuted}>{workflow.description}</text>
              </Show>
              {/* 操作按钮 */}
              <box flexDirection="row" gap={1}>
                <Show when={workflow.status === "draft"}>
                  <text fg={theme.success} onMouseUp={() => startWorkflow(workflow.id)}>
                    [启动]
                  </text>
                </Show>
                <Show when={workflow.status === "running"}>
                  <text fg={theme.warning} onMouseUp={() => pauseWorkflow(workflow.id)}>
                    [暂停]
                  </text>
                </Show>
                <Show when={workflow.status === "paused"}>
                  <text fg={theme.success} onMouseUp={() => resumeWorkflow(workflow.id)}>
                    [恢复]
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

- [ ] **Step 2: 更新侧边栏添加工作流标签页**

```typescript
// packages/tui/src/routes/session/sidebar.tsx 修改
import { WorkflowPanel } from "../../component/workflow-panel"

// 在 SidebarTab 类型中添加
type SidebarTab = "files" | "info" | "memory" | "evolution" | "checkpoint" | "goal" | "workflow"

// 在标签页切换中添加
<text
  fg={activeTab() === "workflow" ? theme.primary : theme.textMuted}
  onMouseUp={() => setActiveTab("workflow")}
>
  🔄 工作流
</text>

// 在面板显示中添加
<Show when={activeTab() === "workflow"}>
  <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration()}>
    <box flexShrink={0} gap={1} paddingRight={1}>
      <WorkflowPanel sessionID={props.sessionID} />
    </box>
  </scrollbox>
</Show>
```

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/component/workflow-panel.tsx packages/tui/src/routes/session/sidebar.tsx
git commit -m "feat(tui): add workflow panel for compose workflows"
```

---

## Task 5: 注册 Workflow API 路由

**Files:**
- Create: `packages/NovaWay/src/server/routes/instance/httpapi/groups/workflow.ts`
- Create: `packages/NovaWay/src/server/routes/instance/httpapi/handlers/workflow.ts`
- Modify: `packages/NovaWay/src/server/routes/instance/httpapi/api.ts` (注册路由)
- Modify: `packages/NovaWay/src/server/routes/instance/httpapi/server.ts` (注册处理器)

- [ ] **Step 1: 创建 Workflow API 组**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/groups/workflow.ts
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { described } from "./metadata"

const root = "/session/:sessionId/workflows"

export const WorkflowApi = HttpApiGroup.make("workflow")
  .add(
    HttpApiEndpoint.get("listWorkflows", root)
      .annotate(described, { summary: "获取会话工作流列表" }),
  )
  .add(
    HttpApiEndpoint.post("createWorkflow", root)
      .annotate(described, { summary: "创建工作流" })
      .payload(
        Schema.Struct({
          name: Schema.String,
          description: Schema.optional(Schema.String),
          steps: Schema.Array(Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            type: Schema.Literals(["agent", "tool", "skill", "condition", "parallel"]),
            config: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
            next: Schema.optional(Schema.String),
            nextTrue: Schema.optional(Schema.String),
            nextFalse: Schema.optional(Schema.String),
            steps: Schema.optional(Schema.Array(Schema.String)),
          })),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "获取工作流详情" }),
  )
  .add(
    HttpApiEndpoint.patch("updateWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "更新工作流" })
      .payload(
        Schema.Struct({
          name: Schema.optional(Schema.String),
          description: Schema.optional(Schema.String),
          steps: Schema.optional(Schema.Array(Schema.Unknown)),
          status: Schema.optional(Schema.Literals(["draft", "running", "paused", "completed", "failed"])),
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("deleteWorkflow", "/workflows/:workflowId")
      .annotate(described, { summary: "删除工作流" }),
  )
  .add(
    HttpApiEndpoint.post("startWorkflow", "/workflows/:workflowId/start")
      .annotate(described, { summary: "启动工作流" }),
  )
  .add(
    HttpApiEndpoint.get("listWorkflowRuns", "/workflows/:workflowId/runs")
      .annotate(described, { summary: "获取工作流运行记录" }),
  )
```

- [ ] **Step 2: 创建 Workflow 处理器**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/handlers/workflow.ts
import { WorkflowService } from "@/workflow/workflow"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const workflowHandlers = HttpApiBuilder.group(InstanceHttpApi, "workflow", (handlers) =>
  Effect.gen(function* () {
    const workflow = yield* WorkflowService

    return handlers
      .handle("listWorkflows", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.path.sessionId)
          const workflows = yield* workflow.list(sessionId)
          return workflows.map((w) => ({
            id: w.id,
            sessionId: w.sessionId,
            name: w.name,
            description: w.description ?? undefined,
            steps: w.steps,
            status: w.status,
            state: w.state,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          }))
        }),
      )
      .handle("createWorkflow", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.path.sessionId)
          const created = yield* workflow.create({
            sessionId,
            name: ctx.payload.name,
            description: ctx.payload.description,
            steps: ctx.payload.steps as any,
          })
          return {
            id: created.id,
            sessionId: created.sessionId,
            name: created.name,
            description: created.description ?? undefined,
            steps: created.steps,
            status: created.status,
            state: created.state,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }
        }),
      )
      .handle("getWorkflow", (ctx) =>
        Effect.gen(function* () {
          const w = yield* workflow.get(ctx.path.workflowId)
          if (!w) {
            return yield* Effect.fail(new HttpApiError.NotFound({}))
          }
          return {
            id: w.id,
            sessionId: w.sessionId,
            name: w.name,
            description: w.description ?? undefined,
            steps: w.steps,
            status: w.status,
            state: w.state,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          }
        }),
      )
      .handle("updateWorkflow", (ctx) =>
        Effect.gen(function* () {
          const updated = yield* workflow.update({
            workflowId: ctx.path.workflowId,
            ...ctx.payload,
          })
          return {
            id: updated.id,
            sessionId: updated.sessionId,
            name: updated.name,
            description: updated.description ?? undefined,
            steps: updated.steps,
            status: updated.status,
            state: updated.state,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          }
        }),
      )
      .handle("deleteWorkflow", (ctx) =>
        Effect.gen(function* () {
          yield* workflow.delete(ctx.path.workflowId)
          return { success: true }
        }),
      )
      .handle("startWorkflow", (ctx) =>
        Effect.gen(function* () {
          const run = yield* workflow.startRun(ctx.path.workflowId)
          return {
            id: run.id,
            workflowId: run.workflowId,
            sessionId: run.sessionId,
            status: run.status,
            state: run.state,
            error: run.error ?? undefined,
            startedAt: run.startedAt?.toISOString(),
            completedAt: run.completedAt?.toISOString(),
            createdAt: run.createdAt.toISOString(),
          }
        }),
      )
      .handle("listWorkflowRuns", (ctx) =>
        Effect.gen(function* () {
          const runs = yield* workflow.listRuns(ctx.path.workflowId)
          return runs.map((r) => ({
            id: r.id,
            workflowId: r.workflowId,
            sessionId: r.sessionId,
            status: r.status,
            state: r.state,
            error: r.error ?? undefined,
            startedAt: r.startedAt?.toISOString(),
            completedAt: r.completedAt?.toISOString(),
            createdAt: r.createdAt.toISOString(),
          }))
        }),
      )
  }),
)
```

- [ ] **Step 3: 注册路由和处理器**

```typescript
// packages/NovaWay/src/server/routes/instance/httpapi/api.ts 添加
import { WorkflowApi } from "./groups/workflow"

// 在 InstanceHttpApi 中添加
.addHttpApi(WorkflowApi)

// packages/NovaWay/src/server/routes/instance/httpapi/server.ts 添加
import { workflowHandlers } from "./handlers/workflow"

// 在 instanceApiRoutes 中添加
workflowHandlers,
```

- [ ] **Step 4: 提交**

```bash
git add packages/NovaWay/src/server/routes/instance/httpapi/groups/workflow.ts packages/NovaWay/src/server/routes/instance/httpapi/handlers/workflow.ts packages/NovaWay/src/server/routes/instance/httpapi/api.ts packages/NovaWay/src/server/routes/instance/httpapi/server.ts
git commit -m "feat(server): add workflow API routes for compose workflows"
```

---

## Task 6: 创建技能组合能力

**Files:**
- Modify: `packages/NovaWay/src/skill/index.ts` (添加技能组合支持)

- [ ] **Step 1: 在 SkillService 中添加组合功能**

```typescript
// packages/NovaWay/src/skill/index.ts 修改
// 添加技能组合相关接口

export interface SkillComposition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly skills: string[]  // 技能ID列表
  readonly config: Record<string, any>
  readonly createdAt: Date
}

export interface Interface {
  // ... 现有接口

  // 新增：技能组合
  readonly createComposition: (input: {
    name: string
    description: string
    skills: string[]
    config?: Record<string, any>
  }) => Effect.Effect<SkillComposition>

  readonly listCompositions: () => Effect.Effect<readonly SkillComposition[]>

  readonly getComposition: (compositionId: string) => Effect.Effect<SkillComposition | null>

  readonly executeComposition: (compositionId: string, context: Record<string, any>) => Effect.Effect<void>
}
```

- [ ] **Step 2: 实现技能组合功能**

```typescript
// 在 layer 实现中添加
createComposition: Effect.fn("SkillService.createComposition")(function* (input) {
  const composition: SkillComposition = {
    id: generateId(),
    name: input.name,
    description: input.description,
    skills: input.skills,
    config: input.config ?? {},
    createdAt: new Date(),
  }

  // 存储到配置文件
  const configPath = path.join(process.cwd(), ".novaway", "compositions.json")
  const compositions = yield* Effect.tryPromise(() => fs.readFile(configPath, "utf-8"))
    .pipe(Effect.catchAll(() => Effect.succeed("[]")))
    .then(JSON.parse)

  compositions.push(composition)
  yield* Effect.tryPromise(() => fs.writeFile(configPath, JSON.stringify(compositions, null, 2)))

  return composition
}),

executeComposition: Effect.fn("SkillService.executeComposition")(function* (compositionId, context) {
  const composition = yield* this.getComposition(compositionId)
  if (!composition) return yield* Effect.fail(new Error("Composition not found"))

  // 按顺序执行技能
  for (const skillId of composition.skills) {
    const skill = yield* this.load(skillId)
    if (skill) {
      // 执行技能并传递上下文
      yield* Effect.log(`执行技能: ${skillId}`)
    }
  }
}),
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/skill/index.ts
git commit -m "feat(skill): add skill composition support"
```

---

## Task 7: 创建 Orchestrator 服务

**Files:**
- Create: `packages/NovaWay/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: 创建 Orchestrator.Service 定义**

```typescript
// packages/NovaWay/src/orchestrator/orchestrator.ts
import { Context, Effect, Layer } from "effect"
import { TaskService } from "@/tool/task"
import { WorkflowService } from "@/workflow/workflow"

export interface OrchestratorTask {
  readonly id: string
  readonly name: string
  readonly type: "agent" | "tool" | "skill"
  readonly config: Record<string, any>
  readonly dependencies: string[]
  readonly status: "pending" | "running" | "completed" | "failed"
  readonly result?: any
  readonly error?: string
}

export interface OrchestratorPlan {
  readonly id: string
  readonly name: string
  readonly tasks: OrchestratorTask[]
  readonly status: "draft" | "running" | "completed" | "failed"
  readonly createdAt: Date
}

export interface Interface {
  readonly createPlan: (input: {
    name: string
    tasks: Omit<OrchestratorTask, "id" | "status">[]
  }) => Effect.Effect<OrchestratorPlan>

  readonly executePlan: (planId: string) => Effect.Effect<void>

  readonly getPlan: (planId: string) => Effect.Effect<OrchestratorPlan | null>

  readonly listPlans: () => Effect.Effect<readonly OrchestratorPlan[]>

  readonly addTask: (input: {
    planId: string
    task: Omit<OrchestratorTask, "id" | "status">
  }) => Effect.Effect<OrchestratorTask>

  readonly updateTaskStatus: (input: {
    planId: string
    taskId: string
    status: OrchestratorTask["status"]
    result?: any
    error?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Interface>()("@NovaWay/OrchestratorService") {}

const generateId = () => `orch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const taskService = yield* TaskService
    const workflowService = yield* WorkflowService

    // 内存存储（生产环境应使用数据库）
    const plans = new Map<string, OrchestratorPlan>()

    return {
      createPlan: Effect.fn("OrchestratorService.createPlan")(function* (input) {
        const plan: OrchestratorPlan = {
          id: generateId(),
          name: input.name,
          tasks: input.tasks.map((t, i) => ({
            ...t,
            id: `task_${i}`,
            status: "pending" as const,
          })),
          status: "draft",
          createdAt: new Date(),
        }

        plans.set(plan.id, plan)
        return plan
      }),

      executePlan: Effect.fn("OrchestratorService.executePlan")(function* (planId) {
        const plan = plans.get(planId)
        if (!plan) return yield* Effect.fail(new Error("Plan not found"))

        // 更新状态为运行中
        plans.set(planId, { ...plan, status: "running" })

        // 执行任务（简化版：按顺序执行）
        for (const task of plan.tasks) {
          // 检查依赖是否完成
          const depsCompleted = task.dependencies.every(
            (dep) => plan.tasks.find((t) => t.id === dep)?.status === "completed"
          )

          if (!depsCompleted) {
            plans.set(planId, { ...plan, status: "failed" })
            return yield* Effect.fail(new Error(`Dependencies not met for task ${task.id}`))
          }

          // 执行任务
          try {
            yield* Effect.log(`执行任务: ${task.name}`)
            // 这里应该调用 taskService 或其他服务执行实际任务
            const updatedTasks = plan.tasks.map((t) =>
              t.id === task.id ? { ...t, status: "completed" as const } : t
            )
            plans.set(planId, { ...plan, tasks: updatedTasks })
          } catch (error) {
            const updatedTasks = plan.tasks.map((t) =>
              t.id === task.id ? { ...t, status: "failed" as const, error: String(error) } : t
            )
            plans.set(planId, { ...plan, tasks: updatedTasks, status: "failed" })
            return yield* Effect.fail(new Error(`Task ${task.id} failed: ${error}`))
          }
        }

        // 所有任务完成
        plans.set(planId, { ...plan, status: "completed" })
      }),

      getPlan: Effect.fn("OrchestratorService.getPlan")(function* (planId) {
        return plans.get(planId) ?? null
      }),

      listPlans: Effect.fn("OrchestratorService.listPlans")(function* () {
        return Array.from(plans.values())
      }),

      addTask: Effect.fn("OrchestratorService.addTask")(function* (input) {
        const plan = plans.get(input.planId)
        if (!plan) return yield* Effect.fail(new Error("Plan not found"))

        const task: OrchestratorTask = {
          ...input.task,
          id: `task_${plan.tasks.length}`,
          status: "pending",
        }

        const updatedPlan = { ...plan, tasks: [...plan.tasks, task] }
        plans.set(input.planId, updatedPlan)

        return task
      }),

      updateTaskStatus: Effect.fn("OrchestratorService.updateTaskStatus")(function* (input) {
        const plan = plans.get(input.planId)
        if (!plan) return yield* Effect.fail(new Error("Plan not found"))

        const updatedTasks = plan.tasks.map((t) =>
          t.id === input.taskId
            ? { ...t, status: input.status, result: input.result, error: input.error }
            : t
        )

        plans.set(input.planId, { ...plan, tasks: updatedTasks })
      }),
    }
  }),
)

export const defaultLayer = layer
```

- [ ] **Step 2: 提交**

```bash
git add packages/NovaWay/src/orchestrator/orchestrator.ts
git commit -m "feat(orchestrator): implement OrchestratorService for multi-agent coordination"
```

---

## Task 8: 测试验证

**Files:**
- Create: `packages/NovaWay/test/workflow/workflow.test.ts`

- [ ] **Step 1: 编写 Workflow 测试**

```typescript
// packages/NovaWay/test/workflow/workflow.test.ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { WorkflowService } from "../../src/workflow/workflow"
import { layer } from "../../src/workflow/workflow"

describe("WorkflowService", () => {
  it.effect("creates and retrieves workflow", () =>
    Effect.gen(function* () {
      const service = yield* WorkflowService
      const workflow = yield* service.create({
        sessionId: "test-session",
        name: "Test Workflow",
        description: "Testing",
        steps: [
          { id: "step1", name: "Step 1", type: "agent", config: {} },
          { id: "step2", name: "Step 2", type: "tool", config: {} },
        ],
      })

      expect(workflow.name).toBe("Test Workflow")
      expect(workflow.steps.length).toBe(2)

      const retrieved = yield* service.get(workflow.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe("Test Workflow")
    }).pipe(Effect.provide(layer))
  )

  it.effect("starts workflow run", () =>
    Effect.gen(function* () {
      const service = yield* WorkflowService
      const workflow = yield* service.create({
        sessionId: "test-session",
        name: "Run Test",
        steps: [{ id: "step1", name: "Step 1", type: "agent", config: {} }],
      })

      const run = yield* service.startRun(workflow.id)
      expect(run.status).toBe("running")
      expect(run.state?.currentStep).toBe("step1")
    }).pipe(Effect.provide(layer))
  )

  it.effect("lists workflows by session", () =>
    Effect.gen(function* () {
      const service = yield* WorkflowService
      yield* service.create({ sessionId: "session-1", name: "WF 1", steps: [] })
      yield* service.create({ sessionId: "session-2", name: "WF 2", steps: [] })

      const list = yield* service.list("session-1")
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("WF 1")
    }).pipe(Effect.provide(layer))
  )
})
```

- [ ] **Step 2: 运行测试**

```bash
cd packages/NovaWay && bun test test/workflow/workflow.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/test/workflow/workflow.test.ts
git commit -m "test(workflow): add workflow service tests"
```

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-08-24-mimo-compose-skills.md`**

**两种执行方式：**

1. **子代理驱动（推荐）** - 每个任务派发一个新子代理，任务间进行审查，快速迭代

2. **内联执行** - 在当前会话中使用 executing-plans 批量执行，设置检查点进行审查

**选择哪种方式？**
