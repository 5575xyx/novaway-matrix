import type { ColumnInfo, TableInfo } from "../schema"

/** 连接解析后的完整参数（含明文密码）。 */
export type SshConfig = {
  host: string
  port?: number
  user: string
  password?: string
  privateKeyPath?: string
  privateKey?: string
  passphrase?: string
}

export type ResolvedConnection = {
  id: string
  name: string
  type:
    | "postgres"
    | "mysql"
    | "mariadb"
    | "sqlite"
    | "rqlite"
    | "redis"
    | "mongodb"
    | "clickhouse"
    | "starrocks"
    | "doris"
    | "sqlserver"
    | "oracle"
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  file?: string
  ssl?: boolean
  db?: number
  httpPath?: string
  /** 配置了 SSH 隧道时存在；驱动应连 `host`/`port`（已被改写成本地转发端口）。 */
  ssh?: SshConfig
}

export type RawQueryResult = {
  columns: string[]
  rows: unknown[][]
  affected?: number
}

export type QueryOptions = {
  limit: number
  offset: number
  readOnly?: boolean
  signal?: AbortSignal
}

export interface Driver {
  test(connection: ResolvedConnection): Promise<string>
  query(connection: ResolvedConnection, sql: string, options: QueryOptions): Promise<RawQueryResult>
  listTables(connection: ResolvedConnection): Promise<TableInfo[]>
  describeTable?(connection: ResolvedConnection, table: string): Promise<ColumnInfo[]>
  close(connection: ResolvedConnection): Promise<void>
}
