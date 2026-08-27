import { Context, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { SessionCheckpointTable, SessionCheckpointStateTable, type CheckpointData } from "./checkpoint.sql"
import { Session } from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"
import { Snapshot } from "@/snapshot"

const MessagesSchema = Schema.Array(MessageV2.WithParts)
const encodeMessages = Schema.encodeSync(MessagesSchema)
const decodeMessages = Schema.decodeUnknownSync(MessagesSchema)

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

export interface Interface {
  readonly create: (input: {
    sessionId: string
    name: string
    reason?: string
    tags?: string[]
    messages: readonly MessageV2.WithParts[]
    snapshot?: string
    context?: Record<string, unknown>
  }) => Effect.Effect<Checkpoint>

  readonly list: (sessionId: string) => Effect.Effect<readonly Checkpoint[]>

  readonly get: (checkpointId: string) => Effect.Effect<Checkpoint | null>

  readonly restore: (checkpointId: string) => Effect.Effect<CheckpointData>

  // 自动检查点:捕获当前会话消息+文件快照并落库,供 prompt 循环按间隔调用。
  readonly createAuto: (input: {
    sessionId: string
    name?: string
    reason?: string
  }) => Effect.Effect<Checkpoint>

  // 间隔门控:按会话累加轮次,turn % interval === 0 时返回 true。interval<=0 恒 false。
  readonly autoDue: (input: { sessionId: string; interval: number }) => Effect.Effect<boolean>

  readonly delete: (checkpointId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Interface>()("@NovaWay/CheckpointService") {}

const generateId = () => `cp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service

    return {
      create: Effect.fn("CheckpointService.create")(function* (input) {
        const now = new Date()
        const checkpoint: Checkpoint = {
          id: generateId(),
          sessionId: input.sessionId,
          name: input.name,
          reason: input.reason ?? null,
          tags: input.tags ?? [],
          data: {
            messages: encodeMessages(input.messages) as unknown[],
            snapshot: input.snapshot,
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

        yield* Effect.sync(() =>
          Database.use((db) =>
            db.insert(SessionCheckpointTable).values({
              id: checkpoint.id,
              session_id: checkpoint.sessionId,
              name: checkpoint.name,
              reason: checkpoint.reason,
              tags: checkpoint.tags,
              data: checkpoint.data as any,
              created_at: checkpoint.createdAt.getTime(),
              updated_at: checkpoint.updatedAt.getTime(),
            })
            .run(),
          ),
        )

        return checkpoint
      }),

      list: Effect.fn("CheckpointService.list")(function* (sessionId) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(SessionCheckpointTable).where(eq(SessionCheckpointTable.session_id, sessionId)).orderBy(SessionCheckpointTable.created_at).all(),
          ),
        )

        return rows.map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          name: row.name,
          reason: row.reason,
          tags: (row.tags as string[]) ?? [],
          data: row.data as CheckpointData,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        }))
      }),

      get: Effect.fn("CheckpointService.get")(function* (checkpointId) {
        const row = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(SessionCheckpointTable).where(eq(SessionCheckpointTable.id, checkpointId)).limit(1).all(),
          ),
        )

        if (row.length === 0) return null

        const r = row[0]
        return {
          id: r.id,
          sessionId: r.session_id,
          name: r.name,
          reason: r.reason,
          tags: (r.tags as string[]) ?? [],
          data: r.data as CheckpointData,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        }
      }),

      restore: Effect.fn("CheckpointService.restore")(function* (checkpointId) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db.select().from(SessionCheckpointTable).where(eq(SessionCheckpointTable.id, checkpointId)).limit(1).all(),
          ),
        )

        if (rows.length === 0) {
          return yield* Effect.die(new Error(`Checkpoint ${checkpointId} not found`))
        }

        const row = rows[0]
        const data = row.data as CheckpointData
        const sessionID = SessionID.make(row.session_id)

        // 原地覆盖:先清空当前会话所有消息,再把检查点消息/部件写回同一会话,最后回滚文件快照。
        const current = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
        for (const msg of current) {
          yield* sessions.removeMessage({ sessionID, messageID: msg.info.id }).pipe(Effect.orDie)
        }

        const restored = decodeMessages(data.messages)
        for (const msg of restored) {
          // 检查点来自同一会话,消息/部件的 sessionID、id 均保持不变,直接回写即为原地恢复。
          yield* sessions.updateMessage(msg.info).pipe(Effect.orDie)
          for (const part of msg.parts) {
            yield* sessions.updatePart(part).pipe(Effect.orDie)
          }
        }

        if (data.snapshot) {
          yield* snap.checkout(data.snapshot).pipe(Effect.orDie)
        }

        return data
      }),

      createAuto: Effect.fn("CheckpointService.createAuto")(function* (input) {
        const sessionID = SessionID.make(input.sessionId)
        const messages = yield* sessions.messages({ sessionID }).pipe(Effect.orDie)
        const snapshotId = yield* snap.track().pipe(Effect.catch(() => Effect.succeed(undefined)))
        const now = new Date()
        const checkpoint: Checkpoint = {
          id: generateId(),
          sessionId: input.sessionId,
          name: input.name ?? `自动检查点 ${now.toISOString()}`,
          reason: input.reason ?? "auto",
          tags: ["auto"],
          data: {
            messages: encodeMessages(messages) as unknown[],
            snapshot: snapshotId,
            context: {},
            metadata: {
              reason: input.reason ?? "auto",
              tags: ["auto"],
              createdAt: now.toISOString(),
            },
          },
          createdAt: now,
          updatedAt: now,
        }
        yield* Effect.sync(() =>
          Database.use((db) =>
            db.insert(SessionCheckpointTable).values({
              id: checkpoint.id,
              session_id: checkpoint.sessionId,
              name: checkpoint.name,
              reason: checkpoint.reason,
              tags: checkpoint.tags,
              data: checkpoint.data as any,
              created_at: checkpoint.createdAt.getTime(),
              updated_at: checkpoint.updatedAt.getTime(),
            })
            .run(),
          ),
        )
        return checkpoint
      }),

      autoDue: Effect.fn("CheckpointService.autoDue")(function* (input) {
        if (input.interval <= 0) return false
        const now = Date.now()
        const turn = yield* Effect.sync(() =>
          Database.transaction((tx) => {
            const current = tx
              .select()
              .from(SessionCheckpointStateTable)
              .where(eq(SessionCheckpointStateTable.session_id, input.sessionId))
              .get()
            const next = (current?.turn_count ?? 0) + 1
            tx.insert(SessionCheckpointStateTable)
              .values({
                session_id: input.sessionId,
                turn_count: next,
                last_checkpoint_at: now,
                time_created: current?.time_created ?? now,
                time_updated: now,
              })
              .onConflictDoUpdate({
                target: SessionCheckpointStateTable.session_id,
                set: {
                  turn_count: next,
                  last_checkpoint_at: now,
                  time_updated: now,
                },
              })
              .run()
            return next
          }),
        )
        return turn % input.interval === 0
      }),

      delete: Effect.fn("CheckpointService.delete")(function* (checkpointId) {
        yield* Effect.sync(() =>
          Database.use((db) => db.delete(SessionCheckpointTable).where(eq(SessionCheckpointTable.id, checkpointId)).run()),
        )
      }),
    }
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Session.defaultLayer), Layer.provide(Snapshot.defaultLayer)),
)

export * as SessionCheckpoint from "./checkpoint"
