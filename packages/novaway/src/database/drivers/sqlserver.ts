/**
 * SQL Server 驱动（`tedious`，纯 JS 实现 TDS 协议）。
 *
 * 不依赖 mssql 包里的原生模块，也不需要 ODBC 驱动；随包 Node 直接可用。
 * 认证只支持 SQL Server 认证（用户名/密码）——Windows 集成认证需要 SSPI 原生模块，
 * Azure AD 需要额外的令牌流程，本项目都不涉及。
 *
 * tedious 的 Connection 一次只能跑一个 Request，所以这里按连接缓存复用，
 * 每个请求串行执行；连接出错就从缓存里摘掉，下次查询重新握手。
 */
import { Connection, Request } from "tedious"
import type { ConnectionConfiguration } from "tedious"
import type { ColumnInfo, TableInfo } from "../schema"
import { capRows, pageable, wrapForPageDialect } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const connections = new Map<string, Promise<Connection>>()

export function connectionKey(connection: ResolvedConnection) {
  return [
    connection.host ?? "127.0.0.1",
    connection.port ?? 1433,
    connection.database ?? "",
    connection.user ?? "",
  ].join("|")
}

/** 连接参数映射（导出供单测，避免测试真的去连 1433）。 */
export function configFor(connection: ResolvedConnection): ConnectionConfiguration {
  return {
    server: connection.host ?? "127.0.0.1",
    authentication: {
      type: "default",
      options: { userName: connection.user ?? "", password: connection.password ?? "" },
    },
    options: {
      port: connection.port ?? 1433,
      database: connection.database,
      // 自签证书在内网部署里很常见，这里不做证书链校验（与 pg/mysql 驱动的策略一致）。
      encrypt: Boolean(connection.ssl),
      trustServerCertificate: true,
      requestTimeout: 30_000,
      connectTimeout: 15_000,
    },
  }
}

function open(connection: ResolvedConnection) {
  const key = connectionKey(connection)
  const existing = connections.get(key)
  if (existing) return existing
  const config = configFor(connection)
  const created = new Promise<Connection>((resolve, reject) => {
    const conn = new Connection(config)
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      connections.delete(key)
      reject(error)
    }
    conn.on("connect", () => {
      if (settled) return
      settled = true
      resolve(conn)
    })
    conn.on("error", (error: Error) => {
      connections.delete(key)
      fail(error)
    })
    conn.connect((error) => {
      if (error) fail(error)
    })
  })
  connections.set(key, created)
  // 失败时把缓存里的 rejected promise 摘掉，避免后续查询一直拿到同一个错误。
  created.catch(() => connections.delete(key))
  return created
}

/** Date → ISO，Buffer → hex，BigInt → number/string，其余原样。 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return "0x" + value.toString("hex")
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  return value
}

/** SQL Server 没有 `?` 占位符以外的通用写法，这里只用于标识符/字符串拼装。 */
function quote(value: string) {
  return "'" + value.replaceAll("'", "''") + "'"
}

function exec(
  connection: ResolvedConnection,
  sql: string,
): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number }> {
  return open(connection).then(
    (conn) =>
      new Promise((resolve, reject) => {
        const columns: string[] = []
        const rows: unknown[][] = []
        const request = new Request(sql, (error: Error | null | undefined, rowCount?: number) => {
          if (error) return reject(error)
          resolve({ columns, rows, rowCount: rowCount ?? rows.length })
        })
        // tedious 用「数组或按列名索引的对象」两种形态发 columnMetadata
        //（取决于 useColumnNames），这里都归一成数组，只取列名。
        type Meta = { colName: string }
        request.on("columnMetadata", (metadata: Meta[] | Record<string, Meta>) => {
          const list = Array.isArray(metadata) ? metadata : Object.values(metadata)
          columns.push(...list.map((column) => column.colName))
        })
        request.on("row", (cells: Array<{ value: unknown }>) => {
          rows.push(cells.map((cell) => normalize(cell.value)))
        })
        conn.execSql(request)
      }),
  )
}

export async function test(connection: ResolvedConnection) {
  const result = await exec(connection, "select @@version as version")
  return String(result.rows[0]?.[0] ?? "sqlserver")
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = pageable(sql) ? wrapForPageDialect(sql, options.limit + 1, options.offset, "top") : sql
  const result = await exec(connection, text)
  const { rows, truncated } = capRows(result.rows, options.limit)
  return {
    columns: result.columns,
    rows,
    truncated,
    ...(result.columns.length === 0 && result.rowCount >= 0 ? { affected: result.rowCount } : {}),
  }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const result = await exec(
    connection,
    "select s.name as table_schema, o.name as table_name, o.type as object_type " +
      "from sys.objects o join sys.schemas s on o.schema_id = s.schema_id " +
      "where o.type in ('U', 'V') and o.is_ms_shipped = 0 order by s.name, o.name",
  )
  return result.rows.map((row) => ({
    name: String(row[1] ?? ""),
    schema: String(row[0] ?? ""),
    kind: String(row[2] ?? "") === "V" ? "view" : "table",
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const cols = await exec(
    connection,
    "select c.name, t.name as type_name, c.max_length, c.precision, c.scale, c.is_nullable, " +
      "c.is_identity, dc.definition " +
      "from sys.columns c " +
      "join sys.types t on c.user_type_id = t.user_type_id " +
      "join sys.objects o on c.object_id = o.object_id " +
      "join sys.schemas s on o.schema_id = s.schema_id " +
      "left join sys.default_constraints dc on c.default_object_id = dc.object_id " +
      `where o.name = ${quote(table)} order by c.column_id`,
  )
  const keys = await exec(
    connection,
    "select col.name from sys.indexes i " +
      "join sys.index_columns ic on i.object_id = ic.object_id and i.index_id = ic.index_id " +
      "join sys.columns col on ic.object_id = col.object_id and ic.column_id = col.column_id " +
      "join sys.objects o on i.object_id = o.object_id " +
      `where i.is_primary_key = 1 and o.name = ${quote(table)}`,
  )
  const primary = new Set(keys.rows.map((row) => String(row[0] ?? "")))
  return cols.rows.map((row) => {
    const [name, typeName, length, precision, scale, nullable, identity, fallback] = row
    const size =
      typeName === "nvarchar" || typeName === "nchar"
        ? Number(length) > 0
          ? `(${Number(length) / 2})`
          : "(max)"
        : typeName === "varchar" || typeName === "char" || typeName === "varbinary" || typeName === "binary"
          ? Number(length) > 0
            ? `(${Number(length)})`
            : "(max)"
          : typeName === "decimal" || typeName === "numeric"
            ? `(${Number(precision)},${Number(scale)})`
            : ""
    return {
      name: String(name ?? ""),
      type: `${String(typeName ?? "")}${size}`,
      nullable: Boolean(nullable),
      ...(fallback ? { default: String(fallback) } : {}),
      ...(primary.has(String(name ?? "")) || Boolean(identity) ? { primary: primary.has(String(name ?? "")) } : {}),
    }
  })
}

export async function close(connection: ResolvedConnection) {
  const key = connectionKey(connection)
  const pending = connections.get(key)
  if (!pending) return
  connections.delete(key)
  await pending.then(
    (conn) => {
      conn.close()
    },
    () => undefined,
  )
}
