import { Context, Effect, Layer } from "effect"

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

        plans.set(planId, { ...plan, status: "running" })

        for (const task of plan.tasks) {
          const depsMet = task.dependencies.every(
            (dep) => plan.tasks.find((t) => t.id === dep)?.status === "completed"
          )
          if (!depsMet) {
            plans.set(planId, { ...plan, status: "failed" })
            return yield* Effect.fail(new Error(`Dependencies not met for task ${task.id}`))
          }

          yield* Effect.log(`执行任务: ${task.name}`)
          const updatedTasks = plan.tasks.map((t) =>
            t.id === task.id ? { ...t, status: "completed" as const } : t
          )
          plans.set(planId, { ...plan, tasks: updatedTasks })
        }

        plans.set(planId, { ...plan, status: "completed" })
        return yield* Effect.void
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
        return yield* Effect.void
      }),
    }
  }),
)

export const defaultLayer = layer
