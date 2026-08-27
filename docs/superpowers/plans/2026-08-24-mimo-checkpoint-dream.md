# MiMo-Code 检查点 + Dream/Distill 自我改进实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现会话级检查点保存/恢复系统，以及后台 Dream/Distill 自我改进机制，使 NovaWay 具备 MiMo-Code 的状态持久化和自我学习能力。

**Architecture:** 
- **Checkpoint 系统**: 在 SQLite 中添加 `session_checkpoint` 表，扩展 Session.Service 支持保存/恢复完整会话状态（消息、工具结果、上下文）
- **Dream 系统**: 新增 Dream.Service，后台 fiber 分析历史会话，提取成功/失败模式，生成改进建议
- **Distill 系统**: 扩展 Memory 系统，从 Dream 分析中提取可复用的模式知识

**Tech Stack:** Effect v4, Drizzle ORM, SQLite, InstanceState, Bus.Service

---

## Task 1: 添加 Checkpoint 数据库表

**Files:**
- Create: `packages/NovaWay/src/session/schema/checkpoint.ts`
- Modify: `packages/NovaWay/src/session/schema.ts` (导出新模块)

- [ ] **Step 1: 创建 Checkpoint Schema 定义**

```typescript
// packages/NovaWay/src/session/schema/checkpoint.ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { json } from "drizzle-orm/sqlite-core"

export interface CheckpointData {
  messages: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCallId?: string
    toolName?: string
  }>
  context: Record<string, unknown>
  metadata: {
    reason?: string
    tags?: string[]
    createdAt: string
  }
}

export const sessionCheckpoint = sqliteTable("session_checkpoint", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => session.id, { onDelete: "cascade" }),
  name: text().notNull(),
  reason: text(),
  tags: json("tags").$type<string[]>().default([]),
  data: json("data").$type<CheckpointData>().notNull(),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})
```

- [ ] **Step 2: 运行数据库迁移**

```bash
cd packages/NovaWay && bun run db:generate
```

- [ ] **Step 3: 更新 Schema 导出**

```typescript
// packages/NovaWay/src/session/schema.ts 添加
export * as SessionCheckpoint from "./schema/checkpoint"
```

- [ ] **Step 4: 提交**

```bash
git add packages/NovaWay/src/session/schema/checkpoint.ts packages/NovaWay/src/session/schema.ts
git commit -m "feat(session): add checkpoint schema for session state persistence"
```

---

## Task 2: 实现 Checkpoint.Service

**Files:**
- Create: `packages/NovaWay/src/session/checkpoint.ts`
- Modify: `packages/NovaWay/src/session/index.ts` (导出新模块)

- [ ] **Step 1: 创建 Checkpoint.Service 定义**

