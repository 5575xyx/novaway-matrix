import { Goal } from "@/session/goal"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const goalHandlers = HttpApiBuilder.group(InstanceHttpApi, "goal", (handlers) =>
  Effect.gen(function* () {
    const goal = yield* Goal.Service

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
