import { Goal } from "@/session/goal"
import { SessionID } from "@/session/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"

export const goalHandlers = HttpApiBuilder.group(InstanceHttpApi, "goal", (handlers) =>
  Effect.gen(function* () {
    const goal = yield* Goal.Service

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
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
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