```typescript
// packages/NovaWay/src/session/checkpoint.ts
import { Context, Effect, Layer } from "effect"
import { SessionCheckpoint } from "./schema/checkpoint"
import { db } from "../db"
import { eq, and } from "drizzle-orm"
import { InstanceState } from "../effect/instance-state"

export interface Checkpoint {
  readonly id: string
  readonly sessionId: string
  readonly name: string
  readonly reason: string | null
  readonly tags: string[]
  readonly data: CheckpointData
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CheckpointData {
  messages: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCallId?: string
    toolName?: string
  }>
  context: Record<string, unknown>
  metadata: {
    reason?: string
    tags?: string[]
    createdAt: string
  }
}

export interface CheckpointService {
  readonly create: (input: {
    sessionId: string
    name: string
    reason?: string
    tags?: string[]
    messages: CheckpointData["messages"]
    context?: Record<string, unknown>
  }) => Effect.Effect<Checkpoint>

  readonly list: (sessionId: string) => Effect.Effect<readonly Checkpoint[]>

  readonly get: (checkpointId: string) => Effect.Effect<Checkpoint | null>

  readonly restore: (checkpointId: string) => Effect.Effect<CheckpointData>

  readonly delete: (checkpointId: string) => Effect.Effect<void>

  readonly autoCheckpoint: (sessionId: string) => Effect.Effect<Checkpoint | null>
}

export class CheckpointService extends Context.Service<CheckpointService>()("@NovaWay/CheckpointService") {}

export const layer = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    const state = yield* InstanceState.make(
      Effect.fn("CheckpointService.state")(function* (ctx) {
        yield* Effect.void
        return { lastAutoCheckpoint: new Map<string, number>() }
      })
    )

    const generateId = () => `cp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

    return CheckpointService.of({
      create: Effect.fn("CheckpointService.create")(function* (input) {
        const now = new Date()
        const checkpoint: Checkpoint = {
          id: generateId(),
          sessionId: input.sessionId,
          name: input.name,
          reason: input.reason ?? null,
          tags: input.tags ?? [],
          data: {
            messages: input.messages,
            context: input.context ?? {},
            metadata: {
              reason: input.reason,
              tags: input.tags,
              createdAt: now.toISOString(),
            },
          },
          createdAt: now,
          updatedAt: now,
        }

        yield* db.insert(SessionCheckpoint).values({
          id: checkpoint.id,
          session_id: checkpoint.sessionId,
          name: checkpoint.name,
          reason: checkpoint.reason,
          tags: checkpoint.tags,
          data: checkpoint.data,
          created_at: checkpoint.createdAt.getTime(),
          updated_at: checkpoint.updatedAt.getTime(),
        })

        return checkpoint
      }),

      list: Effect.fn("CheckpointService.list")(function* (sessionId) {
        const rows = yield* db
          .select()
          .from(SessionCheckpoint)
          .where(eq(SessionCheckpoint.session_id, sessionId))
          .orderBy(SessionCheckpoint.created_at)

        return rows.map(row => ({
          id: row.id,
          sessionId: row.session_id,
          name: row.name,
          reason: row.reason,
          tags: row.tags ?? [],
          data: row.data as CheckpointData,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }))
      }),

      get: Effect.fn("CheckpointService.get")(function* (checkpointId) {
        const row = yield* db
          .select()
          .from(SessionCheckpoint)
          .where(eq(SessionCheckpoint.id, checkpointId))
          .limit(1)

        if (row.length === 0) return null

        const r = row[0]
        return {
          id: r.id,
          sessionId: r.session_id,
          name: r.name,
          reason: r.reason,
          tags: r.tags ?? [],
          data: r.data as CheckpointData,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        }
      }),

      restore: Effect.fn("CheckpointService.restore")(function* (checkpointId) {
        const checkpoint = yield* db
          .select()
          .from(SessionCheckpoint)
          .where(eq(SessionCheckpoint.id, checkpointId))
          .limit(1)

        if (checkpoint.length === 0) {
          return yield* Effect.fail(new Error(`Checkpoint ${checkpointId} not found`))
        }

        return checkpoint[0].data as CheckpointData
      }),

      delete: Effect.fn("CheckpointService.delete")(function* (checkpointId) {
        yield* db.delete(SessionCheckpoint).where(eq(SessionCheckpoint.id, checkpointId))
      }),

      autoCheckpoint: Effect.fn("CheckpointService.autoCheckpoint")(function* (sessionId) {
        const s = yield* state
        const lastCheckpoint = s.lastAutoCheckpoint.get(sessionId) ?? 0
        const now = Date.now()

        // 每 10 分钟自动创建一次检查点
        if (now - lastCheckpoint < 10 * 60 * 1000) {
          return null
        }

        s.lastAutoCheckpoint.set(sessionId, now)

        return yield* Effect.succeed(null) // 实际实现需要获取当前会话消息
      }),
    })
  })
)

export const defaultLayer = layer.pipe(Layer.provide(InstanceState.layer))
```

- [ ] **Step 2: 导出 Checkpoint 模块**

```typescript
// packages/NovaWay/src/session/index.ts 添加
export * as SessionCheckpoint from "./checkpoint"
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/session/checkpoint.ts packages/NovaWay/src/session/index.ts
git commit -m "feat(session): implement CheckpointService for session state persistence"
```

---

## Task 3: 创建 Dream 分析服务

**Files:**
- Create: `packages/NovaWay/src/session/dream.ts`
- Modify: `packages/NovaWay/src/session/index.ts` (导出新模块)

- [ ] **Step 1: 创建 Dream.Service 定义**

```typescript
// packages/NovaWay/src/session/dream.ts
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "../effect/instance-state"
import { Bus } from "../effect/bus"
import { Session } from "./session"
import { Memory } from "../memory/service"

