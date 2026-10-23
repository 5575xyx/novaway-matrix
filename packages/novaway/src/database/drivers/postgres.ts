/**
 * PostgreSQL 驱动。
 *
 * 连接池按「连接」缓存复用，避免每次查询重新握手；空闲 5 分钟后释放。
 */
import pg from "pg"
import type { ColumnInfo, TableInfo } from "../schema"
import { capRows, pageable, wrapForPage } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const pools = new Map<string, pg.Pool>()

function poolKey(connection: ResolvedConnection) {
  return [
    connection.host ?? "127.0.0.1",
    connection.port ?? 5432,
    connection.database ?? "",
    connection.user ?? "",
  ].join("|")
}

function pool(connection: ResolvedConnection) {
  const key = poolKey(connection)
  const existing = pools.get(key)
  if (existing) return existing
  const created = new pg.Pool({
    host: connection.host ?? "127.0.0.1",
    port: connection.port ?? 5432,
    database: connection.database,
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    idleTimeoutMillis: 5 * 60_000,
    connectionTimeoutMillis: 10_000,
    application_name: "novaway",
  })
  // 空闲连接报错不应拖垮进程；下次查询会重新建连。
  created.on("error", () => pools.delete(key))
  pools.set(key, created)
  return created
}

/** 只把可 JSON 化的值交给上层：Date → ISO，Buffer → hex，BigInt → number/string。 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return "0x" + value.toString("hex")
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (Array.isArray(value)) return value.map(normalize)
  return value
}

export async function test(connection: ResolvedConnection) {
  const client = await pool(connection).connect()
  try {
    const result = await client.query("select version() as version")
    return String(result.rows[0]?.version ?? "postgres")
  } finally {
    client.release()
  }
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = pageable(sql) ? wrapForPage(sql, options.limit + 1, options.offset) : sql
  const client = await pool(connection).connect()
  try {
    const result = await client.query({ text, rowMode: "array" })
    const columns = result.fields.map((field) => field.name)
    const raw = (result.rows as unknown[][]).map((row) => row.map(normalize))
    const { rows, truncated } = capRows(raw, options.limit)
    return {
      columns,
      rows,
      truncated,
      ...(result.command !== "SELECT" && result.rowCount !== null ? { affected: result.rowCount } : {}),
    }
  } finally {
    client.release()
  }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const client = await pool(connection).connect()
  try {
    const result = await client.query<{ table_schema: string; table_name: string; table_type: string }>(
      "select table_schema, table_name, table_type from information_schema.tables " +
        "where table_catalog = current_database() " +
        "and table_schema not in ('pg_catalog', 'information_schema') order by table_schema, table_name",
    )
    return result.rows.map((row) => ({
      name: row.table_name,
      schema: row.table_schema,
      kind: row.table_type === "VIEW" ? "view" : "table",
    }))
  } finally {
    client.release()
  }
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const client = await pool(connection).connect()
  try {
    const columns = await client.query<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(
      "select column_name, data_type, is_nullable, column_default from information_schema.columns " +
        "where table_catalog = current_database() and table_name = $1 order by ordinal_position",
      [table],
    )
    const keys = await client.query<{ column_name: string }>(
      "select kcu.column_name from information_schema.table_constraints tc " +
        "join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name " +
        "and tc.table_schema = kcu.table_schema " +
        "where tc.constraint_type = 'PRIMARY KEY' and tc.table_catalog = current_database() and tc.table_name = $1",
      [table],
    )
    const primary = new Set(keys.rows.map((row) => row.column_name))
    return columns.rows.map((row) => ({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      ...(row.column_default ? { default: row.column_default } : {}),
      ...(primary.has(row.column_name) ? { primary: true } : {}),
    }))
  } finally {
    client.release()
  }
}

export async function close(connection: ResolvedConnection) {
  const key = poolKey(connection)
  const existing = pools.get(key)
  if (!existing) return
  pools.delete(key)
  await existing.end().catch(() => undefined)
}
