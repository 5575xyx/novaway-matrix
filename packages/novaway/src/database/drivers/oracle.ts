/**
 * Oracle 驱动（`oracledb` 26.x 的 **Thin 模式**，纯 JS 协议实现）。
 *
 * Thin 模式不需要安装 Oracle Instant Client，也不需要随包分发 .node 二进制，
 * 因此和 Electron / 随包 Node 的 ABI 无关。限制（写进错误提示，避免用户困惑）：
 * - 只支持数据库用户名/密码认证；不支持 Wallet、LDAP、OS 认证、厚模式特性；
 * - 分页要求 Oracle 12c+（OFFSET ... FETCH NEXT）。
 */
import oracledb from "oracledb"
import type { Connection } from "oracledb"
import type { ColumnInfo, TableInfo } from "../schema"
import { capRows, pageable, wrapForPageDialect } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const connections = new Map<string, Promise<Connection>>()

function connectionKey(connection: ResolvedConnection) {
  return [connection.host ?? "", connection.port ?? 1521, connection.database ?? "", connection.user ?? ""].join("|")
}

/**
 * host/port/service 拼成 Easy Connect 串。用户如果把整串塞进 host（形如
 * `//host/service` 或 `(DESCRIPTION=...)`），原样透传。
 */
export function connectString(connection: ResolvedConnection) {
  const host = connection.host?.trim() ?? ""
  if (!host) return connection.database ?? ""
  if (/^(\/\/|\()/.test(host)) return host
  const port = connection.port ?? 1521
  const service = connection.database?.trim()
  const protocol = connection.ssl ? "tcps://" : ""
  return service ? `${protocol}${host}:${port}/${service}` : `${protocol}${host}:${port}`
}

function open(connection: ResolvedConnection) {
  const key = connectionKey(connection)
  const existing = connections.get(key)
  if (existing) return existing
  const created = oracledb.getConnection({
    user: connection.user,
    password: connection.password,
    connectString: connectString(connection),
  })
  connections.set(key, created)
  created.catch(() => connections.delete(key))
  return created
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return "0x" + value.toString("hex")
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  return value
}

function quote(value: string) {
  return "'" + value.replaceAll("'", "''") + "'"
}

/** `SCHEMA.TABLE` 拆成 owner + name；没写 schema 就是当前用户。 */
export function splitTable(table: string) {
  const [owner, ...rest] = table.split(".")
  if (rest.length === 0) return { owner: undefined, name: table.trim() }
  return { owner: owner.trim().toUpperCase(), name: rest.join(".").trim() }
}

async function run(connection: ResolvedConnection, sql: string, options: { maxRows?: number; commit?: boolean } = {}) {
  const conn = await open(connection)
  try {
    const result = await conn.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_ARRAY,
      maxRows: options.maxRows,
      autoCommit: options.commit,
    })
    return {
      columns: (result.metaData ?? []).map((column) => column.name),
      rows: (result.rows ?? []).map((row) => (Array.isArray(row) ? row.map(normalize) : [normalize(row)])),
      rowsAffected: result.rowsAffected ?? 0,
    }
  } catch (error) {
    // 连接失效时摘掉缓存，下一次查询重新握手。
    connections.delete(connectionKey(connection))
    throw error
  }
}

const SYSTEM_SCHEMAS = [
  "SYS",
  "SYSTEM",
  "OUTLN",
  "XDB",
  "MDSYS",
  "CTXSYS",
  "ORDSYS",
  "ORDDATA",
  "OLAPSYS",
  "WMSYS",
  "DBSNMP",
  "APPQOSSYS",
  "AUDSYS",
  "GSMADMIN_INTERNAL",
  "LBACSYS",
  "DVSYS",
  "DVF",
  "OJVMSYS",
  "SI_INFORMTN_SCHEMA",
  "SYSBACKUP",
  "SYSDG",
  "SYSKM",
  "SYSRAC",
]

export async function test(connection: ResolvedConnection) {
  try {
    const result = await run(connection, "select banner from v$version where rownum = 1")
    return String(result.rows[0]?.[0] ?? "oracle")
  } catch {
    const result = await run(connection, "select 'oracle' from dual")
    return String(result.rows[0]?.[0] ?? "oracle")
  }
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = pageable(sql) ? wrapForPageDialect(sql, options.limit + 1, options.offset, "fetch") : sql
  const result = await run(connection, text, { maxRows: options.limit + 1, commit: !options.readOnly })
  const { rows, truncated } = capRows(result.rows, options.limit)
  return {
    columns: result.columns,
    rows,
    truncated,
    ...(result.columns.length === 0 && result.rowsAffected > 0 ? { affected: result.rowsAffected } : {}),
  }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const result = await run(
    connection,
    "select owner, table_name, 'table' as kind from all_tables " +
      `where owner not in (${SYSTEM_SCHEMAS.map(quote).join(", ")}) ` +
      "union all " +
      "select owner, view_name, 'view' as kind from all_views " +
      `where owner not in (${SYSTEM_SCHEMAS.map(quote).join(", ")}) ` +
      "order by 1, 2",
  )
  return result.rows.map((row) => ({
    name: String(row[1] ?? ""),
    schema: String(row[0] ?? ""),
    kind: String(row[2] ?? "") === "view" ? "view" : "table",
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const { owner, name } = splitTable(table)
  const filter = owner ? `and owner = ${quote(owner)} ` : ""
  const result = await run(
    connection,
    "select column_name, data_type, data_length, data_precision, data_scale, nullable, data_default " +
      `from all_tab_columns where table_name = ${quote(name.toUpperCase())} ${filter}order by column_id`,
  )
  const keys = await run(
    connection,
    "select cc.column_name from all_constraints c " +
      "join all_cons_columns cc on c.constraint_name = cc.constraint_name and c.owner = cc.owner " +
      `where c.constraint_type = 'P' and c.table_name = ${quote(name.toUpperCase())} ` +
      (owner ? `and c.owner = ${quote(owner)}` : ""),
  )
  const primary = new Set(keys.rows.map((row) => String(row[0] ?? "")))
  return result.rows.map((row) => {
    const [column, typeName, length, precision, scale, nullable, fallback] = row
    const type = String(typeName ?? "")
    const args =
      type.includes("CHAR") && Number(length) > 0
        ? `(${Number(length)})`
        : (type === "NUMBER" || type === "FLOAT") && precision
          ? `(${Number(precision)},${Number(scale ?? 0)})`
          : ""
    return {
      name: String(column ?? ""),
      type: `${type}${args}`,
      nullable: String(nullable ?? "Y").toUpperCase() === "Y",
      ...(fallback ? { default: String(fallback).trim() } : {}),
      ...(primary.has(String(column ?? "")) ? { primary: true } : {}),
    }
  })
}

export async function close(connection: ResolvedConnection) {
  const key = connectionKey(connection)
  const pending = connections.get(key)
  if (!pending) return
  connections.delete(key)
  await pending.then(
    (conn) => conn.close(),
    () => undefined,
  )
}