export interface DreamAnalysis {
  readonly sessionId: string
  readonly patterns: DreamPattern[]
  readonly insights: DreamInsight[]
  readonly suggestions: DreamSuggestion[]
  readonly analyzedAt: Date
}

export interface DreamPattern {
  readonly type: "success" | "failure" | "optimization"
  readonly description: string
  readonly frequency: number
  readonly examples: string[]
}

export interface DreamInsight {
  readonly category: "code_style" | "error_handling" | "performance" | "architecture"
  readonly observation: string
  readonly confidence: number
}

export interface DreamSuggestion {
  readonly type: "memory" | "evolution" | "workflow"
  readonly title: string
  readonly description: string
  readonly priority: "high" | "medium" | "low"
}

export interface DreamService {
  readonly analyzeSession: (sessionId: string) => Effect.Effect<DreamAnalysis>

  readonly analyzeHistory: (limit?: number) => Effect.Effect<DreamAnalysis[]>

  readonly startBackgroundDream: () => Effect.Effect<void>

  readonly stopBackgroundDream: () => Effect.Effect<void>
}

export class DreamService extends Context.Service<DreamService>()("@NovaWay/DreamService") {}

export const layer = Layer.effect(
  DreamService,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const memory = yield* Memory.Service

    let backgroundFiber: any = null

    const analyzeMessages = Effect.fn("DreamService.analyzeMessages")(function* (
      messages: Array<{ role: string; content: string }>
    ) {
      // 分析消息模式
      const patterns: DreamPattern[] = []
      const insights: DreamInsight[] = []
      const suggestions: DreamSuggestion[] = []

      // 查找成功模式
      const successMessages = messages.filter(
        m => m.role === "assistant" && m.content.includes("✓") || m.content.includes("成功")
      )
      if (successMessages.length > 0) {
        patterns.push({
          type: "success",
          description: `发现 ${successMessages.length} 个成功操作`,
          frequency: successMessages.length,
          examples: successMessages.slice(0, 3).map(m => m.content.slice(0, 100)),
        })
      }

      // 查找失败模式
      const failureMessages = messages.filter(
        m => m.role === "assistant" && (m.content.includes("✗") || m.content.includes("失败") || m.content.includes("错误"))
      )
      if (failureMessages.length > 0) {
        patterns.push({
          type: "failure",
          description: `发现 ${failureMessages.length} 个失败操作`,
          frequency: failureMessages.length,
          examples: failureMessages.slice(0, 3).map(m => m.content.slice(0, 100)),
        })
      }

      // 代码风格分析
      const codeMessages = messages.filter(m => m.content.includes("```"))
      if (codeMessages.length > 5) {
        insights.push({
          category: "code_style",
          observation: "会话包含大量代码操作，建议关注代码一致性",
          confidence: 0.8,
        })
      }

      // 生成改进建议
      if (failureMessages.length > 2) {
        suggestions.push({
          type: "memory",
          title: "记录失败原因",
          description: "检测到多次失败，建议记录失败原因以便未来避免",
          priority: "high",
        })
      }

      return { patterns, insights, suggestions }
    })

    return DreamService.of({
      analyzeSession: Effect.fn("DreamService.analyzeSession")(function* (sessionId) {
        const session = yield* Session.get(sessionId)
        if (!session) {
          return yield* Effect.fail(new Error(`Session ${sessionId} not found`))
        }

        // 获取会话消息
        const messages = yield* Session.messages({ sessionId })
        const messageTexts = messages.map(m => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        }))

        const analysis = yield* analyzeMessages(messageTexts)

        return {
          sessionId,
          ...analysis,
          analyzedAt: new Date(),
        }
      }),

      analyzeHistory: Effect.fn("DreamService.analyzeHistory")(function* (limit = 10) {
        const sessions = yield* Session.list({ limit })
        const analyses: DreamAnalysis[] = []

        for (const session of sessions) {
          const analysis = yield* Effect.either(this.analyzeSession(session.id))
          if (analysis._tag === "Right") {
            analyses.push(analysis.right)
          }
        }

        return analyses
      }),

      startBackgroundDream: Effect.fn("DreamService.startBackgroundDream")(function* () {
        if (backgroundFiber) return

        backgroundFiber = yield* Effect.forkIn(Effect.forever(
          Effect.gen(function* () {
            // 每小时分析一次历史会话
            yield* Effect.sleep("1 hour")
            const analyses = yield* Effect.either(this.analyzeHistory(5))
            if (analyses._tag === "Right") {
              for (const analysis of analyses.right) {
                yield* bus.publish("dream.analysis", analysis)
              }
            }
          })
        ))
      }),

      stopBackgroundDream: Effect.fn("DreamService.stopBackgroundDream")(function* () {
        if (backgroundFiber) {
          yield* Effect.interrupt(backgroundFiber)
          backgroundFiber = null
        }
      }),
    })
  })
)

