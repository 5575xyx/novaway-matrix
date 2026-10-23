import { Database } from "@/database"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { databaseError, QueryPayload } from "../groups/database"

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const databaseHandlers = HttpApiBuilder.group(InstanceHttpApi, "database", (handlers) =>
  Effect.gen(function* () {
    const database = yield* Database.Service

    const fail = (error: unknown) => databaseError(message(error))

    const listConnections = Effect.fn("DatabaseHttpApi.listConnections")(function* () {
      return yield* database.list().pipe(Effect.mapError(fail))
    })

    const saveConnection = Effect.fn("DatabaseHttpApi.saveConnection")(function* (ctx: {
      payload: Parameters<typeof database.save>[0]
    }) {
      return yield* database.save(ctx.payload).pipe(Effect.mapError(fail))
    })

    const removeConnection = Effect.fn("DatabaseHttpApi.removeConnection")(function* (ctx: {
      params: { connectionID: string }
    }) {
      return yield* database.remove(ctx.params.connectionID).pipe(Effect.mapError(fail))
    })

    const testConnection = Effect.fn("DatabaseHttpApi.testConnection")(function* (ctx: {
      params: { connectionID: string }
    }) {
      return yield* database.test(ctx.params.connectionID).pipe(Effect.mapError(fail))
    })

    const query = Effect.fn("DatabaseHttpApi.query")(function* (ctx: { payload: typeof QueryPayload.Type }) {
      // 查询失败要把原因带给 UI（SQL 写错是最常见的情况）。
      return yield* database.query(ctx.payload).pipe(Effect.mapError(fail))
    })

    const tables = Effect.fn("DatabaseHttpApi.tables")(function* (ctx: {
      params: { connectionID: string }
      query: { database?: string }
    }) {
      return yield* database.tables(ctx.params.connectionID, ctx.query.database).pipe(Effect.mapError(fail))
    })

    const columns = Effect.fn("DatabaseHttpApi.columns")(function* (ctx: {
      params: { connectionID: string; table: string }
      query: { database?: string }
    }) {
      return yield* database
        .columns(ctx.params.connectionID, ctx.params.table, ctx.query.database)
        .pipe(Effect.mapError(fail))
    })

    return handlers
      .handle("listConnections", listConnections)
      .handle("saveConnection", saveConnection)
      .handle("removeConnection", removeConnection)
      .handle("testConnection", testConnection)
      .handle("query", query)
      .handle("tables", tables)
      .handle("columns", columns)
  }),
)
