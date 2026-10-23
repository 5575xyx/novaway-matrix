/**
 * 数据库服务：连接的增删改查 + 查询执行。
 *
 * 与旧的 dbx MCP 相比：
 * - 结果**结构化**（columns / rows / truncated），不再压成 markdown；
 * - 支持真正的分页（SELECT 自动包一层 LIMIT/OFFSET）；
 * - 密码加密落盘，API 只回 `hasPassword`；
 * - 纯 JS 驱动 + Node 内置 sqlite，**没有原生模块 ABI 问题**。
 */
import { Context, Effect, Layer } from "effect"
import * as clickhouse from "./drivers/clickhouse"
import * as mongodb from "./drivers/mongodb"
import * as mysql from "./drivers/mysql"
import * as postgres from "./drivers/postgres"
import * as redis from "./drivers/redis"
import * as rqlite from "./drivers/rqlite"
import * as sqlite from "./drivers/sqlite"
import { assertReadOnly } from "./drivers/sql"
import type { Driver, ResolvedConnection } from "./drivers/types"
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ColumnInfo,
  type ConnectionInput,
  type ConnectionSummary,
  type QueryResult,
  type TableInfo,
  type TestResult,
} from "./schema"
import * as Store from "./store"
import { closeConnectionTunnels, withTunnel } from "./tunnel"

/**
 * `mariadb` / `starrocks` / `doris` 都讲 MySQL 协议，直接复用 mysql2 驱动；
 * 其余类型与 `drivers/` 下的模块一一对应。
 */
const drivers: Record<ResolvedConnection["type"], Driver> = {
  postgres,
  mysql,
  mariadb: mysql,
  sqlite,
  rqlite,
  redis,
  mongodb,
  clickhouse,
  starrocks: mysql,
  doris: mysql,
}

function driver(connection: ResolvedConnection) {
  return drivers[connection.type]
}

export type QueryInput = {
  connectionID: string
  sql: string
  limit?: number
  offset?: number
  /** 目标数据库 / schema；省略时用连接上保存的数据库。Redis 传逻辑库序号。 */
  database?: string
  /** true 时拒绝任何写语句（Agent 调用默认开启）。 */
  readOnly?: boolean
}

function toResolved(connection: Awaited<ReturnType<typeof Store.resolveConnection>>): ResolvedConnection {
  if (!connection) throw new Error("连接不存在")
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    file: connection.file,
    ssl: connection.ssl,
    db: connection.db,
    httpPath: connection.httpPath,
    ssh: connection.ssh,
  }
}

/** 解析连接并（如果配置了 SSH）建立本地转发。 */
function connect(connection: Awaited<ReturnType<typeof Store.resolveConnection>>) {
  return withTunnel(toResolved(connection))
}

/**
 * 切到指定数据库。
 *
 * 驱动都按 `ResolvedConnection.database` 建池/选库，所以这里只改写该字段，
 * 不必给每个驱动新增参数。
 */
function useDatabase(connection: ResolvedConnection, database?: string): ResolvedConnection {
  const name = database?.trim()
  if (!name) return connection
  return { ...connection, database: name }
}

export interface Interface {
  readonly list: () => Effect.Effect<ConnectionSummary[]>
  readonly save: (input: ConnectionInput) => Effect.Effect<ConnectionSummary>
  readonly remove: (id: string) => Effect.Effect<boolean>
  readonly test: (id: string) => Effect.Effect<TestResult>
  readonly query: (input: QueryInput) => Effect.Effect<QueryResult, Error>
  readonly tables: (id: string, database?: string) => Effect.Effect<TableInfo[]>
  readonly columns: (id: string, table: string, database?: string) => Effect.Effect<ColumnInfo[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const list = Effect.fn("Database.list")(() => Effect.promise(() => Store.listConnections()))

    const save = Effect.fn("Database.save")((input: ConnectionInput) =>
      Effect.promise(() => Store.saveConnection(input)),
    )

    const remove = Effect.fn("Database.remove")((id: string) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.promise(() => Store.resolveConnection(id))
        if (resolved) {
          // 走隧道的连接池以本地转发端口为 key，必须先还原出同一个 host/port 再关。
          yield* Effect.promise(async () => {
            const target = toResolved(resolved)
            const tunneled = await withTunnel(target).catch(() => target)
            await driver(tunneled).close(tunneled)
            closeConnectionTunnels(target.id)
          }).pipe(Effect.catch(() => Effect.void))
        }
        return yield* Effect.promise(() => Store.removeConnection(id))
      }),
    )

    const test = Effect.fn("Database.test")((id: string) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.promise(() => Store.resolveConnection(id))
        if (!resolved) return { ok: false, message: "连接不存在" }
        const result = yield* Effect.tryPromise({
          try: async () => {
            const target = await connect(resolved)
            return { ok: true, message: await driver(target).test(target) } as TestResult
          },
          catch: (error) => (error instanceof Error ? error.message : String(error)),
        }).pipe(Effect.match({ onSuccess: (value) => value, onFailure: (message) => ({ ok: false, message }) }))
        return result
      }),
    )

    const query = Effect.fn("Database.query")((input: QueryInput) =>
      Effect.gen(function* () {
        const sql = input.sql.trim()
        if (!sql) throw new Error("SQL 不能为空")
        if (input.readOnly) assertReadOnly(sql)

        const resolved = yield* Effect.promise(() => Store.resolveConnection(input.connectionID))
        if (!resolved) throw new Error("连接不存在")
        const target = useDatabase(yield* Effect.promise(() => connect(resolved)), input.database)

        const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
        const offset = Math.max(input.offset ?? 0, 0)
        const started = Date.now()

        const raw = yield* Effect.tryPromise({
          try: () => driver(target).query(target, sql, { limit, offset, readOnly: input.readOnly }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })

        return {
          columns: raw.columns,
          rows: raw.rows,
          rowCount: raw.rows.length,
          truncated: Boolean((raw as { truncated?: boolean }).truncated),
          ...(raw.affected !== undefined ? { affected: raw.affected } : {}),
          durationMs: Date.now() - started,
          sql,
        } satisfies QueryResult
      }),
    )

    const tables = Effect.fn("Database.tables")((id: string, database?: string) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.promise(() => Store.resolveConnection(id))
        if (!resolved) throw new Error("连接不存在")
        const target = useDatabase(yield* Effect.promise(() => connect(resolved)), database)
        return yield* Effect.promise(() => driver(target).listTables(target))
      }),
    )

    const columns = Effect.fn("Database.columns")((id: string, table: string, database?: string) =>
      Effect.gen(function* () {
        const resolved = yield* Effect.promise(() => Store.resolveConnection(id))
        if (!resolved) throw new Error("连接不存在")
        const target = useDatabase(yield* Effect.promise(() => connect(resolved)), database)
        const describe = driver(target).describeTable
        if (!describe) throw new Error("该连接类型不支持查看表结构")
        return yield* Effect.promise(() => describe(target, table))
      }),
    )

    return Service.of({ list, save, remove, test, query, tables, columns })
  }),
)

export const defaultLayer = layer

export * as Database from "./service"
