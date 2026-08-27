import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { OrchestratorPlanTable, type OrchestratorTask } from "./orchestrator.sql"
import type { RunAgent } from "@/session/agent-step"

export type { OrchestratorTask }

export interface OrchestratorPlan {
  readonly id: string
  readonly sessionId: string
  readonly name: string
  readonly tasks: OrchestratorTask[]
  readonly status: "draft" | "running" | "completed" | "failed"
  readonly error: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface Interface {
  readonly createPlan: (input: {
    sessionId: string
    name: string
    tasks: Omit<OrchestratorTask, "id" | "status">[]
  }) => Effect.Effect<OrchestratorPlan>

  /**
   * 按 dependencies 拓扑执行:无依赖冲突的任务并发跑,每个任务经注入的 runAgent
   * 派生子代理执行,结果写回。失败标记 plan failed 但不崩溃。
   */
  readonly executePlan: (input: {
    planId: string
    runAgent: RunAgent
    defaultAgent: string
    concurrency?: number
  }) => Effect.Effect<OrchestratorPlan>

  readonly getPlan: (planId: string) => Effect.Effect<OrchestratorPlan | null>

  readonly listPlans: (sessionId: string) => Effect.Effect<readonly OrchestratorPlan[]>

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

  readonly delete: (planId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Interface>()("@NovaWay/OrchestratorService") {}
export { Service as OrchestratorService }

const generateId = () => `orch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

/** 把 {{taskId}} 占位符替换为对应任务的结果文本。 */
function interpolate(template: string, results: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const value = results[key]
    if (value == null) return ""
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const toPlan = (row: any): OrchestratorPlan => ({
      id: row.id,
      sessionId: row.session_id,
      name: row.name,
      tasks: row.tasks as OrchestratorTask[],
      status: row.status as OrchestratorPlan["status"],
      error: row.error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })

    const load = (planId: string) =>
      Effect.sync(() =>
        Database.use((db) =>
          db.select().from(OrchestratorPlanTable).where(eq(OrchestratorPlanTable.id, planId)).limit(1).all(),
        ),
      )

    const persist = (planId: string, patch: { tasks?: OrchestratorTask[]; status?: string; error?: string | null }) =>
      Effect.sync(() =>
        Database.use((db) =>
          db
            .update(OrchestratorPlanTable)
            .set({
              ...(patch.tasks && { tasks: patch.tasks }),
              ...(patch.status && { status: patch.status }),
              ...(patch.error !== undefined && { error: patch.error }),
              updated_at: Date.now(),
            })
            .where(eq(OrchestratorPlanTable.id, planId))
            .run(),
        ),
      )

    const getPlan: Interface["getPlan"] = Effect.fn("OrchestratorService.getPlan")(function* (planId) {
      const rows = yield* load(planId)
      if (rows.length === 0) return null
      return toPlan(rows[0])
    })

    return {
      createPlan: Effect.fn("OrchestratorService.createPlan")(function* (input) {
        const now = new Date()
        const plan: OrchestratorPlan = {
          id: generateId(),
          sessionId: input.sessionId,
          name: input.name,
          tasks: input.tasks.map((t, i) => ({ ...t, id: `task_${i}`, status: "pending" as const })),
          status: "draft",
          error: null,
          createdAt: now,
          updatedAt: now,
        }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db.insert(OrchestratorPlanTable).values({
              id: plan.id,
              session_id: plan.sessionId,
              name: plan.name,
              tasks: plan.tasks,
              status: plan.status,
              error: plan.error,
              created_at: plan.createdAt.getTime(),
              updated_at: plan.updatedAt.getTime(),
            })
            .run(),
          ),
        )
        return plan
      }),

      executePlan: Effect.fn("OrchestratorService.executePlan")(function* (input) {
        const initial = yield* getPlan(input.planId)
        if (!initial) return yield* Effect.fail(new Error("Plan not found"))

        const tasks = initial.tasks.map((t) => ({ ...t }))
        const byId = new Map(tasks.map((t) => [t.id, t]))
        const results: Record<string, unknown> = {}
        for (const t of tasks) if (t.status === "completed" && t.result != null) results[t.id] = t.result

        yield* persist(input.planId, { status: "running", error: null })

        const runTask = (task: OrchestratorTask): Effect.Effect<void> =>
          Effect.gen(function* () {
            const c = task.config ?? {}
            const agentName = typeof c.agent === "string" ? c.agent : input.defaultAgent
            let promptText: string
            if (task.type === "tool" || task.type === "skill") {
              const target = task.type === "tool" ? c.tool : c.skill
              const kind = task.type === "tool" ? "工具" : "技能"
              promptText = [`请使用${kind} \`${String(target ?? "")}\` 完成以下任务：`, interpolate(String(c.prompt ?? ""), results)]
                .filter(Boolean)
                .join("\n")
            } else {
              promptText = interpolate(String(c.prompt ?? task.name), results)
            }
            const out = yield* input.runAgent({ agent: agentName, prompt: promptText, title: task.name })
            const cur = byId.get(task.id)!
            ;(cur as any).status = "completed"
            ;(cur as any).result = out
            results[task.id] = out
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                const cur = byId.get(task.id)!
                ;(cur as any).status = "failed"
                ;(cur as any).error = error instanceof Error ? error.message : String(error)
              }),
            ),
          )

        // 按波次执行:每波取所有依赖已完成的 pending 任务并发跑。
        const guard = { budget: tasks.length + 2 }
        while (guard.budget-- > 0) {
          const pending = tasks.filter((t) => t.status === "pending")
          if (pending.length === 0) break
          const ready = pending.filter((t) =>
            t.dependencies.every((dep) => byId.get(dep)?.status === "completed"),
          )
          if (ready.length === 0) {
            // 剩余任务的依赖无法满足(缺失/失败/环)——终止。
            for (const t of pending) {
              ;(byId.get(t.id) as any).status = "failed"
              ;(byId.get(t.id) as any).error = t.error ?? "依赖未满足或存在循环依赖"
            }
            break
          }
          yield* Effect.forEach(ready, runTask, { concurrency: input.concurrency ?? Math.max(1, ready.length) })
          yield* persist(input.planId, { tasks: [...tasks] })
          // 若本波有失败,停止调度后续依赖它的任务(它们的依赖将永不完成 → 下一轮标记失败)。
        }

        const anyFailed = tasks.some((t) => t.status === "failed")
        const finalStatus = anyFailed ? "failed" : "completed"
        yield* persist(input.planId, {
          tasks: [...tasks],
          status: finalStatus,
          error: anyFailed ? "部分任务执行失败" : null,
        })
        const final = yield* getPlan(input.planId)
        return final!
      }),

      getPlan,

      listPlans: Effect.fn("OrchestratorService.listPlans")(function* (sessionId) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(OrchestratorPlanTable)
              .where(eq(OrchestratorPlanTable.session_id, sessionId))
              .orderBy(OrchestratorPlanTable.created_at)
              .all(),
          ),
        )
        return rows.map(toPlan)
      }),

      addTask: Effect.fn("OrchestratorService.addTask")(function* (input) {
        const plan = yield* getPlan(input.planId)
        if (!plan) return yield* Effect.fail(new Error("Plan not found"))
        const task: OrchestratorTask = { ...input.task, id: `task_${plan.tasks.length}`, status: "pending" }
        yield* persist(input.planId, { tasks: [...plan.tasks, task] })
        return task
      }),

      updateTaskStatus: Effect.fn("OrchestratorService.updateTaskStatus")(function* (input) {
        const plan = yield* getPlan(input.planId)
        if (!plan) return yield* Effect.fail(new Error("Plan not found"))
        const updatedTasks = plan.tasks.map((t) =>
          t.id === input.taskId ? { ...t, status: input.status, result: input.result, error: input.error } : t,
        )
        yield* persist(input.planId, { tasks: updatedTasks })
      }),

      delete: Effect.fn("OrchestratorService.delete")(function* (planId) {
        yield* Effect.sync(() =>
          Database.use((db) => db.delete(OrchestratorPlanTable).where(eq(OrchestratorPlanTable.id, planId)).run()),
        )
      }),
    }
  }),
)

export const defaultLayer = layer
