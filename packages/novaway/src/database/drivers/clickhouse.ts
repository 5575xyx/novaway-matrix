/**
 * ClickHouse 驱动（HTTP 接口，@clickhouse/client）。
 *
 * 表与列都在 system.tables / system.columns 里，直接查即可；
 * ClickHouse 的 HTTP 接口一次只接受一条语句。
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client"
import type { ColumnInfo, TableInfo } from "../schema"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const clients = new Map<string, ClickHouseClient>()

function keyOf(connection: ResolvedConnection) {
  return [
    connection.host ?? "127.0.0.1",
    connection.port ?? 8123,
    connection.database ?? "default",
    connection.user ?? "",
  ].join("|")
}

function client(connection: ResolvedConnection) {
  const key = keyOf(connection)
  const existing = clients.get(key)
  if (existing) return existing
  const scheme = connection.ssl ? "https" : "http"
  const created = createClient({
    url: scheme + "://" + (connection.host ?? "127.0.0.1") + ":" + (connection.port ?? 8123),
    username: connection.user || undefined,
    password: connection.password || undefined,
    database: connection.database || "default",
    request_timeout: 30_000,
  })
  clients.set(key, created)
  return created
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (value instanceof Date) return value.toISOString()
  return value
}

function single(sql: string) {
  const text = sql.trim().replace(/;\s*$/, "")
  if (text.includes(";")) throw new Error("ClickHouse 一次只能执行一条语句")
  return text
}

export async function test(connection: ResolvedConnection) {
  const result = await client(connection).query({ query: "select version() as version", format: "JSON" })
  const payload = (await result.json()) as { data?: Array<{ version: string }> }
  return "clickhouse " + (payload.data?.[0]?.version ?? "?")
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = single(sql)
  const read = /^\s*(select|with|show|describe|explain)\b/i.test(text)
  if (!read) {
    await client(connection).command({ query: text })
    return { columns: [], rows: [], truncated: false }
  }
  const paged = /\blimit\b/i.test(text) ? text : text + " LIMIT " + (options.limit + 1) + " OFFSET " + options.offset
  const result = await client(connection).query({ query: paged, format: "JSON" })
  const payload = (await result.json()) as {
    meta?: Array<{ name: string }>
    data?: Array<Record<string, unknown>>
  }
  const columns = (payload.meta ?? []).map((item) => item.name)
  const rows = (payload.data ?? []).map((row) => columns.map((column) => normalize(row[column])))
  const truncated = rows.length > options.limit
  return { columns, rows: truncated ? rows.slice(0, options.limit) : rows, truncated }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const database = connection.database || "default"
  const result = await client(connection).query({
    query: "select name, engine from system.tables where database = {db:String} order by name",
    query_params: { db: database },
    format: "JSON",
  })
  const payload = (await result.json()) as { data?: Array<{ name: string; engine: string }> }
  return (payload.data ?? []).map((row) => ({
    name: row.name,
    kind: row.engine === "View" || row.engine === "MaterializedView" ? "view" : "table",
    schema: database,
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const database = connection.database || "default"
  const result = await client(connection).query({
    query:
      "select name, type, default_expression from system.columns " +
      "where database = {db:String} and table = {table:String} order by position",
    query_params: { db: database, table },
    format: "JSON",
  })
  const payload = (await result.json()) as {
    data?: Array<{ name: string; type: string; default_expression: string }>
  }
  return (payload.data ?? []).map((row) => ({
    name: row.name,
    type: row.type,
    // ClickHouse 列默认不可空，Nullable(T) 才是可空。
    nullable: row.type.startsWith("Nullable("),
    ...(row.default_expression ? { default: row.default_expression } : {}),
  }))
}

export async function close(connection: ResolvedConnection) {
  const key = keyOf(connection)
  const existing = clients.get(key)
  if (!existing) return
  clients.delete(key)
  await existing.close().catch(() => undefined)
}
