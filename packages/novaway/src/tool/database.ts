/**
 * 数据库工具：把「数据库」页面里配置的连接暴露给 Agent。
 *
 * 之前 Agent 只能通过内置的 dbx MCP server 访问数据库，而它自己的连接存储
 * （`userData/dbx/dbx.db`）与页面里的连接（`data/database/connections.json`）
 * 是两套东西 —— 用户在页面里配了半天，Agent 根本看不见。这些工具直接复用
 * `@/database` 服务，两边共用同一份连接，结果也是结构化的（不压成 markdown）。
 *
 * 安全默认：查询默认只读（`assertReadOnly`），写语句必须显式 `allowWrite` 并走权限询问。
 */
import { Database } from "@/database"
import type { ConnectionSummary } from "@/database/schema"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

type DatabaseMetadata = {
  connectionID?: string
  connectionName?: string
  rowCount?: number
  truncated?: boolean
  durationMs?: number
  sql?: string
}

const ConnectionID = Schema.String.annotate({
  description:
    "Connection id returned by database_list. Names are accepted too - they are resolved against the saved connections.",
})

const DatabaseTarget = Schema.optional(Schema.String).annotate({
  description: "Target database / schema (Postgres switches database, MySQL uses schema, Oracle uses service name).",
})

/** 把结果渲成紧凑的文本表：Agent 读起来比 JSON 省 token，也不会把列名塞成键。 */
export function renderTable(columns: readonly string[], rows: readonly (readonly unknown[])[], limit = 100) {
  if (columns.length === 0) return "(no result set)"
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "NULL"
    const text = typeof value === "object" ? JSON.stringify(value) : String(value)
    return text.replaceAll("|", "\|").replaceAll("\n", " ")
  }
  const shown = rows.slice(0, limit)
  const lines = [
    "| " + columns.join(" | ") + " |",
    "| " + columns.map(() => "---").join(" | ") + " |",
    ...shown.map((row) => "| " + row.map(cell).join(" | ") + " |"),
  ]
  if (rows.length > shown.length) lines.push(`... ${rows.length - shown.length} more rows omitted`)
  return lines.join(String.fromCharCode(10))
}

/** 连接名或 id 都能解析；重名时优先 id。 */
export function resolveConnection(connections: readonly ConnectionSummary[], target: string) {
  return connections.find((item) => item.id === target) ?? connections.find((item) => item.name === target)
}

function describeConnection(connection: ConnectionSummary) {
  const where = connection.file ?? [connection.host, connection.port].filter(Boolean).join(":")
  return [
    `- ${connection.name} (id: ${connection.id})`,
    `  type: ${connection.type}`,
    where ? `  target: ${where}${connection.database ? "/" + connection.database : ""}` : undefined,
    connection.user ? `  user: ${connection.user}` : undefined,
    connection.sshEnabled ? `  ssh: ${connection.sshHost}` : undefined,
    `  password: ${connection.hasPassword ? "saved" : "not saved"}`,
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10))
}

const ListParameters = Schema.Struct({})

export const DatabaseListTool = Tool.define<typeof ListParameters, DatabaseMetadata, Database.Service>(
  "database_list",
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description: [
        "List the database connections the user saved in the Database page.",
        "Each connection has an id, a type (postgres/mysql/sqlite/redis/...), a target and whether a password is stored.",
        "Call this first: every other database_* tool takes a connectionID from here.",
        "Passwords are never returned.",
      ].join(" "),
      parameters: ListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (_params: Schema.Schema.Type<typeof ListParameters>) =>
        Effect.gen(function* () {
          const connections = yield* database.list()
          return {
            title: "Database connections",
            metadata: {},
            output:
              connections.length === 0
                ? "No database connections yet. Ask the user to add one in the Database page before querying."
                : connections.map(describeConnection).join(String.fromCharCode(10)),
          }
        }),
    }
  }),
)

const QueryParameters = Schema.Struct({
  connectionID: ConnectionID,
  sql: Schema.String.annotate({
    description:
      "SQL to execute. SELECT/WITH statements are paginated automatically. Redis takes a shell-style command (GET key).",
  }),
  database: DatabaseTarget,
  limit: Schema.optional(Schema.Number).annotate({ description: "Rows per page (default 100, max 1000)." }),
  offset: Schema.optional(Schema.Number).annotate({ description: "Pagination offset (default 0)." }),
  allowWrite: Schema.optional(Schema.Boolean).annotate({
    description:
      "Set to true to allow INSERT/UPDATE/DELETE/DDL. Queries are read-only by default and writes are rejected without this.",
  }),
})

type QueryInput = Schema.Schema.Type<typeof QueryParameters>

