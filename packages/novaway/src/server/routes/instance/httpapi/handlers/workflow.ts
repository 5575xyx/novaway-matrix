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