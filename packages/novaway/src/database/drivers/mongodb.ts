/**
 * MongoDB 驱动。
 *
 * 用官方 `mongodb` 驱动 + 一个**最小 shell 风格解释器**：
 *
 *   find({ status: "active" }).limit(20)
 *   db.users.find({ age: { $gt: 18 } })
 *   db.users.countDocuments({ status: "active" })
 *   db.users.aggregate([{ $match: { ... } }])
 *   show collections
 *
 * 不支持完整的 JS 求值（那等于在服务端执行任意代码）。只接受
 * 上述几种形态，其余明确报错并给出示例。
 */
import type { MongoClient, Db, Document } from "mongodb"
import type { ColumnInfo, TableInfo } from "../schema"
import type { QueryOptions, RawQueryResult, ResolvedConnection } from "./types"

const clients = new Map<string, MongoClient>()

/**
 * 按需加载驱动。
 *
 * `mongodb` 会连带加载 `bson`，而 bson 在模块求值阶段调用
 * `process.getBuiltinModule("v8").startupSnapshot.isBuildingSnapshot()` —— Bun 目前
 * 未实现该方法，**静态导入会直接让整个服务起不来**。改成首次真正连接 Mongo 时
 * 才 import，其它数据库类型和不用数据库的场景都不受影响。
 */
let sdk: Promise<typeof import("mongodb")> | undefined
function load() {
  return (sdk ??= import("mongodb"))
}

function uri(connection: ResolvedConnection) {
  const host = connection.host ?? "127.0.0.1"
  const port = connection.port ?? 27017
  const credentials =
    connection.user || connection.password
      ? encodeURIComponent(connection.user ?? "") + ":" + encodeURIComponent(connection.password ?? "") + "@"
      : ""
  const auth = credentials ? "?authSource=admin" : ""
  return "mongodb://" + credentials + host + ":" + port + "/" + (connection.database ?? "") + auth
}

function keyOf(connection: ResolvedConnection) {
  return uri(connection)
}

async function database(connection: ResolvedConnection): Promise<Db> {
  const key = keyOf(connection)
  let client = clients.get(key)
  if (!client) {
    const { MongoClient } = await load()
    client = new MongoClient(uri(connection), { serverSelectionTimeoutMS: 10_000, maxPoolSize: 4 })
    await client.connect()
    clients.set(key, client)
  }
  return client.db(connection.database || "test")
}

export type MongoCommand = {
  op: "find" | "count" | "aggregate" | "collections" | "databases"
  collection?: string
  filter?: Document
  pipeline?: Document[]
  limit?: number
  skip?: number
}

/**
 * 解析 shell 风格命令。
 *
 * 只做「取其结构」：把对象字面量交给 JSON.parse（先补引号），
 * 因此 `{ status: 'active' }` 与 `{ "status": "active" }` 都支持。
 */
export function parseCommand(sql: string): MongoCommand {
  const text = sql.trim().replace(/;\s*$/, "")
  if (/^show\s+collections$/i.test(text) || /^db\.getCollectionNames\(\)$/i.test(text)) {
    return { op: "collections" }
  }
  if (/^show\s+(dbs|databases)$/i.test(text) || /^db\.admin\(\)\.listDatabases\(\)$/i.test(text)) {
    return { op: "databases" }
  }

  // 先摘掉尾部的 `.limit(n)`，否则贪婪匹配会把整段（含链式调用）都吞进参数。
  const chained = /^(.*)\.limit\(\s*(\d+)\s*\)\s*$/i.exec(text)
  const body = chained ? chained[1] : text
  const limit = chained ? Number(chained[2]) : undefined

  const call = /^(?:db\.)?([A-Za-z0-9_$.-]*?)\.?([A-Za-z]+)\s*\(([\s\S]*)\)\s*$/i.exec(body)
  if (!call) {
    throw new Error(
      "无法解析 MongoDB 命令。支持：db.<集合>.find({...})、.countDocuments({...})、" +
        ".aggregate([...])，以及 show collections。",
    )
  }

  const collection = call[1] || undefined
  const method = call[2].toLowerCase()
  const args = call[3].trim()

  const parsed = args ? parseLiteral(args) : undefined
  if (method === "find") {
    if (!collection) throw new Error("find 需要指定集合：db.<集合>.find({...})")
    return { op: "find", collection, filter: (parsed as Document) ?? {}, ...(limit ? { limit } : {}) }
  }
  if (method === "countdocuments" || method === "count") {
    if (!collection) throw new Error("countDocuments 需要指定集合")
    return { op: "count", collection, filter: (parsed as Document) ?? {} }
  }
  if (method === "aggregate") {
    if (!collection) throw new Error("aggregate 需要指定集合")
    if (!Array.isArray(parsed)) throw new Error("aggregate 的参数必须是数组，例如 [{ $match: {...} }]")
    return { op: "aggregate", collection, pipeline: parsed as Document[] }
  }
  throw new Error("不支持的 MongoDB 方法：" + method)
}

