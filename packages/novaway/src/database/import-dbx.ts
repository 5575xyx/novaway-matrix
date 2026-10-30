/**
 * 一次性迁移：把旧 dbx MCP server 的连接库导进原生连接存储。
 *
 * 旧版桌面端把连接存在 `userData/dbx/dbx.db`（SQLite，两张表）：
 * - `connections(id, config_json)`：config_json 里是 camel/snake 混合的原始配置；
 * - `connection_secrets(connection_id, key, secret)`：密码单独存放。
 *
 * 新版删掉了 dbx，连接统一在 `data/database/connections.json`。用户不该因为升级
 * 就重配一遍，所以启动时读一次旧库，落到新存储里，然后写标记文件避免重复导入。
 *
 * 任何异常都只记日志：迁移失败不能挡住应用启动。
 */
import * as Log from "@novaway/core/util/log"
import fs from "node:fs/promises"
import path from "node:path"
import { readAll } from "#db"
import { databaseRoot, listConnections, saveConnection } from "./store"
import type { ConnectionInput } from "./schema"

const log = Log.create({ service: "database.import" })

const SUPPORTED = new Set([
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "rqlite",
  "redis",
  "mongodb",
  "clickhouse",
  "starrocks",
  "doris",
  "sqlserver",
  "oracle",
])

/** dbx 的 db_type → 原生类型。dbx 自己的 `driver_profile` 更具体，优先用它。 */
const TYPE_ALIASES: Record<string, ConnectionInput["type"]> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mariadb",
  sqlite: "sqlite",
  sqlite3: "sqlite",
  rqlite: "rqlite",
  redis: "redis",
  mongodb: "mongodb",
  mongo: "mongodb",
  clickhouse: "clickhouse",
  starrocks: "starrocks",
  doris: "doris",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  oracle: "oracle",
}

type LegacyConfig = Record<string, unknown>

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** 把一条 dbx 配置映射成原生 ConnectionInput；无法识别的类型返回 undefined。 */
export function mapLegacy(config: LegacyConfig, password?: string): ConnectionInput | undefined {
  const rawType = text(config.driver_profile) ?? text(config.db_type)
  const type = rawType ? TYPE_ALIASES[rawType.toLowerCase()] : undefined
  const name = text(config.name)
  if (!type || !SUPPORTED.has(type) || !name) return undefined

  const sqliteFile = type === "sqlite" ? (text(config.connection_string) ?? text(config.database)) : undefined
  return {
    name,
    type: type as ConnectionInput["type"],
    host: type === "sqlite" ? undefined : text(config.host),
    port: type === "sqlite" ? undefined : number(config.port),
    database: type === "sqlite" || type === "redis" ? undefined : text(config.database),
    user: type === "sqlite" ? undefined : (text(config.username) ?? text(config.user)),
    password: password ?? text(config.password),
    file: sqliteFile,
    ssl: Boolean(config.ssl) || undefined,
    db: type === "redis" ? number(config.db) : undefined,
    httpPath: type === "rqlite" ? text(config.url_params) : undefined,
  }
}

/**
 * 导入旧库。`legacyPath` 不存在、已导入过、或表结构不符都直接返回。
 * 返回导入条数，便于测试与日志。
 */
export async function importLegacyDbxConnections(legacyPath: string, root = databaseRoot()) {
  const marker = path.join(root, ".dbx-imported")
  if (
    await fs.stat(marker).then(
      () => true,
      () => false,
    )
  )
    return 0
  if (
    !(await fs.stat(legacyPath).then(
      () => true,
      () => false,
    ))
  )
    return 0

  let rows: Array<Record<string, unknown>> = []
  try {
    rows = readAll(legacyPath, "SELECT id, config_json FROM connections")
  } catch (error) {
    log.warn("legacy dbx database unreadable, skipping import", {
      path: legacyPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }

  let secrets = new Map<string, string>()
  try {
    secrets = new Map(
      readAll(legacyPath, "SELECT connection_id, key, secret FROM connection_secrets")
        .filter((row) => String(row.key ?? "").toLowerCase() === "password")
        .map((row) => [String(row.connection_id ?? ""), String(row.secret ?? "")]),
    )
  } catch {
    // 没有 secrets 表也无所谓，密码可能直接写在 config_json 里。
  }

  const existing = new Set((await listConnections(root)).map((item) => item.name))
  let imported = 0
  for (const row of rows) {
    try {
      const config = JSON.parse(String(row.config_json ?? "{}")) as LegacyConfig
      const input = mapLegacy(config, secrets.get(String(row.id ?? "")))
      if (!input || existing.has(input.name)) continue
      await saveConnection(input, root)
      existing.add(input.name)
      imported += 1
    } catch (error) {
      log.warn("failed to import legacy connection", {
        id: String(row.id ?? ""),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(marker, new Date().toISOString(), "utf8")
  if (imported > 0) log.info("imported legacy dbx connections", { count: imported })
  return imported
}
