// dbx MCP 工具的调用封装:桌面端"数据库"页的同一套工具,这里走服务端的
// /experimental/tool/call 通道(SDK 原始客户端)。工具输出是 markdown 表格,
// 解析规则在 markdown-table.ts;列名兼容逻辑原样搬自桌面端 database.tsx。
import type { NovawayClient } from "@novaway/sdk-v2-latest/v2"
import { rawClient } from "./raw-client"
import { extractResultText, parseMarkdownTable } from "./markdown-table"

// 和 checkpoint/goal 面板同一招:直接用 hey-api 原始客户端打 experimental 通道。
// directory 走 query,和桌面端 callTool 的行为一致。
async function callTool(client: NovawayClient, directory: string, toolId: string, args: Record<string, unknown>) {
  const res = await rawClient(client).post({
    url: `/experimental/tool/call?directory=${encodeURIComponent(directory)}`,
    body: { toolId, arguments: args },
  })
  if (res.error) {
    const message = typeof res.error === "object" && res.error !== null && "message" in res.error
      ? String((res.error as { message: unknown }).message)
      : String(res.error)
    throw new Error(message || "工具调用失败")
  }
  return extractResultText(res.data)
}

export type DbConnection = {
  name: string
  type: string
  host: string
  port: number
  database?: string
}

export type DbColumnInfo = {
  name: string
  type: string
  nullable: string
  default: string
  comment: string
}

function rowsFrom(text: string): string[][] {
  return parseMarkdownTable(text).rows
}

function isMysqlLike(type: string): boolean {
  return ["mysql", "mariadb", "doris", "starrocks"].includes(type)
}

function listDatabasesSql(type: string): string | undefined {
  if (isMysqlLike(type)) {
    return "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME"
  }
  switch (type) {
    case "postgres":
    case "postgresql":
    case "redshift":
    case "clickhouse":
      return "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    case "sqlite":
    case "duckdb":
    case "h2":
      return "SHOW DATABASES"
    case "sqlserver":
      return "SELECT name FROM sys.databases ORDER BY name"
    default:
      return undefined
  }
}

function escapeIdentifier(name: string) {
  return name.includes(" ") ? `\`${name.replace(/`/g, "``")}\`` : name
}

// ---- 面板用的五个操作,一一对齐桌面端 ----

export async function dbxListConnections(client: NovawayClient, directory: string): Promise<DbConnection[]> {
  const text = await callTool(client, directory, "dbx_dbx_list_connections", {})
  return rowsFrom(text).map((row) => ({
    name: row[0] ?? "",
    type: (row[1] ?? "").toLowerCase(),
    host: row[2] ?? "",
    port: Number(row[3]) || 0,
    database: row[4] || undefined,
  }))
}

export async function dbxRemoveConnection(client: NovawayClient, directory: string, connectionName: string) {
  await callTool(client, directory, "dbx_dbx_remove_connection", { connection_name: connectionName })
}

// dbx_add_connection 的入参(可选字段留空就不传,和桌面端表单一致)。
export type DbxAddConnectionInput = {
  name: string
  db_type: string
  host: string
  port?: number
  username?: string
  password?: string
  database?: string
  ssl?: boolean
}

export async function dbxAddConnection(client: NovawayClient, directory: string, input: DbxAddConnectionInput) {
  await callTool(client, directory, "dbx_dbx_add_connection", input as Record<string, unknown>)
}

export async function dbxListDatabases(
  client: NovawayClient,
  directory: string,
  connection: DbConnection,
): Promise<string[]> {
  const sql = listDatabasesSql(connection.type)
  if (!sql) return connection.database ? [connection.database] : []
  const text = await callTool(client, directory, "dbx_dbx_execute_query", {
    connection_name: connection.name,
    sql,
    database: isMysqlLike(connection.type) ? "" : undefined,
  })
  const { rows } = parseMarkdownTable(text)
  const names = rows.map((row) => row[0]).filter((name): name is string => !!name)
  if (names.length === 0 && connection.database) return [connection.database]
  return names
}

export async function dbxListTables(
  client: NovawayClient,
  directory: string,
  connectionName: string,
  database: string,
): Promise<string[]> {
  const text = await callTool(client, directory, "dbx_dbx_list_tables", { connection_name: connectionName, database })
  return rowsFrom(text)
    .map((row) => row[0])
    .filter((name): name is string => !!name)
}

export async function dbxDescribeTable(
  client: NovawayClient,
  directory: string,
  connectionName: string,
  database: string,
  table: string,
): Promise<DbColumnInfo[]> {
  const text = await callTool(client, directory, "dbx_dbx_describe_table", {
    connection_name: connectionName,
    database,
    table,
  })
  const { headers, rows } = parseMarkdownTable(text)
  if (rows.length === 0) return []
  const get = (row: string[], names: string[]) => {
    for (const name of names) {
      const index = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase())
      if (index !== -1) return row[index] ?? ""
    }
    return ""
  }
  return rows.map((row) => ({
    name: get(row, ["column", "name", "field"]),
    type: get(row, ["type", "data_type", "datatype"]),
    nullable: get(row, ["nullable", "is_nullable", "null"]),
    default: get(row, ["default", "column_default", "default_value"]),
    comment: get(row, ["comment", "column_comment"]),
  }))
}

export async function dbxExecuteQuery(
  client: NovawayClient,
  directory: string,
  connectionName: string | undefined,
  database: string | undefined,
  sql: string,
): Promise<string> {
  return callTool(client, directory, "dbx_dbx_execute_query", {
    connection_name: connectionName,
    database,
    sql,
  })
}

export function tablePreviewSql(table: string) {
  return `SELECT * FROM ${escapeIdentifier(table)} LIMIT 100`
}