export const DatabaseQueryTool = Tool.define<typeof QueryParameters, DatabaseMetadata, Database.Service>(
  "database_query",
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description: [
        "Run SQL against one of the user's saved database connections.",
        "Read-only by default: SELECT/WITH run with real pagination (LIMIT/OFFSET or OFFSET/FETCH is pushed down to the server).",
        "Writes (INSERT/UPDATE/DELETE/DDL) are rejected unless allowWrite=true, which also asks the user for permission.",
        "Use database_tables and database_describe to learn the schema before writing a query.",
      ].join(" "),
      parameters: QueryParameters,
      capabilities: {
        readOnly: (args: unknown) => !(args as QueryInput).allowWrite,
        concurrencySafe: (args: unknown) => !(args as QueryInput).allowWrite,
      },
      execute: (params: QueryInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const connections = yield* database.list()
          const connection = resolveConnection(connections, params.connectionID)
          if (!connection) {
            throw new Error(
              `Connection not found: ${params.connectionID}. Available: ${
                connections.map((item) => item.name).join(", ") || "(none)"
              }`,
            )
          }
          if (params.allowWrite) {
            yield* ctx.ask({
              permission: "database",
              patterns: [connection.name],
              always: [connection.name],
              metadata: { connection: connection.name, sql: params.sql.slice(0, 200) },
            })
          }
          const result = yield* database.query({
            connectionID: connection.id,
            sql: params.sql,
            database: params.database,
            limit: params.limit,
            offset: params.offset,
            readOnly: !params.allowWrite,
          })
          const summary = [
            `${connection.name} - ${result.rowCount} row(s)${result.truncated ? " (truncated)" : ""} in ${
              result.durationMs
            }ms`,
            result.affected !== undefined ? `affected: ${result.affected}` : undefined,
            result.sql !== params.sql.trim() ? `executed: ${result.sql}` : undefined,
          ]
            .filter(Boolean)
            .join(String.fromCharCode(10))
          return {
            title: `${connection.name} - ${result.rowCount} row(s)`,
            metadata: {
              connectionID: connection.id,
              connectionName: connection.name,
              rowCount: result.rowCount,
              truncated: result.truncated,
              durationMs: result.durationMs,
              sql: result.sql,
            },
            output:
              result.columns.length === 0
                ? summary
                : summary + String.fromCharCode(10, 10) + renderTable(result.columns, result.rows),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const TablesParameters = Schema.Struct({
  connectionID: ConnectionID,
  database: DatabaseTarget,
})

export const DatabaseTablesTool = Tool.define<typeof TablesParameters, DatabaseMetadata, Database.Service>(
  "database_tables",
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description:
        "List tables and views in a saved connection (schema-qualified when the database has schemas). Read-only.",
      parameters: TablesParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof TablesParameters>) =>
        Effect.gen(function* () {
          const connections = yield* database.list()
          const connection = resolveConnection(connections, params.connectionID)
          if (!connection) throw new Error(`Connection not found: ${params.connectionID}`)
          const tables = yield* database.tables(connection.id, params.database)
          return {
            title: `${connection.name} - ${tables.length} table(s)`,
            metadata: { connectionID: connection.id, connectionName: connection.name },
            output:
              tables.length === 0
                ? "(no tables)"
                : tables
                    .map((table) => `${table.schema ? table.schema + "." : ""}${table.name}  [${table.kind}]`)
                    .join(String.fromCharCode(10)),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const DescribeParameters = Schema.Struct({
  connectionID: ConnectionID,
  table: Schema.String.annotate({
    description: "Table or view name; use schema.table when it is not in the default schema.",
  }),
  database: DatabaseTarget,
})

export const DatabaseDescribeTool = Tool.define<typeof DescribeParameters, DatabaseMetadata, Database.Service>(
  "database_describe",
  Effect.gen(function* () {
    const database = yield* Database.Service
    return {
      description: "Show the columns of one table (name, type, nullable, default, primary key). Read-only.",
      parameters: DescribeParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof DescribeParameters>) =>
        Effect.gen(function* () {
          const connections = yield* database.list()
          const connection = resolveConnection(connections, params.connectionID)
          if (!connection) throw new Error(`Connection not found: ${params.connectionID}`)
          const columns = yield* database.columns(connection.id, params.table, params.database)
          return {
            title: `${connection.name} - ${params.table}`,
            metadata: { connectionID: connection.id, connectionName: connection.name },
            output:
              columns.length === 0
                ? "(no columns)"
                : columns
                    .map(
                      (column) =>
                        `${column.name}  ${column.type}${column.nullable ? "" : " NOT NULL"}${
                          column.primary ? "  PK" : ""
                        }${column.default ? "  default " + column.default : ""}`,
                    )
                    .join(String.fromCharCode(10)),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
