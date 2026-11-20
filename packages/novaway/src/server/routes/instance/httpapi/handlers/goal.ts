import { createHash } from "node:crypto"
import { Goal } from "@/session/goal"
import { SessionID } from "@/session/schema"
import { SuperAgentStore } from "@/super-agent"
import { startSuperAgentRun } from "@/super-agent/launcher"
import { Provider } from "@/provider/provider"
import * as Session from "@/session/session"
import { Service as ToolRegistry } from "@/tool/registry"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"

export const goalHandlers = HttpApiBuilder.group(InstanceHttpApi, "goal", (handlers) =>
  Effect.gen(function* () {
    const goal = yield* Goal.Service
    const superAgent = yield* SuperAgentStore
    const provider = yield* Provider.Service
    const sessions = yield* Session.Service
    const toolRegistry = yield* ToolRegistry

    return handlers
      .handle("listGoals", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
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
            executionConfig: g.executionConfig ?? undefined,
            createdAt: g.createdAt.toISOString(),
            updatedAt: g.updatedAt.toISOString(),
          }))
        }),
      )
      .handle("createGoal", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const created = yield* goal
            .create({
              sessionId,
              parentId: ctx.payload.parentId,
              title: ctx.payload.title,
              description: ctx.payload.description,
              status: ctx.payload.status,
              priority: ctx.payload.priority as any,
              successCriteria: ctx.payload.successCriteria as string[] | undefined,
              deadline: ctx.payload.deadline ? new Date(ctx.payload.deadline) : undefined,
              tags: ctx.payload.tags as string[] | undefined,
              executionConfig: ctx.payload.executionConfig,
            })
            .pipe(Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))))
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
            executionConfig: created.executionConfig ?? undefined,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }
        }),
      )
      .handle("createAndLaunchGoal", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const sessionInfo = yield* sessions.get(sessionId).pipe(Effect.orDie)
          const goalId = `goal_req_${createHash("sha256").update(ctx.payload.idempotencyKey).digest("hex").slice(0, 32)}`
          const runId = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          const executionConfig = {
            ...(ctx.payload.executionConfig ?? {}),
            maxIterations: ctx.payload.executionConfig?.maxIterations ?? 20,
            mode: "durable" as const,
          }
          const successCriteria = ctx.payload.successCriteria?.length
            ? ctx.payload.successCriteria
            : ["完成目标，并提供可以复核的执行结果和证据。"]
          const run = yield* superAgent.createGoalLinked({
            id: runId,
            directory: sessionInfo.directory,
            goalId,
            sessionId,
            title: ctx.payload.title,
            description: ctx.payload.description,
            priority: ctx.payload.priority as "high" | "medium" | "low" | undefined,
            successCriteria: [...successCriteria],
            deadline: ctx.payload.deadline ? new Date(ctx.payload.deadline) : undefined,
            tags: ctx.payload.tags as string[] | undefined,
            executionConfig,
            budget: ctx.payload.budget,
            goal: {
              text: ctx.payload.text?.trim() || ctx.payload.description || ctx.payload.title,
              constraints: [],
              acceptanceCriteria: successCriteria.map((text, index) => ({
                id: `criterion-${index + 1}`,
                text,
                required: true,
              })),
              planningMode: ctx.payload.planningMode ?? "model",
              requestedBy: "user",
              source: "user",
              goalId,
              sessionId,
            },
          })
          if (!run) return yield* notFound(`Goal launch idempotency key already exists without a run`)
          if (run.id === runId) {
            yield* superAgent.appendEvent({
              runID: run.id,
              type: "run_created",
              at: Date.now(),
              payload: { status: run.status, goalId, source: "goal.create-and-launch" },
            })
          }
          const started = yield* startSuperAgentRun({ store: superAgent, sessions, provider, toolRegistry }, run.id)
          if (!started) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          const createdGoal = yield* goal.get({ goalId, sessionId })
          if (!createdGoal) return yield* notFound(`没有 Goal ${goalId}`)
          return { goal: createdGoal, run: started }
        }),
      )
      .handle("launchGoal", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const current = yield* goal.get({ goalId: ctx.params.goalId, sessionId })
          if (!current) return yield* notFound(`Goal not found: ${ctx.params.goalId}`)
          if (current.status !== "pending" && current.status !== "in_progress") {
            return yield* notFound(`Goal cannot be launched from status: ${current.status}`)
          }
          const executionConfig = {
            ...(current.executionConfig ?? {}),
            maxIterations: current.executionConfig?.maxIterations ?? 20,
            mode: "durable" as const,
          }
          const acceptanceCriteria = (current.successCriteria?.length
            ? current.successCriteria
            : ["完成目标，并提供可以复核的执行结果和证据。"]
          ).map((text, index) => ({ id: `criterion-${index + 1}`, text, required: true }))
          const runID = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          const sessionInfo = yield* sessions.get(sessionId).pipe(Effect.orDie)
          const directory = sessionInfo.directory
          const run = yield* superAgent.createLinked({
            id: runID,
            directory,
            sessionId,
            goalId: current.id,
            goal: {
              text: ctx.payload.text?.trim() || current.description || current.title,
              constraints: [],
              acceptanceCriteria,
              planningMode: ctx.payload.planningMode ?? "model",
              requestedBy: "user",
              source: "user",
              goalId: current.id,
              sessionId,
            },
            budget: ctx.payload.budget,
            executionConfig,
          })
          if (!run) return yield* notFound(`Goal cannot be launched: ${ctx.params.goalId}`)
          if (run.id === runID) {
            yield* superAgent.appendEvent({
              runID: run.id,
              type: "run_created",
              at: Date.now(),
              payload: { status: run.status, goalId: current.id, source: "goal.launch" },
            })
          }
          const started = yield* startSuperAgentRun({ store: superAgent, sessions, provider, toolRegistry }, run.id)
          if (!started) return yield* notFound(`没有 Super-Agent run ${run.id}`)
          const linked = yield* goal.get({ goalId: current.id, sessionId })
          return {
            goal: linked ?? current,
            run: started,
          }
        }),
      )
      .handle("getGoal", (ctx) =>
        Effect.gen(function* () {
          const g = yield* goal.get({ goalId: ctx.params.goalId, sessionId: SessionID.make(ctx.params.sessionId) })
          if (!g) return yield* Effect.fail(notFound(`Goal not found: ${ctx.params.goalId}`))

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
            executionConfig: g.executionConfig ?? undefined,
            createdAt: g.createdAt.toISOString(),
            updatedAt: g.updatedAt.toISOString(),
          }
        }),
      )
      .handle("updateGoal", (ctx) =>
        Effect.gen(function* () {
          const updated = yield* goal
            .update({
              goalId: ctx.params.goalId,
              sessionId: SessionID.make(ctx.params.sessionId),
              ...ctx.payload,
              status: ctx.payload.status as any,
              priority: ctx.payload.priority as any,
              successCriteria: ctx.payload.successCriteria as string[] | undefined,
              tags: ctx.payload.tags as string[] | undefined,
              deadline: ctx.payload.deadline ? new Date(ctx.payload.deadline) : undefined,
            })
            .pipe(Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))))
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
            executionConfig: updated.executionConfig ?? undefined,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          }
        }),
      )
      .handle("deleteGoal", (ctx) =>
        Effect.gen(function* () {
          yield* goal
            .delete({ goalId: ctx.params.goalId, sessionId: SessionID.make(ctx.params.sessionId) })
            .pipe(Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))))
          return { success: true }
        }),
      )
      .handle("getGoalProgress", (ctx) =>
        Effect.gen(function* () {
          const progress = yield* goal
            .getProgress({
              goalId: ctx.params.goalId,
              sessionId: SessionID.make(ctx.params.sessionId),
            })
            .pipe(Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))))
          return progress
        }),
      )
  }),
)
