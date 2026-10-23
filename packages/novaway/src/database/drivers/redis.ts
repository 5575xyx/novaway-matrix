/**
 * Redis 驱动。
 *
 * 与 SQL 不同，Redis 没有「查询结果集」的概念：这里把命令结果归一成
 * 单列 `value` 的表格（数组逐项展开），这样 UI 可以复用同一套表格渲染。
 */
import { Redis } from "ioredis"
import type { ColumnInfo, TableInfo } from "../schema"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const clients = new Map<string, Redis>()

function logicalDb(connection: ResolvedConnection) {
  // 树里切换的是 `database`（逻辑库序号，字符串）；旧连接可能只填了 `db`。
  const selected = connection.database?.trim()
  if (selected && /^\d+$/.test(selected)) return Number(selected)
  return connection.db ?? 0
}

function keyOf(connection: ResolvedConnection) {
  return [connection.host ?? "127.0.0.1", connection.port ?? 6379, logicalDb(connection), connection.user ?? ""].join(
    "|",
  )
}

function client(connection: ResolvedConnection) {
  const key = keyOf(connection)
  const existing = clients.get(key)
  if (existing) return existing
  const created = new Redis({
    host: connection.host ?? "127.0.0.1",
    port: connection.port ?? 6379,
    username: connection.user,
    password: connection.password,
    db: logicalDb(connection),
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
    // 连不上时不要无限重连，让错误直接返回给界面。
    retryStrategy: () => null,
  })
  created.on("error", () => undefined)
  clients.set(key, created)
  return created
}

/** 把任意 Redis 返回值转成二维表。 */
export function flatten(value: unknown): RawQueryResult {
  if (Array.isArray(value)) {
    const nested = value.some((item) => Array.isArray(item))
    if (!nested) {
      return { columns: ["value"], rows: value.map((item) => [normalize(item)]) }
    }
    return { columns: ["index", "value"], rows: value.map((item, index) => [index, normalize(item)]) }
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    return { columns: ["key", "value"], rows: entries.map(([field, item]) => [field, normalize(item)]) }
  }
  return { columns: ["value"], rows: [[normalize(value)]] }
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return value.toString("utf8")
  return value
}

export async function test(connection: ResolvedConnection) {
  const info = await client(connection).info("server")
  const match = /redis_version:([^\r\n]+)/.exec(String(info))
  return "redis " + (match?.[1] ?? "unknown")
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const command = sql.trim()
  if (!command) return { columns: [], rows: [], truncated: false }
  const parts = tokenizeCommand(command)
  if (parts.length === 0) return { columns: [], rows: [], truncated: false }
  const [name, ...args] = parts
  const result = await (client(connection).call as (...input: string[]) => Promise<unknown>)(name, ...args)
  const flat = flatten(result)
  return {
    columns: flat.columns,
    rows: flat.rows.slice(options.offset, options.offset + options.limit),
    truncated: flat.rows.length > options.offset + options.limit,
  }
}

/** 支持引号的最小命令切分：`SET key "a b"` → ["SET", "key", "a b"]。 */
export function tokenizeCommand(input: string): string[] {
  const out: string[] = []
  let current = ""
  let quote: string | undefined
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quote) {
      if (char === quote) {
        quote = undefined
        continue
      }
      if (char === "\\" && index + 1 < input.length) {
        current += input[++index]
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current)
        current = ""
      }
      continue
    }
    current += char
  }
  if (current) out.push(current)
  return out
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  // 用 SCAN 而不是 `KEYS *`：后者在大库上会阻塞 Redis 主线程。
  const keys = new Set<string>()
  let cursor = "0"
  do {
    const [next, batch] = await client(connection).scan(cursor, "COUNT", 500)
    for (const key of batch) keys.add(key)
    cursor = next
  } while (cursor !== "0" && keys.size < 500)

  return Array.from(keys)
    .slice(0, 500)
    .sort()
    .map((name) => ({ name, kind: "key" }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const type = await client(connection).type(table)
  const ttl = await client(connection).ttl(table)
  return [
    { name: "type", type: String(type), nullable: false },
    { name: "ttl", type: "seconds", nullable: false, default: String(ttl) },
  ]
}

export async function close(connection: ResolvedConnection) {
  const key = keyOf(connection)
  const existing = clients.get(key)
  if (!existing) return
  clients.delete(key)
  await existing.quit().catch(() => undefined)
}
