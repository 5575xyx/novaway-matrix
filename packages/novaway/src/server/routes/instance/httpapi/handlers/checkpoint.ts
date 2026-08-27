import { SessionCheckpoint } from "@/session/checkpoint"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const CreateCheckpointPayload = Schema.Struct({
  name: Schema.String,
  reason: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
})

const CheckpointResponse = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  name: Schema.String,
  reason: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

export const checkpointHandlers = HttpApiBuilder.group(InstanceHttpApi, "checkpoint", (handlers) =>
  Effect.gen(function* () {
    const checkpoint = yield* SessionCheckpoint.Service
    const session = yield* Session.Service
    const snapshot = yield* Snapshot.Service

    return handlers
      .handle("listCheckpoints", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const checkpoints = yield* checkpoint.list(sessionId)
          return checkpoints.map((cp) => ({
            id: cp.id,
            sessionId: cp.sessionId,
            name: cp.name,
            reason: cp.reason ?? undefined,
            tags: cp.tags,
            createdAt: cp.createdAt.toISOString(),
            updatedAt: cp.updatedAt.toISOString(),
          }))
        }),
      )
      .handle("createCheckpoint", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const messages = yield* session.messages({ sessionID: sessionId }).pipe(Effect.orDie)
          const snapshotId = yield* snapshot.track().pipe(Effect.orDie)
          const result = yield* checkpoint.create({
            sessionId,
            name: ctx.payload.name,
            reason: ctx.payload.reason,
            tags: ctx.payload.tags as string[] | undefined,
            messages,
            snapshot: snapshotId,
          })
          return {
            id: result.id,
            sessionId: result.sessionId,
            name: result.name,
            reason: result.reason ?? undefined,
            tags: result.tags,
            createdAt: result.createdAt.toISOString(),
            updatedAt: result.updatedAt.toISOString(),
          }
        }),
      )
      .handle("getCheckpoint", (ctx) =>
        Effect.gen(function* () {
          const cp = yield* checkpoint.get(ctx.params.checkpointId)
          if (!cp) {
            return yield* Effect.fail(new HttpApiError.NotFound({}))
          }
          return {
            id: cp.id,
            sessionId: cp.sessionId,
            name: cp.name,
            reason: cp.reason ?? undefined,
            tags: cp.tags,
            createdAt: cp.createdAt.toISOString(),
            updatedAt: cp.updatedAt.toISOString(),
          }
        }),
      )
      .handle("restoreCheckpoint", (ctx) =>
        Effect.gen(function* () {
          const data = yield* checkpoint.restore(ctx.params.checkpointId)
          return data
        }),
      )
      .handle("deleteCheckpoint", (ctx) =>
        Effect.gen(function* () {
          yield* checkpoint.delete(ctx.params.checkpointId)
          return { success: true }
        }),
      )
  }),
)
