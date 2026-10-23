/**
 * SQLite 驱动。
 *
 * 使用运行时内置的 SQLite：Bun 下是 `bun:sqlite`，Node 22+ 下是 `node:sqlite`。
 * 因此**没有原生模块 ABI 问题** —— 不需要为桌面端单独跑 node 进程，
 * 也不用 better-sqlite3（69MB 且与 Electron ABI 不匹配）。
 *
 * 每次查询即开即关：SQLite 打开成本极低，避免长期持有文件句柄导致
 * 用户删除/替换数据库文件时被占用。
 */
import path from "node:path"
import type { ColumnInfo, TableInfo } from "../schema"
import { capRows, pageable, wrapForPage } from "./sql"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

type Statement = {
  columns: () => string[]
  all: () => Array<Record<string, unknown>>
  run: () => { changes?: number | bigint }
}

type Handle = {
  prepare: (sql: string) => Statement
  close: () => void
}

/**
 * 打开数据库文件。
 *
 * 两套内置实现的 API 略有差异：
 * - Bun：`db.prepare(sql).columnNames` 是属性，`all()` 返回对象数组；
 * - Node：`db.prepare(sql).columns()` 是方法，`all()` 同样返回对象数组。
 * 这里统一成一个最小接口，调用方不需要关心运行时。
 */
async function open(connection: ResolvedConnection): Promise<Handle> {
  const file = connection.file?.trim()
  if (!file) throw new Error("SQLite 连接需要填写数据库文件路径")
  const resolved = path.resolve(file)

  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite")
    const db = new Database(resolved, { readwrite: true })
    return {
      prepare: (sql) => {
        const statement = db.prepare(sql) as unknown as {
          columnNames: string[]
          all: () => Array<Record<string, unknown>>
          run: () => { changes?: number | bigint }
        }
        return {
          columns: () => statement.columnNames ?? [],
          all: () => statement.all(),
          run: () => statement.run(),
        }
      },
      close: () => db.close(),
    }
  }

  const { DatabaseSync } = await import("node:sqlite")
  const db = new DatabaseSync(resolved)
  return {
    prepare: (sql) => {
      const statement = db.prepare(sql)
      return {
        columns: () => statement.columns().map((column) => String(column.name)),
        all: () => statement.all() as Array<Record<string, unknown>>,
        run: () => statement.run() as { changes?: number | bigint },
      }
    },
    close: () => db.close(),
  }
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Uint8Array) return "0x" + Buffer.from(value).toString("hex")
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  return value
}

export async function test(connection: ResolvedConnection) {
  const db = await open(connection)
  try {
    const statement = db.prepare("select sqlite_version() as version")
    const row = statement.all()[0]
    return "sqlite " + String(row?.version ?? "")
  } finally {
    db.close()
  }
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const text = pageable(sql) ? wrapForPage(sql, options.limit + 1, options.offset) : sql
  const db = await open(connection)
  try {
    const statement = db.prepare(text)
    const columns = statement.columns()
    // 有列定义说明是查询；否则按写操作处理。
    if (columns.length > 0) {
      const rows = statement.all()
      const raw = rows.map((row) => columns.map((column) => normalize(row[column])))
      const capped = capRows(raw, options.limit)
      return { columns, rows: capped.rows, truncated: capped.truncated }
    }
    const info = statement.run()
    return { columns: [], rows: [], truncated: false, affected: Number(info.changes ?? 0) }
  } finally {
    db.close()
  }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const db = await open(connection)
  try {
    const rows = db
      .prepare(
        "select name, type from sqlite_master where type in ('table', 'view') and name not like 'sqlite_%' order by name",
      )
      .all() as Array<{ name: string; type: string }>
    return rows.map((row) => ({ name: String(row.name), kind: row.type === "view" ? "view" : "table" }))
  } finally {
    db.close()
  }
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const db = await open(connection)
  try {
    const rows = db.prepare("pragma table_info(" + quote(table) + ")").all() as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>
    return rows.map((row) => ({
      name: String(row.name),
      type: String(row.type || "any"),
      nullable: Number(row.notnull) === 0,
      ...(row.dflt_value ? { default: String(row.dflt_value) } : {}),
      ...(Number(row.pk) > 0 ? { primary: true } : {}),
    }))
  } finally {
    db.close()
  }
}

/** SQLite 标识符转义：双引号包裹并转义内部双引号。 */
export function quote(name: string) {
  return String.fromCharCode(34) + name.replace(/"/g, String.fromCharCode(34, 34)) + String.fromCharCode(34)
}

export async function close() {
  // 每次查询即开即关，无需释放连接池。
}
