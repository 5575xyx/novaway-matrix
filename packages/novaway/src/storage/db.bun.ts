import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

export function init(path: string) {
  const sqlite = new Database(path, { create: true })
  const db = drizzle({ client: sqlite })
  return db
}

/** 只读一次性查询（导入旧 dbx 连接用）；bun:sqlite 不能泄漏进 node 构建。 */
export function readAll(path: string, sql: string) {
  const sqlite = new Database(path, { readonly: true })
  try {
    return sqlite.query(sql).all() as Array<Record<string, unknown>>
  } finally {
    sqlite.close()
  }
}
