import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
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
export { Service as WorkflowService }

const generateId = () => `wf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
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

        yield* Effect.sync(() =>
          Database.use((db) =>
            db.insert(WorkflowTable).values({
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
            .run(),
          ),
        )

        return workflow
      }),

      list: Effect.fn("WorkflowService.list")(function* (sessionId) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(WorkflowTable).where(eq(WorkflowTable.session_id, sessionId)).orderBy(WorkflowTable.created_at).all(),
          ),
        )

        return rows.map(toWorkflow)
      }),

      get: Effect.fn("WorkflowService.get")(function* (workflowId) {
        const row = yield* Effect.sync(() =>
          Database.use((db) => db.select().from(WorkflowTable).where(eq(WorkflowTable.id, workflowId)).limit(1).all()),
        )

        if (row.length === 0) return null
        return toWorkflow(row[0])
      }),

      update: Effect.fn("WorkflowService.update")(function* (input) {
        const now = new Date()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(WorkflowTable)
              .set({
                ...(input.name && { name: input.name }),
                ...(input.description !== undefined && { description: input.description }),
                ...(input.steps && { steps: input.steps }),
                ...(input.status && { status: input.status }),
                updated_at: now.getTime(),
              })
              .where(eq(WorkflowTable.id, input.workflowId))
              .run(),
          ),
        )

        const updated = yield* Effect.sync(() =>
          Database.use((db) => db.select().from(WorkflowTable).where(eq(WorkflowTable.id, input.workflowId)).limit(1).all()),
        )

        return toWorkflow(updated[0])
      }),

      delete: Effect.fn("WorkflowService.delete")(function* (workflowId) {
        yield* Effect.sync(() => Database.use((db) => db.delete(WorkflowTable).where(eq(WorkflowTable.id, workflowId)).run()))
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

        yield* Effect.sync(() =>
          Database.use((db) =>
            db.insert(WorkflowRunTable).values({
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
            .run(),
          ),
        )

        return run
      }),

      getRun: Effect.fn("WorkflowService.getRun")(function* (runId) {
        const row = yield* Effect.sync(() =>
          Database.use((db) => db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, runId)).limit(1).all()),
        )

        if (row.length === 0) return null
        return toRun(row[0])
      }),

      listRuns: Effect.fn("WorkflowService.listRuns")(function* (workflowId) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.workflow_id, workflowId)).orderBy(WorkflowRunTable.created_at).all(),
          ),
        )

        return rows.map(toRun)
      }),

      updateRunState: Effect.fn("WorkflowService.updateRunState")(function* (input) {
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(WorkflowRunTable)
              .set({
                state: input.state,
                ...(input.status && { status: input.status }),
                ...(input.error !== undefined && { error: input.error }),
                ...(input.status === "completed" && { completed_at: Date.now() }),
              })
              .where(eq(WorkflowRunTable.id, input.runId))
              .run(),
          ),
        )

        const updated = yield* Effect.sync(() =>
          Database.use((db) => db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, input.runId)).limit(1).all()),
        )

        return toRun(updated[0])
      }),
    }
  }),
)

export const defaultLayer = layer