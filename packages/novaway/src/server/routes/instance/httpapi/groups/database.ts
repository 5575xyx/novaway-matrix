import * as Db from "@/database/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/database"

/** 带错误信息的 400：SQL 写错时要让用户看到数据库返回的原因。 */
export class DatabaseError extends Schema.ErrorClass<DatabaseError>("DatabaseError")(
  {
    name: Schema.Literal("DatabaseError"),
    data: Schema.Struct({ message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export const databaseError = (message: string) => new DatabaseError({ name: "DatabaseError", data: { message } })

export const DatabasePaths = {
  connections: root,
  connection: `${root}/connections/:connectionID`,
  test: `${root}/connections/:connectionID/test`,
  query: `${root}/query`,
  tables: `${root}/connections/:connectionID/tables`,
  columns: `${root}/connections/:connectionID/tables/:table/columns`,
} as const

export const QueryPayload = Schema.Struct({
  connectionID: Schema.String,
  sql: Schema.String,
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  /** 目标数据库 / schema；省略时用连接上保存的数据库。Redis 传逻辑库序号。 */
  database: Schema.optional(Schema.String),
  /** true 时拒绝写语句（Agent 默认只读）。 */
  readOnly: Schema.optional(Schema.Boolean),
})

/** 连接内的数据库（Redis 是逻辑库序号）在 URL 上以 query 传入。 */
const TargetDatabaseQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  database: Schema.optional(Schema.String),
})

export const DatabaseApi = HttpApi.make("database").add(
  HttpApiGroup.make("database")
    .add(
      HttpApiEndpoint.get("listConnections", DatabasePaths.connections, {
        query: WorkspaceRoutingQuery,
        success: described(Schema.Array(Db.ConnectionSummary), "Database connections"),
        error: [DatabaseError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "database.list",
          summary: "List database connections",
          description:
            "Saved connections. Passwords are never returned; use hasPassword to tell whether one is stored.",
        }),
      ),
      HttpApiEndpoint.post("saveConnection", DatabasePaths.connections, {
        query: WorkspaceRoutingQuery,
        payload: Db.ConnectionInput,
        success: described(Db.ConnectionSummary, "Saved connection"),
        error: [DatabaseError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "database.save",
          summary: "Create or update a connection",
          description: "Same name updates the existing connection. Omit password to keep the stored one.",
        }),
      ),
      HttpApiEndpoint.delete("removeConnection", DatabasePaths.connection, {
        params: { connectionID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Schema.Boolean, "Removed"),
        error: [DatabaseError],
      }),
      HttpApiEndpoint.post("testConnection", DatabasePaths.test, {
        params: { connectionID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: described(Db.TestResult, "Connection test result"),
        error: [DatabaseError],
      }),
      HttpApiEndpoint.post("query", DatabasePaths.query, {
        query: WorkspaceRoutingQuery,
        payload: QueryPayload,
        success: described(Db.QueryResult, "Query result"),
        error: [DatabaseError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "database.query",
          summary: "Run SQL",
          description:
            "Structured rows with pagination. SELECT statements without LIMIT are wrapped in a LIMIT/OFFSET subquery.",
        }),
      ),
      HttpApiEndpoint.get("tables", DatabasePaths.tables, {
        params: { connectionID: Schema.String },
        query: TargetDatabaseQuery,
        success: described(Schema.Array(Db.TableInfo), "Tables"),
        error: [DatabaseError],
      }),
      HttpApiEndpoint.get("columns", DatabasePaths.columns, {
        params: { connectionID: Schema.String, table: Schema.String },
        query: TargetDatabaseQuery,
        success: described(Schema.Array(Db.ColumnInfo), "Columns"),
        error: [DatabaseError],
      }),
    )
    .annotateMerge(OpenApi.annotations({ title: "database", description: "Local database connections and queries." }))
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)

export * as DatabaseGroup from "./database"
