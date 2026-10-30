/**
 * oracledb 26.x 没有随包提供 TypeScript 类型（只有 `index.js`）。
 * 这里只声明本项目用到的 Thin 模式子集，避免为一个驱动引入 @types 依赖。
 */
declare module "oracledb" {
  export interface ExecuteOptions {
    outFormat?: number
    maxRows?: number
    autoCommit?: boolean
    fetchArraySize?: number
  }

  export interface ResultSet {
    rows?: unknown[]
    rowsAffected?: number
    metaData?: Array<{ name: string }>
  }

  export interface Connection {
    execute(sql: string, binds?: unknown[], options?: ExecuteOptions): Promise<ResultSet>
    close(): Promise<void>
  }

  export interface Pool {
    getConnection(): Promise<Connection>
    close(drainTime?: number): Promise<void>
  }

  export function getConnection(attributes: Record<string, unknown>): Promise<Connection>
  export function createPool(attributes: Record<string, unknown>): Promise<Pool>

  const oracledb: {
    getConnection: typeof getConnection
    createPool: typeof createPool
    OUT_FORMAT_ARRAY: number
    OUT_FORMAT_OBJECT: number
    versionString: string
  }
  export default oracledb
}