export const defaultLayer = layer.pipe(Layer.provide(InstanceState.layer))
```

- [ ] **Step 2: 导出 Dream 模块**

```typescript
// packages/NovaWay/src/session/index.ts 添加
export * as SessionDream from "./dream"
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/session/dream.ts packages/NovaWay/src/session/index.ts
git commit -m "feat(session): implement DreamService for background session analysis"
```

---

## Task 4: 创建 Distill 模式提取服务

**Files:**
- Create: `packages/NovaWay/src/session/distill.ts`
- Modify: `packages/NovaWay/src/session/index.ts` (导出新模块)

- [ ] **Step 1: 创建 Distill.Service 定义**

```typescript
// packages/NovaWay/src/session/distill.ts
import { Context, Effect, Layer } from "effect"
import { Memory } from "../memory/service"
import { DreamAnalysis, DreamPattern } from "./dream"

export interface DistillResult {
  readonly memories: DistillMemory[]
  readonly patterns: DistillPattern[]
  readonly appliedAt: Date
}

export interface DistillMemory {
  readonly content: string
  readonly domain: "global" | "project" | "session"
  readonly kind: "explicit" | "implicit" | "derived"
  readonly tags: string[]
}

export interface DistillPattern {
  readonly name: string
  readonly description: string
  readonly frequency: number
  readonly successRate: number
}

export interface DistillService {
  readonly fromAnalysis: (analysis: DreamAnalysis) => Effect.Effect<DistillResult>

  readonly extractPatterns: (analyses: DreamAnalysis[]) => Effect.Effect<DistillPattern[]>

  readonly applyMemories: (result: DistillResult) => Effect.Effect<void>
}

export class DistillService extends Context.Service<DistillService>()("@NovaWay/DistillService") {}

