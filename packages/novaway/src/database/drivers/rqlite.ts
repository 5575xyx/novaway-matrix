/**
 * rqlite 驱动。
 *
 * rqlite 是「SQLite + Raft 共识」的分布式版本，对外只有 HTTP 接口，
 * 因此不需要任何原生模块，纯 JS 即可连接。
 */
import type { ColumnInfo, TableInfo } from "../schema"
import { pageable, strip, wrapForPage } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

function endpoint(connection: ResolvedConnection) {
  const host = connection.host ?? "127.0.0.1"
  const port = connection.port ?? 4001
  const scheme = connection.ssl ? "https" : "http"
  const base = connection.httpPath?.trim() || ""
  return scheme + "://" + host + ":" + port + (base ? "/" + base.replace(/^\/+/, "") : "")
}

function headers(connection: ResolvedConnection) {
  const result: Record<string, string> = { "Content-Type": "application/json" }
  if (connection.user || connection.password) {
    const raw = (connection.user ?? "") + ":" + (connection.password ?? "")
    result.Authorization = "Basic " + Buffer.from(raw).toString("base64")
  }
  return result
}

type RqliteResult = {
  columns?: string[]
  values?: unknown[][]
  error?: string
  rows_affected?: number
}

async function call(connection: ResolvedConnection, path: string, statements: string[]) {
  const response = await fetch(endpoint(connection) + path, {
    method: "POST",
    headers: headers(connection),
    body: JSON.stringify(statements),
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await response.json().catch(() => ({}))) as { results?: RqliteResult[]; error?: string }
  if (!response.ok) throw new Error(body.error || "rqlite HTTP " + response.status)
  const first = body.results?.[0]
  if (first?.error) throw new Error(first.error)
  return first ?? {}
}

export async function test(connection: ResolvedConnection) {
  const result = await call(connection, "/db/query?level=none", ["select sqlite_version() as version"])
  return "rqlite (sqlite " + String(result.values?.[0]?.[0] ?? "?") + ")"
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const read = /^\s*(select|with|pragma|explain)\b/i.test(strip(sql))
  if (!read) {
    const result = await call(connection, "/db/execute", [sql])
    return { columns: [], rows: [], truncated: false, affected: Number(result.rows_affected ?? 0) }
  }
  const text = pageable(sql) ? wrapForPage(sql, options.limit + 1, options.offset) : sql
  const result = await call(connection, "/db/query", [text])
  const columns = result.columns ?? []
  const rows = result.values ?? []
  const truncated = rows.length > options.limit
  return { columns, rows: truncated ? rows.slice(0, options.limit) : rows, truncated }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const result = await call(connection, "/db/query", [
    "select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name",
  ])
  return (result.values ?? []).map((row) => ({
    name: String(row[0] ?? ""),
    kind: String(row[1] ?? "table"),
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const result = await call(connection, "/db/query", ["pragma table_info(" + quote(table) + ")"])
  const columns = result.columns ?? []
  const at = (name: string) => columns.findIndex((column) => column.toLowerCase() === name)
  const cell = (row: unknown[], name: string) => {
    const index = at(name)
    return index === -1 ? undefined : row[index]
  }
  return (result.values ?? []).map((row) => ({
    name: String(cell(row, "name") ?? ""),
    type: String(cell(row, "type") ?? "any"),
    nullable: Number(cell(row, "notnull") ?? 0) === 0,
    ...(cell(row, "dflt_value") != null ? { default: String(cell(row, "dflt_value")) } : {}),
    ...(Number(cell(row, "pk") ?? 0) > 0 ? { primary: true } : {}),
  }))
}

export function quote(name: string) {
  return String.fromCharCode(34) + name.replace(/"/g, String.fromCharCode(34, 34)) + String.fromCharCode(34)
}

export async function close() {
  // HTTP 无连接池可释放。
}
