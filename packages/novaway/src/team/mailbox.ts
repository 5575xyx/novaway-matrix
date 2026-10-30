import { Context, Effect, Layer } from "effect"
import { and, eq, isNull, or } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { SessionID } from "@/session/schema"
import { AgentMessageTable } from "./team.sql"

export type Message = {
  id: string
  teamID: string
  fromSessionID: SessionID
  toSessionID?: SessionID
  broadcast: boolean
  summary?: string
  content: string
  readAt?: number
  createdAt: number
}

export interface Interface {
  readonly send: (input: {
    teamID: string
    fromSessionID: SessionID
    toSessionID?: SessionID
    broadcast?: boolean
    summary?: string
    content: string
  }) => Effect.Effect<Message>
  /** Unread messages for a session, including broadcasts. Marks them read. */
  readonly drain: (sessionID: SessionID) => Effect.Effect<Message[]>
  readonly list: (sessionID: SessionID) => Effect.Effect<Message[]>
  /** Full transcript of a team, oldest first. Used by the team page chat. */
  readonly team: (teamID: string) => Effect.Effect<Message[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/AgentMailbox") {}

const id = () => `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

function toMessage(row: typeof AgentMessageTable.$inferSelect): Message {
  return {
    id: row.id,
    teamID: row.team_id,
    fromSessionID: row.from_session_id,
    toSessionID: row.to_session_id ?? undefined,
    broadcast: row.broadcast === 1,
    summary: row.summary ?? undefined,
    content: row.content,
    readAt: row.read_at ?? undefined,
    createdAt: row.created_at,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const send: Interface["send"] = Effect.fn("AgentMailbox.send")(function* (input) {
      const now = Date.now()
      const message: Message = {
        id: id(),
        teamID: input.teamID,
        fromSessionID: input.fromSessionID,
        toSessionID: input.toSessionID,
        broadcast: input.broadcast === true,
        summary: input.summary,
        content: input.content,
        createdAt: now,
      }
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .insert(AgentMessageTable)
            .values({
              id: message.id,
              team_id: message.teamID,
              from_session_id: message.fromSessionID,
              to_session_id: message.toSessionID ?? null,
              broadcast: message.broadcast ? 1 : 0,
              summary: message.summary ?? null,
              content: message.content,
              read_at: null,
              created_at: now,
            })
            .run(),
        ),
      )
      return message
    })

    const drain: Interface["drain"] = Effect.fn("AgentMailbox.drain")(function* (sessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(AgentMessageTable)
            .where(
              and(
                isNull(AgentMessageTable.read_at),
                or(eq(AgentMessageTable.to_session_id, sessionID), eq(AgentMessageTable.broadcast, 1)),
              ),
            )
            .all(),
        ),
      )
      if (rows.length === 0) return []
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) => {
          for (const row of rows) {
            db.update(AgentMessageTable).set({ read_at: now }).where(eq(AgentMessageTable.id, row.id)).run()
          }
        }),
      )
      return rows.map(toMessage).filter((message) => message.fromSessionID !== sessionID)
    })

    const list: Interface["list"] = Effect.fn("AgentMailbox.list")(function* (sessionID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(AgentMessageTable)
            .where(or(eq(AgentMessageTable.to_session_id, sessionID), eq(AgentMessageTable.from_session_id, sessionID)))
            .all(),
        ),
      )
      return rows.map(toMessage).sort((a, b) => a.createdAt - b.createdAt)
    })

    const team: Interface["team"] = Effect.fn("AgentMailbox.team")(function* (teamID) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(AgentMessageTable).where(eq(AgentMessageTable.team_id, teamID)).all()),
      )
      return rows.map(toMessage).sort((a, b) => a.createdAt - b.createdAt)
    })

    return Service.of({ send, drain, list, team })
  }),
)

export const defaultLayer = layer

export * as AgentMailbox from "./mailbox"
