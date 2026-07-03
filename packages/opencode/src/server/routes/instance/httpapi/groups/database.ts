import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

export const DatabaseTestPayload = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
})

export const DatabaseTestResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  version: Schema.optional(Schema.String),
  pingMs: Schema.optional(Schema.Number),
})

export const DatabaseListResult = Schema.Struct({
  databases: Schema.Array(Schema.String),
})

export const DatabaseExecutePayload = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
  sql: Schema.String,
})

export const DatabaseExecuteResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  columns: Schema.optional(Schema.Array(Schema.String)),
  rows: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  affectedRows: Schema.optional(Schema.Number),
})

export const DatabaseTablesPayload = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
})

export const DatabaseTablesResult = Schema.Struct({
  tables: Schema.Array(Schema.String),
})

export const DatabaseColumnsPayload = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
  table: Schema.String,
})

export const DatabaseColumnInfo = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  nullable: Schema.Boolean,
  key: Schema.optional(Schema.String),
  defaultValue: Schema.optional(Schema.String),
  comment: Schema.optional(Schema.String),
})

export const DatabaseColumnsResult = Schema.Struct({
  columns: Schema.Array(DatabaseColumnInfo),
})

export const DatabaseQueryPayload = Schema.Struct({
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
  sql: Schema.String,
})

export const DatabaseQueryResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  total: Schema.Number,
})

export const DatabasePaths = {
  test: "/database/test",
  list: "/database/list",
  execute: "/database/execute",
  tables: "/database/tables",
  columns: "/database/columns",
  query: "/database/query",
  saveConnections: "/database/connections",
  loadConnections: "/database/connections",
} as const

export const DatabaseConnectionSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  type: Schema.Union([
    Schema.Literal("mysql"),
    Schema.Literal("postgresql"),
    Schema.Literal("sqlite"),
    Schema.Literal("sqlserver"),
    Schema.Literal("mariadb"),
  ]),
  host: Schema.String,
  port: Schema.Number,
  user: Schema.String,
  password: Schema.String,
  database: Schema.String,
})

export const DatabaseSaveConnectionsPayload = Schema.Struct({
  connections: Schema.Array(DatabaseConnectionSchema),
})

export const DatabaseConnectionsResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
})

export const DatabaseApi = HttpApi.make("database")
  .add(
    HttpApiGroup.make("database")
      .add(
        HttpApiEndpoint.post("test", DatabasePaths.test, {
          payload: DatabaseTestPayload,
          success: described(DatabaseTestResult, "Database connection test result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.test",
            summary: "Test database connection",
            description: "Test a database connection using the appropriate CLI tool and return the result.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("list", DatabasePaths.list, {
          payload: DatabaseTestPayload,
          success: described(DatabaseListResult, "List of database names"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.list",
            summary: "List databases on server",
            description: "Connect to a database server and list all available databases.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("execute", DatabasePaths.execute, {
          payload: DatabaseExecutePayload,
          success: described(DatabaseExecuteResult, "SQL execution result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.execute",
            summary: "Execute SQL query",
            description: "Execute a SQL query on the connected database and return the result.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("tables", DatabasePaths.tables, {
          payload: DatabaseTablesPayload,
          success: described(DatabaseTablesResult, "List of table names"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.tables",
            summary: "List tables in database",
            description: "List all tables in the specified database.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("columns", DatabasePaths.columns, {
          payload: DatabaseColumnsPayload,
          success: described(DatabaseColumnsResult, "Table column definitions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.columns",
            summary: "Get table columns",
            description: "Get column definitions for a specific table.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("query", DatabasePaths.query, {
          payload: DatabaseQueryPayload,
          success: described(DatabaseQueryResult, "Query results with columns and rows"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.query",
            summary: "Execute read query",
            description: "Execute a SELECT query and return structured results.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("saveConnections", DatabasePaths.saveConnections, {
          payload: DatabaseSaveConnectionsPayload,
          success: described(DatabaseConnectionsResult, "Save database connections"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.saveConnections",
            summary: "Save database connections",
            description: "Save database connections to project file for AI to use automatically.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("loadConnections", DatabasePaths.loadConnections, {
          success: described(DatabaseSaveConnectionsPayload, "Load database connections"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "database.loadConnections",
            summary: "Load database connections",
            description: "Load saved database connections from project file.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "database",
          description: "Database connection routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode database HttpApi",
      version: "0.0.1",
      description: "Database connection API for testing and managing database connections.",
    }),
  )
