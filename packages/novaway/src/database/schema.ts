import { Schema } from "effect"

/**
 * 数据库连接与查询的公共类型。
 *
 * 与旧的 dbx MCP 相比，这里的结果是**结构化的**：列名、行数据、是否截断都是
 * 独立字段，UI 与 Agent 都不需要再从 markdown 文本里猜。
 */
/**
 * 支持的数据库类型。
 *
 * `mariadb` / `starrocks` / `doris` 走 MySQL 协议（共用 mysql2 驱动），
 * `rqlite` 是基于 HTTP 的 SQLite，`clickhouse` 走 HTTP 接口，
 * `mongodb` 用官方驱动 + shell 风格命令，
 * `sqlserver` 用 tedious（纯 JS TDS），`oracle` 用 oracledb Thin 模式（纯 JS）。
 */
export const DbType = Schema.Literals([
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
]).annotate({ identifier: "DatabaseType" })
export type DbType = Schema.Schema.Type<typeof DbType>

export const SshTunnel = Schema.Struct({
  enabled: Schema.Boolean,
  host: Schema.String,
  port: Schema.optional(Schema.Number),
  user: Schema.String,
  password: Schema.optional(Schema.String),
  /** 私钥文件路径（与 privateKey 二选一）。 */
  privateKeyPath: Schema.optional(Schema.String),
  /** 私钥内容（PEM）。 */
  privateKey: Schema.optional(Schema.String),
  passphrase: Schema.optional(Schema.String),
}).annotate({ identifier: "DatabaseSshTunnel" })
export type SshTunnel = Schema.Schema.Type<typeof SshTunnel>

export const ConnectionInput = Schema.Struct({
  name: Schema.String,
  type: DbType,
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  database: Schema.optional(Schema.String),
  user: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  /** sqlite 文件路径；其他类型忽略。 */
  file: Schema.optional(Schema.String),
  ssl: Schema.optional(Schema.Boolean),
  /** redis 逻辑库序号。 */
  db: Schema.optional(Schema.Number),
  /** ClickHouse / rqlite 之类的 HTTP 端点是否需要 TLS。 */
  httpPath: Schema.optional(Schema.String),
  /** SSH 隧道：填了就走隧道，驱动连本地转发端口。 */
  ssh: Schema.optional(SshTunnel),
}).annotate({ identifier: "DatabaseConnectionInput" })
export type ConnectionInput = Schema.Schema.Type<typeof ConnectionInput>

export const ConnectionSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: DbType,
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  database: Schema.optional(Schema.String),
  user: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  db: Schema.optional(Schema.Number),
  httpPath: Schema.optional(Schema.String),
  /** 是否配置了 SSH 隧道（不回传凭据）。 */
  sshEnabled: Schema.Boolean,
  sshHost: Schema.optional(Schema.String),
  /** 是否保存了密码。永远不回传密码本身。 */
  hasPassword: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "DatabaseConnection" })
export type ConnectionSummary = Schema.Schema.Type<typeof ConnectionSummary>

export const ColumnInfo = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  nullable: Schema.Boolean,
  default: Schema.optional(Schema.String),
  primary: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "DatabaseColumn" })
export type ColumnInfo = Schema.Schema.Type<typeof ColumnInfo>

export const TableInfo = Schema.Struct({
  name: Schema.String,
  /** table / view / collection 等。 */
  kind: Schema.String,
  schema: Schema.optional(Schema.String),
}).annotate({ identifier: "DatabaseTable" })
export type TableInfo = Schema.Schema.Type<typeof TableInfo>

export const QueryResult = Schema.Struct({
  columns: Schema.Array(Schema.String),
  rows: Schema.Array(Schema.Array(Schema.Unknown)),
  rowCount: Schema.Number,
  /** 结果是否被截断（还有更多行）。 */
  truncated: Schema.Boolean,
  /** 写操作影响的行数。 */
  affected: Schema.optional(Schema.Number),
  durationMs: Schema.Number,
  /** 实际执行的 SQL（分页时会被包装）。 */
  sql: Schema.String,
}).annotate({ identifier: "DatabaseQueryResult" })
export type QueryResult = Schema.Schema.Type<typeof QueryResult>

export const TestResult = Schema.Struct({
  ok: Schema.Boolean,
  message: Schema.String,
}).annotate({ identifier: "DatabaseTestResult" })
export type TestResult = Schema.Schema.Type<typeof TestResult>

export const DEFAULT_PAGE_SIZE = 200
export const MAX_PAGE_SIZE = 2000