export const layer = Layer.effect(
  DistillService,
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    const patternMap = new Map<string, { count: number; success: number }>()

    return DistillService.of({
      fromAnalysis: Effect.fn("DistillService.fromAnalysis")(function* (analysis) {
        const memories: DistillMemory[] = []
        const patterns: DistillPattern[] = []

        // 从模式生成记忆
        for (const pattern of analysis.patterns) {
          if (pattern.type === "success" && pattern.frequency > 2) {
            memories.push({
              content: `成功模式: ${pattern.description}`,
              domain: "project",
              kind: "derived",
              tags: ["pattern", "success"],
            })
          }

          if (pattern.type === "failure" && pattern.frequency > 1) {
            memories.push({
              content: `失败模式: ${pattern.description} - 需要避免`,
              domain: "project",
              kind: "derived",
              tags: ["pattern", "failure", "warning"],
            })
          }
        }

        // 从洞察生成记忆
        for (const insight of analysis.insights) {
          if (insight.confidence > 0.7) {
            memories.push({
              content: `${insight.category} 洞察: ${insight.observation}`,
              domain: "project",
              kind: "derived",
              tags: ["insight", insight.category],
            })
          }
        }

        // 从建议生成进化候选
        for (const suggestion of analysis.suggestions) {
          if (suggestion.priority === "high") {
            memories.push({
              content: `改进建议: ${suggestion.title} - ${suggestion.description}`,
              domain: "project",
              kind: "derived",
              tags: ["suggestion", suggestion.type],
            })
          }
        }

        return {
          memories,
          patterns,
          appliedAt: new Date(),
        }
      }),

      extractPatterns: Effect.fn("DistillService.extractPatterns")(function* (analyses) {
        patternMap.clear()

        for (const analysis of analyses) {
          for (const pattern of analysis.patterns) {
            const key = `${pattern.type}:${pattern.description}`
            const existing = patternMap.get(key) ?? { count: 0, success: 0 }
            existing.count += pattern.frequency
            if (pattern.type === "success") {
              existing.success += pattern.frequency
            }
            patternMap.set(key, existing)
          }
        }

        return Array.from(patternMap.entries()).map(([key, data]) => ({
          name: key.split(":")[1],
          description: key,
          frequency: data.count,
          successRate: data.success / data.count,
        }))
      }),

      applyMemories: Effect.fn("DistillService.applyMemories")(function* (result) {
        for (const mem of result.memories) {
          yield* memory.add({
            content: mem.content,
            domain: mem.domain,
            kind: mem.kind,
            tags: mem.tags,
            source: "dream",
          })
        }
      }),
    })
  })
)

export const defaultLayer = layer.pipe(Layer.provide(Memory.defaultLayer))
```

- [ ] **Step 2: 导出 Distill 模块**

```typescript
// packages/NovaWay/src/session/index.ts 添加
export * as SessionDistill from "./distill"
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/session/distill.ts packages/NovaWay/src/session/index.ts
git commit -m "feat(session): implement DistillService for pattern extraction and memory generation"
```

---

## Task 5: 创建 Checkpoint UI 组件

**Files:**
- Create: `packages/tui/src/component/checkpoint-panel.tsx`
- Modify: `packages/tui/src/routes/session/sidebar.tsx` (添加检查点标签页)

- [ ] **Step 1: 创建 CheckpointPanel 组件**

```tsx
// packages/tui/src/component/checkpoint-panel.tsx
import { For, Show, createSignal, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useRoute } from "../context/route"

export interface CheckpointPanelProps {}

