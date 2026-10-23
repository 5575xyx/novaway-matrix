/**
 * MySQL / MariaDB 驱动（`mysql2/promise`，纯 JS）。
 */
import mysql from "mysql2/promise"
import type { ColumnInfo, TableInfo } from "../schema"
import { capRows, pageable, wrapForPage } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const pools = new Map<string, mysql.Pool>()

function defaultPort(type: ResolvedConnection["type"]) {
  // StarRocks / Doris 的 MySQL 协议端口是 9030，而不是 3306。
  return type === "starrocks" || type === "doris" ? 9030 : 3306
}

function poolKey(connection: ResolvedConnection) {
  return [
    connection.host ?? "127.0.0.1",
    connection.port ?? defaultPort(connection.type),
    connection.database ?? "",
    connection.user ?? "",
  ].join("|")
}

function pool(connection: ResolvedConnection) {
  const key = poolKey(connection)
  const existing = pools.get(key)
  if (existing) return existing
  const created = mysql.createPool({
    host: connection.host ?? "127.0.0.1",
    port: connection.port ?? defaultPort(connection.type),
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    idleTimeout: 5 * 60_000,
    connectTimeout: 10_000,
    // BIGINT / DECIMAL 以字符串返回，避免超出 JS 安全整数丢精度。
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  })
  pools.set(key, created)
  return created
}

function normalize(value: unknown) {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return "0x" + value.toString("hex")
  if (typeof value === "bigint") return value.toString()
  return value
}

export async function test(connection: ResolvedConnection) {
  const [rows] = await pool(connection).query<mysql.RowDataPacket[]>("select version() as version")
  return String(rows[0]?.version ?? "mysql")
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = pageable(sql) ? wrapForPage(sql, options.limit + 1, options.offset) : sql
  const [result, fields] = await pool(connection).query(text)
  if (Array.isArray(result)) {
    const columns = (fields ?? []).map((field) => field.name)
    const raw = (result as mysql.RowDataPacket[]).map((row) =>
      columns.map((column) => normalize((row as Record<string, unknown>)[column])),
    )
    const { rows, truncated } = capRows(raw, options.limit)
    return { columns, rows, truncated }
  }
  const header = result as mysql.ResultSetHeader
  return { columns: [], rows: [], truncated: false, affected: header.affectedRows }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const [rows] = await pool(connection).query<mysql.RowDataPacket[]>(
    "select table_schema, table_name, table_type from information_schema.tables " +
      "where table_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys') " +
      (connection.database ? "and table_schema = ? " : "") +
      "order by table_schema, table_name",
    connection.database ? [connection.database] : [],
  )
  return rows.map((row) => ({
    name: String(row.TABLE_NAME ?? ""),
    schema: String(row.TABLE_SCHEMA ?? ""),
    kind: String(row.TABLE_TYPE ?? "").includes("VIEW") ? "view" : "table",
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const [rows] = await pool(connection).query<mysql.RowDataPacket[]>(
    "select column_name, column_type, is_nullable, column_default, column_key from information_schema.columns " +
      "where table_name = ? " +
      (connection.database ? "and table_schema = ? " : "") +
      "order by ordinal_position",
    connection.database ? [table, connection.database] : [table],
  )
  return rows.map((row) => ({
    name: String(row.COLUMN_NAME ?? ""),
    type: String(row.COLUMN_TYPE ?? ""),
    nullable: String(row.IS_NULLABLE ?? "").toUpperCase() === "YES",
    ...(row.COLUMN_DEFAULT ? { default: String(row.COLUMN_DEFAULT) } : {}),
    ...(String(row.COLUMN_KEY ?? "") === "PRI" ? { primary: true } : {}),
  }))
}

export async function close(connection: ResolvedConnection) {
  const key = poolKey(connection)
  const existing = pools.get(key)
  if (!existing) return
  pools.delete(key)
  await existing.end().catch(() => undefined)
}