/** 把 JS 对象字面量近似转成 JSON：单引号、无引号键、尾逗号。 */
export function parseLiteral(input: string): unknown {
  const normalized = input
    .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":')
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_all, value: string) => JSON.stringify(value.replace(/\\'/g, "'")))
    .replace(/,\s*([}\]])/g, "$1")
  return JSON.parse(normalized)
}

/** 文档数组 → 列 + 二维行（列取所有文档键的并集）。 */
export function toTable(docs: Document[]): RawQueryResult {
  const columns: string[] = []
  for (const doc of docs) {
    for (const key of Object.keys(doc)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  const rows = docs.map((doc) =>
    columns.map((column) => {
      const value = doc[column]
      if (value === undefined) return null
      if (value instanceof Date) return value.toISOString()
      return value
    }),
  )
  return { columns, rows }
}

export async function test(connection: ResolvedConnection) {
  const db = await database(connection)
  const info = (await db.admin().serverInfo()) as { version?: string }
  return "mongodb " + (info.version ?? "?")
}

export async function query(
  connection: ResolvedConnection,
  sql: string,
  options: QueryOptions,
): Promise<RawQueryResult & { truncated: boolean }> {
  const command = parseCommand(sql)
  const db = await database(connection)

  if (command.op === "collections") {
    const list = await db.listCollections().toArray()
    const table = toTable(list.map((item) => ({ name: item.name, type: item.type })))
    return { ...table, truncated: false }
  }

  if (command.op === "databases") {
    const result = await db.admin().listDatabases()
    const table = toTable(
      result.databases.map((item) => ({ name: item.name, sizeOnDisk: item.sizeOnDisk, empty: item.empty ?? false })),
    )
    return { ...table, truncated: false }
  }

  const collection = db.collection(command.collection!)
  if (command.op === "count") {
    const count = await collection.countDocuments(command.filter ?? {})
    return { columns: ["count"], rows: [[count]], truncated: false }
  }

  // 用户写的 `.limit(n)` 与分页大小取较小值；多取一条判断是否还有下一页。
  const limit = command.limit === undefined ? options.limit : Math.min(command.limit, options.limit)

  if (command.op === "aggregate") {
    // 聚合可能产出任意多文档：套上 skip/limit 后再多取一条判断是否截断。
    const pipeline = [
      ...(command.pipeline ?? []),
      ...(options.offset ? [{ $skip: options.offset }] : []),
      { $limit: limit + 1 },
    ]
    const docs = (await collection.aggregate(pipeline).toArray()) as Document[]
    const truncated = docs.length > limit
    const table = toTable(truncated ? docs.slice(0, limit) : docs)
    return { ...table, truncated }
  }

  const cursor = collection
    .find(command.filter ?? {})
    .skip(options.offset)
    .limit(limit + 1)

  const docs = (await cursor.toArray()) as Document[]
  const truncated = docs.length > limit
  const table = toTable(truncated ? docs.slice(0, limit) : docs)
  return { ...table, truncated }
}

export async function listTables(connection: ResolvedConnection): Promise<TableInfo[]> {
  const db = await database(connection)
  const list = await db.listCollections().toArray()
  return list.map((item) => ({
    name: item.name,
    kind: item.type === "view" ? "view" : "collection",
  }))
}

export async function describeTable(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]> {
  const db = await database(connection)
  const sample = (await db.collection(table).find({}).limit(20).toArray()) as Document[]
  const keys = new Map<string, Set<string>>()
  for (const doc of sample) {
    for (const [key, value] of Object.entries(doc)) {
      const set = keys.get(key) ?? new Set<string>()
      set.add(
        value === null
          ? "null"
          : typeof value === "object"
            ? Array.isArray(value)
              ? "array"
              : "object"
            : typeof value,
      )
      keys.set(key, set)
    }
  }
  return Array.from(keys.entries()).map(([name, types]) => ({
    name,
    type: Array.from(types).join(" | "),
    // 抽样里没有 null 不代表一定非空：Mongo 无固定 schema。
    nullable: true,
    ...(name === "_id" ? { primary: true } : {}),
  }))
}

export async function close(connection: ResolvedConnection) {
  const key = keyOf(connection)
  const existing = clients.get(key)
  if (!existing) return
  clients.delete(key)
  await existing.close().catch(() => undefined)
}