export function CheckpointPanel(props: CheckpointPanelProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const route = useRoute()

  const [checkpoints, setCheckpoints] = createSignal<Array<{
    id: string
    name: string
    reason: string | null
    tags: string[]
    createdAt: Date
  }>>([])
  const [loading, setLoading] = createSignal(false)

  const loadCheckpoints = async () => {
    const sessionId = route.session?.id
    if (!sessionId) return

    setLoading(true)
    try {
      const result = await (sdk.client as any).get(`/session/${sessionId}/checkpoints`)
      setCheckpoints(result.data ?? [])
    } catch (e) {
      console.error("Failed to load checkpoints:", e)
    } finally {
      setLoading(false)
    }
  }

  onMount(loadCheckpoints)

  const createCheckpoint = async () => {
    const sessionId = route.session?.id
    if (!sessionId) return

    try {
      await (sdk.client as any).post(`/session/${sessionId}/checkpoints`, {
        name: `手动检查点 ${new Date().toLocaleTimeString()}`,
        reason: "手动创建",
      })
      await loadCheckpoints()
    } catch (e) {
      console.error("Failed to create checkpoint:", e)
    }
  }

  const restoreCheckpoint = async (checkpointId: string) => {
    try {
      await (sdk.client as any).post(`/checkpoints/${checkpointId}/restore`)
      await loadCheckpoints()
    } catch (e) {
      console.error("Failed to restore checkpoint:", e)
    }
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>📸 检查点</b>
        </text>
        <text fg={theme.textMuted} onMouseUp={loadCheckpoints}>
          {loading() ? "..." : "刷新"}
        </text>
      </box>

      <text fg={theme.primary} onMouseUp={createCheckpoint}>
        [创建检查点]
      </text>

      <Show
        when={checkpoints().length > 0}
        fallback={<text fg={theme.textMuted}>暂无检查点</text>}
      >
        <For each={checkpoints()}>
          {(cp) => (
            <box flexDirection="column" gap={0} paddingBottom={1}>
              <text fg={theme.text}>
                <span style={{ fg: theme.accent }}>●</span> {cp.name}
              </text>
              <Show when={cp.reason}>
                <text fg={theme.textMuted}>原因: {cp.reason}</text>
              </Show>
              <text fg={theme.textMuted}>
                {cp.createdAt.toLocaleString()}
              </text>
              <Show when={cp.tags.length > 0}>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <For each={cp.tags.slice(0, 3)}>
                    {(tag) => (
                      <text fg={theme.textMuted}>[{tag}]</text>
                    )}
                  </For>
                </box>
              </Show>
              <text fg={theme.success} onMouseUp={() => restoreCheckpoint(cp.id)}>
                [恢复]
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
```

- [ ] **Step 2: 添加检查点标签页到侧边栏**

```typescript
// packages/tui/src/routes/session/sidebar.tsx 添加
import { CheckpointPanel } from "../../component/checkpoint-panel"

// 在 SidebarTab 类型中添加
type SidebarTab = "files" | "info" | "memory" | "evolution" | "checkpoint"

// 在标签页切换中添加
<Show when={activeTab() === "checkpoint"}>
  <CheckpointPanel />
</Show>
```

- [ ] **Step 3: 提交**

```bash
git add packages/tui/src/component/checkpoint-panel.tsx packages/tui/src/routes/session/sidebar.tsx
git commit -m "feat(tui): add checkpoint panel for session state management"
```

---

## Task 6: 注册 Checkpoint/Dream/Distill API 路由

**Files:**
- Create: `packages/NovaWay/src/server/routes/session/checkpoint.ts`
- Modify: `packages/NovaWay/src/server/routes/session/index.ts` (注册路由)

- [ ] **Step 1: 创建 Checkpoint 路由**

```typescript
// packages/NovaWay/src/server/routes/session/checkpoint.ts
import { HttpRouter, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { SessionCheckpointService } from "../../../session/checkpoint"
import { Session } from "../../../session/session"

export const checkpointRoutes = HttpRouter.make({
  // 获取会话检查点列表
  GET: "/session/:sessionId/checkpoints": Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.params
    const checkpoint = yield* SessionCheckpointService
    const checkpoints = yield* checkpoint.list(sessionId)
    return yield* HttpServerResponse.json({ data: checkpoints })
  }),

  // 创建检查点
  POST: "/session/:sessionId/checkpoints": Effect.gen(function* () {
    const { sessionId } = yield* HttpRouter.params
    const body = yield* HttpRouter.schemaBody
    const checkpoint = yield* SessionCheckpointService
    const messages = yield* Session.messages({ sessionId })
    const result = yield* checkpoint.create({
      sessionId,
      name: body.name,
      reason: body.reason,
      tags: body.tags,
      messages: messages.map(m => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    })
    return yield* HttpServerResponse.json({ data: result })
  }),

  // 获取单个检查点
  GET: "/checkpoints/:checkpointId": Effect.gen(function* () {
    const { checkpointId } = yield* HttpRouter.params
    const checkpoint = yield* SessionCheckpointService
    const cp = yield* checkpoint.get(checkpointId)
    return yield* HttpServerResponse.json({ data: cp })
  }),

  // 恢复检查点
  POST: "/checkpoints/:checkpointId/restore": Effect.gen(function* () {
    const { checkpointId } = yield* HttpRouter.params
    const checkpoint = yield* SessionCheckpointService
    const data = yield* checkpoint.restore(checkpointId)
    return yield* HttpServerResponse.json({ data })
  }),

  // 删除检查点
  DELETE: "/checkpoints/:checkpointId": Effect.gen(function* () {
    const { checkpointId } = yield* HttpRouter.params
    const checkpoint = yield* SessionCheckpointService
    yield* checkpoint.delete(checkpointId)
    return yield* HttpServerResponse.json({ success: true })
  }),
})
```

- [ ] **Step 2: 注册路由**

```typescript
// packages/NovaWay/src/server/routes/session/index.ts 添加
import { checkpointRoutes } from "./checkpoint"

// 在路由组合中添加
.pipe(HttpRouter.merge(checkpointRoutes))
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/src/server/routes/session/checkpoint.ts packages/NovaWay/src/server/routes/session/index.ts
git commit -m "feat(server): add checkpoint API routes for session state management"
```

---

## Task 7: 集成 Dream/Distill 到会话生命周期

**Files:**
- Modify: `packages/NovaWay/src/session/processor.ts` (会话结束时触发 Dream 分析)

- [ ] **Step 1: 在会话结束时触发 Dream 分析**

```typescript
// packages/NovaWay/src/session/processor.ts
import { SessionDream } from "./dream"
import { SessionDistill } from "./distill"

// 在会话结束处理中添加
const onSessionEnd = Effect.fn("Processor.onSessionEnd")(function* (sessionId) {
  // 现有逻辑...

  // 触发 Dream 分析
  const dream = yield* SessionDream.DreamService
  const distill = yield* SessionDistill.DistillService

  const analysis = yield* Effect.either(dream.analyzeSession(sessionId))
  if (analysis._tag === "Right") {
    const distillResult = yield* distill.fromAnalysis(analysis.right)
    yield* distill.applyMemories(distillResult)
  }
})
```

- [ ] **Step 2: 提交**

```bash
git add packages/NovaWay/src/session/processor.ts
git commit -m "feat(session): integrate Dream/Distill into session lifecycle"
```

---

## Task 8: 测试验证

**Files:**
- Create: `packages/NovaWay/test/session/checkpoint.test.ts`
- Create: `packages/NovaWay/test/session/dream.test.ts`

- [ ] **Step 1: 编写 Checkpoint 测试**

```typescript
// packages/NovaWay/test/session/checkpoint.test.ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { CheckpointService } from "../../src/session/checkpoint"
import { layer } from "../../src/session/checkpoint"

describe("CheckpointService", () => {
  it.effect("creates and retrieves checkpoint", () =>
    Effect.gen(function* () {
      const service = yield* CheckpointService
      const checkpoint = yield* service.create({
        sessionId: "test-session",
        name: "Test Checkpoint",
        reason: "Testing",
        messages: [{ role: "user", content: "Hello" }],
      })

      expect(checkpoint.name).toBe("Test Checkpoint")
      expect(checkpoint.sessionId).toBe("test-session")

      const retrieved = yield* service.get(checkpoint.id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.name).toBe("Test Checkpoint")
    }).pipe(Effect.provide(layer))
  )

  it.effect("lists checkpoints by session", () =>
    Effect.gen(function* () {
      const service = yield* CheckpointService
      yield* service.create({
        sessionId: "session-1",
        name: "CP1",
        messages: [],
      })
      yield* service.create({
        sessionId: "session-2",
        name: "CP2",
        messages: [],
      })

      const list = yield* service.list("session-1")
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("CP1")
    }).pipe(Effect.provide(layer))
  )
})
```

- [ ] **Step 2: 运行测试**

```bash
cd packages/NovaWay && bun test test/session/checkpoint.test.ts
```

- [ ] **Step 3: 提交**

```bash
git add packages/NovaWay/test/session/checkpoint.test.ts
git commit -m "test(session): add checkpoint service tests"
```

---

## 执行选项

**计划完成并保存到 `docs/superpowers/plans/2026-08-24-mimo-checkpoint-dream.md`**

**两种执行方式：**

1. **子代理驱动（推荐）** - 每个任务派发一个新子代理，任务间进行审查，快速迭代

2. **内联执行** - 在当前会话中使用 executing-plans 批量执行，设置检查点进行审查

**选择哪种方式？**
